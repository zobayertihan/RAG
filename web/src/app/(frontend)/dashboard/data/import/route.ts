import { NextResponse } from 'next/server'

import { parseCsv } from '@/lib/csv'
import { getSession } from '@/lib/session'
import { COLUMNS, diffFields, rowToData } from '@/lib/supervisorCsv'

const MAX_ROWS = 1000

type Row = { line: number; recordId: string; name: string; action: 'create' | 'update' | 'unchanged' | 'error'; fields: string[]; error?: string }

/**
 * Two steps: { csv, apply: false } returns what would change; { csv, apply: true } saves it.
 * Each saved change goes through the normal hooks, so it is versioned and search is updated.
 */
export async function POST(req: Request) {
  const { payload, user } = await getSession()
  if (!user || user.role !== 'admin') return NextResponse.json({ detail: 'Sign in as an admin.' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (typeof body?.csv !== 'string') return NextResponse.json({ detail: 'No CSV text.' }, { status: 400 })

  const [rawHeader, ...lines] = parseCsv(body.csv)
  const header = (rawHeader || []).map((h) => h.trim().toLowerCase())
  if (!header.includes('record_id')) {
    return NextResponse.json({ detail: `The first row must be the column names and include record_id. Known columns: ${COLUMNS.join(', ')}.` }, { status: 400 })
  }
  if (lines.length > MAX_ROWS) return NextResponse.json({ detail: `At most ${MAX_ROWS} rows at a time.` }, { status: 400 })
  const unknown = header.filter((h) => h && !(COLUMNS as readonly string[]).includes(h) && h !== 'slots_used' && h !== 'profile_updated_at')

  const { docs } = await payload.find({ collection: 'supervisors', depth: 0, limit: 5000, pagination: false, overrideAccess: false, user })
  const byId = new Map(docs.map((d) => [d.recordId, d]))
  const seen = new Set<string>()
  const rows: Row[] = []

  for (const [i, cells] of lines.entries()) {
    const { recordId, data, error } = rowToData(header, cells)
    const existing = byId.get(recordId)
    const name = String(data.name ?? existing?.name ?? '')
    const row: Row = { line: i + 2, recordId, name, action: 'unchanged', fields: [] }
    if (error) { rows.push({ ...row, action: 'error', error }); continue }
    if (seen.has(recordId)) { rows.push({ ...row, action: 'error', error: 'record_id appears twice in the file' }); continue }
    seen.add(recordId)
    if (!existing) {
      if (!data.name || !data.position) { rows.push({ ...row, action: 'error', error: 'a new supervisor needs name and position' }); continue }
      row.action = 'create'
      row.fields = Object.keys(data)
    } else {
      row.fields = diffFields(existing as unknown as Record<string, unknown>, data)
      row.action = row.fields.length ? 'update' : 'unchanged'
    }
    if (body.apply && (row.action === 'create' || row.action === 'update')) {
      try {
        if (row.action === 'create') {
          await payload.create({ collection: 'supervisors', data: { recordId, ...data } as never, overrideAccess: false, user })
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
  const count = (a: Row['action']) => rows.filter((r) => r.action === a).length
  return NextResponse.json({
    applied: !!body.apply, unknownColumns: unknown, rows: rows.filter((r) => r.action !== 'unchanged'),
    counts: { create: count('create'), update: count('update'), unchanged: count('unchanged'), error: count('error') },
  })
}
