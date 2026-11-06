import { toCsv } from '@/lib/csv'
import { getSession } from '@/lib/session'
import { COLUMNS, EXPORT_ONLY, listCell } from '@/lib/supervisorCsv'

const list = (rows: unknown) =>
  Array.isArray(rows) ? rows.map((r) => String((r as { value?: string }).value ?? '').trim()).filter(Boolean) : []

/** All supervisors as CSV (default) or, with ?format=json, in the format of data/supervisors.json. */
export async function GET(req: Request) {
  const { payload, user } = await getSession()
  if (!user || user.role !== 'admin') return new Response('Sign in as an admin.', { status: 401 })
  const { docs } = await payload.find({ collection: 'supervisors', sort: 'name', depth: 0, limit: 5000, pagination: false, overrideAccess: false, user })
  const date = new Date().toISOString().slice(0, 10)

  if (new URL(req.url).searchParams.get('format') === 'json') {
    const records = [...docs].sort((a, b) => a.recordId.localeCompare(b.recordId, 'en', { numeric: true })).map((s) => ({
      id: s.recordId, name: s.name, position: s.position, interests: list(s.interests), profile_url: s.profileUrl || '',
      email: s.email || '', room: s.room || '', research_group: s.researchGroup || '', type: s.type || '',
      requirements: list(s.requirements), capacity: s.capacity ?? null, updated_at: s.profileUpdatedAt?.slice(0, 10) || null,
    }))
    return new Response(JSON.stringify(records, null, 2) + '\n', {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="supervisors-${date}.json"` },
    })
  }

  const rows = docs.map((s) => [
    s.recordId, s.name, s.position, listCell(s.interests), listCell(s.requirements), s.capacity ?? '', s.type || '',
    s.researchGroup || '', s.room || '', s.email || '', s.profileUrl || '', s.slotsUsed ?? 0, s.profileUpdatedAt?.slice(0, 10) || '',
  ])
  return new Response('﻿' + toCsv([[...COLUMNS, ...EXPORT_ONLY], ...rows]), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="supervisors-${date}.csv"` },
  })
}
