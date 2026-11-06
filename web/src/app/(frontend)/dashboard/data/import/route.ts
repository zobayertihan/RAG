import { NextResponse } from 'next/server'

import { parseCsv } from '@/lib/csv'
import { parseStaffPdf } from '@/lib/python'
import { getSession } from '@/lib/session'
import { COLUMNS, diffFields, rowToData } from '@/lib/supervisorCsv'

export const maxDuration = 300 // saving many supervisors updates search for each one

const MAX_ROWS = 1000
const MAX_FILES = 10
const MAX_BYTES = 4 * 1024 * 1024 // Vercel accepts about 4.5 MB per request

type Action = 'create' | 'update' | 'unchanged' | 'error'
type Row = { source: string; recordId: string; name: string; action: Action; fields: string[]; note?: string; error?: string }
type Candidate = { source: string; recordId: string; data: Record<string, unknown>; matchedBy?: string; error?: string }

const norm = (s: unknown) => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
const listOf = (v: unknown) => (Array.isArray(v) ? v.map((r) => norm((r as { value?: string }).value)) : [])

/**
 * Upload one or more files to add or update supervisors. Two steps with the same files:
 * apply=false returns what would change, apply=true saves it. Each saved change goes through the
 * normal hooks, so it is versioned (Changes page) and search is updated right away.
 *
 * - CSV: the exported format; rows are matched by record_id.
 * - PDF: a staff list with a table of name, position and research areas (like the BTECH list).
 *   Rows are matched to existing supervisors by profile link, then by name; unknown people are new.
 *   Research areas a supervisor edited themselves are kept unless "replaceEdited" is ticked.
 * Nobody is deleted: people missing from the files are only listed.
 */
export async function POST(req: Request) {
  const { payload, user } = await getSession()
  if (!user || user.role !== 'admin') return NextResponse.json({ detail: 'Sign in as an admin.' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const files = (form?.getAll('files') ?? []).filter((f): f is File => typeof f === 'object' && 'arrayBuffer' in f)
  if (!files.length) return NextResponse.json({ detail: 'Choose at least one PDF or CSV file.' }, { status: 400 })
  if (files.length > MAX_FILES) return NextResponse.json({ detail: `At most ${MAX_FILES} files at a time.` }, { status: 400 })
  if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) {
    return NextResponse.json({ detail: 'The files are larger than 4 MB together. Upload them in smaller groups.' }, { status: 400 })
  }
  const apply = form?.get('apply') === 'true'
  const replaceEdited = form?.get('replaceEdited') === 'true'

  const { docs } = await payload.find({ collection: 'supervisors', depth: 0, limit: 5000, pagination: false, overrideAccess: false, user })
  const byId = new Map(docs.map((d) => [d.recordId, d]))
  const byUrl = new Map(docs.filter((d) => d.profileUrl).map((d) => [norm(d.profileUrl), d]))
  const byName = new Map(docs.map((d) => [norm(d.name), d]))
  let nextNumber = Math.max(0, ...docs.map((d) => Number(/^btech-(\d+)$/.exec(d.recordId)?.[1] ?? 0))) + 1
  const newIdFor = new Map<string, string>() // normalized name -> id given to a new person in this upload

  // when a supervisor last edited their own research areas
  const versions = await payload.find({
    collection: 'profile-versions', depth: 1, limit: 5000, pagination: false, overrideAccess: true,
    where: { changedFields: { contains: 'interests' } }, sort: '-createdAt',
  })
  const editedBySupervisor = new Map<number, string>()
  for (const v of versions.docs) {
    const by = v.changedBy as { role?: string } | number | null
    const sid = typeof v.supervisor === 'object' ? v.supervisor?.id : v.supervisor
    if (sid && typeof by === 'object' && by?.role === 'supervisor' && !editedBySupervisor.has(sid)) {
      editedBySupervisor.set(sid, String(v.createdAt).slice(0, 10))
    }
  }

  const candidates: Candidate[] = []
  const warnings: string[] = []
  let pdfCount = 0
  for (const file of files) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.csv')) {
      const [rawHeader, ...lines] = parseCsv(await file.text())
      const header = (rawHeader || []).map((h) => h.trim().toLowerCase())
      if (!header.includes('record_id')) {
        warnings.push(`${file.name}: the first row must be the column names and include record_id (known columns: ${COLUMNS.join(', ')}). File skipped.`)
        continue
      }
      if (lines.length > MAX_ROWS) { warnings.push(`${file.name}: more than ${MAX_ROWS} rows. File skipped.`); continue }
      const unknown = header.filter((h) => h && !(COLUMNS as readonly string[]).includes(h) && h !== 'slots_used' && h !== 'profile_updated_at')
      if (unknown.length) warnings.push(`${file.name}: ignored columns ${unknown.join(', ')}`)
      for (const [i, cells] of lines.entries()) {
        const { recordId, data, error } = rowToData(header, cells)
        candidates.push({ source: `${file.name}, line ${i + 2}`, recordId, data, error })
      }
    } else if (lower.endsWith('.pdf')) {
      pdfCount++
      let parsed
      try {
        parsed = await parseStaffPdf(await file.arrayBuffer())
      } catch (e) {
        warnings.push(`${file.name}: ${(e as Error).message}`)
        continue
      }
      for (const w of parsed.warnings) warnings.push(`${file.name}: ${w}`)
      for (const r of parsed.rows) {
        const existing = (r.profile_url && byUrl.get(norm(r.profile_url))) || byName.get(norm(r.name))
        const matchedBy = existing ? (r.profile_url && byUrl.get(norm(r.profile_url)) ? 'profile link' : 'name') : undefined
        let recordId = existing?.recordId
        if (!recordId) {
          recordId = newIdFor.get(norm(r.name)) ?? `btech-${String(nextNumber++).padStart(3, '0')}`
          newIdFor.set(norm(r.name), recordId)
        }
        const data: Record<string, unknown> = {
          name: r.name, position: r.position, interests: r.interests.map((value) => ({ value })),
        }
        if (r.profile_url) data.profileUrl = r.profile_url
        if (r.email) data.email = r.email
        candidates.push({ source: `${file.name}, page ${r.page}`, recordId, data, matchedBy,
          error: !r.position ? 'no position in the PDF row' : undefined })
      }
    } else {
      warnings.push(`${file.name}: only PDF and CSV files can be uploaded. File skipped.`)
    }
  }

  // the same person in several files: the last file wins
  const last = new Map<string, number>()
  candidates.forEach((c, i) => { if (c.recordId) last.set(c.recordId, i) })

  const rows: Row[] = []
  const touched = new Set<string>()
  for (const [i, c] of candidates.entries()) {
    const existing = byId.get(c.recordId)
    const name = String(c.data.name ?? existing?.name ?? '')
    const row: Row = { source: c.source, recordId: c.recordId, name, action: 'unchanged', fields: [] }
    if (c.error) { rows.push({ ...row, action: 'error', error: c.error }); continue }
    if (last.get(c.recordId) !== i) { rows.push({ ...row, note: 'also in a later file; that one is used' }); continue }
    touched.add(c.recordId)
    const data = { ...c.data }
    if (!existing) {
      if (!data.name || !data.position) { rows.push({ ...row, action: 'error', error: 'a new supervisor needs name and position' }); continue }
      row.action = 'create'
      row.fields = Object.keys(data)
    } else {
      let fields = diffFields(existing as unknown as Record<string, unknown>, data)
      // a difference in capital letters only is not a change
      if (fields.includes('interests') && JSON.stringify(listOf(existing.interests)) === JSON.stringify(listOf(data.interests))) {
        fields = fields.filter((f) => f !== 'interests')
      }
      const editedOn = editedBySupervisor.get(existing.id)
      if (fields.includes('interests') && editedOn && !replaceEdited) {
        fields = fields.filter((f) => f !== 'interests')
        row.note = `research areas kept: ${existing.name} edited them on ${editedOn}`
      }
      if (c.matchedBy === 'name' && fields.includes('profileUrl')) row.note = [row.note, 'matched by name'].filter(Boolean).join('; ')
      row.fields = fields
      row.action = fields.length ? 'update' : 'unchanged'
    }
    if (apply && (row.action === 'create' || row.action === 'update')) {
      try {
        if (row.action === 'create') {
          await payload.create({ collection: 'supervisors', data: { recordId: c.recordId, ...data } as never, overrideAccess: false, user })
        } else {
          const changed = Object.fromEntries(row.fields.map((f) => [f, data[f]]))
          await payload.update({ collection: 'supervisors', id: existing!.id, data: changed as never, overrideAccess: false, user })
        }
      } catch (e) {
        row.action = 'error'
        row.error = (e as Error).message
      }
    }
    rows.push(row)
  }

  // only a full staff list (PDF) says anything about who is missing; nobody is removed
  const missing = pdfCount ? docs.filter((d) => !touched.has(d.recordId)).map((d) => d.name).sort() : []
  const count = (a: Action) => rows.filter((r) => r.action === a).length
  return NextResponse.json({
    applied: apply, warnings, missing,
    rows: rows.filter((r) => r.action !== 'unchanged' || r.note),
    counts: { create: count('create'), update: count('update'), unchanged: count('unchanged'), error: count('error') },
  })
}
