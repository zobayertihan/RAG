import { toCsv } from '@/lib/csv'
import { getSession } from '@/lib/session'
import { COLUMNS, EXPORT_ONLY, listCell } from '@/lib/supervisorCsv'

export async function GET() {
  const { payload, user } = await getSession()
  if (!user || user.role !== 'admin') return new Response('Sign in as an admin.', { status: 401 })
  const { docs } = await payload.find({ collection: 'supervisors', sort: 'name', depth: 0, limit: 5000, pagination: false, overrideAccess: false, user })
  const rows = docs.map((s) => [
    s.recordId, s.name, s.position, listCell(s.interests), listCell(s.requirements), s.capacity ?? '', s.type || '',
    s.researchGroup || '', s.room || '', s.email || '', s.profileUrl || '', s.slotsUsed ?? 0, s.profileUpdatedAt?.slice(0, 10) || '',
  ])
  const date = new Date().toISOString().slice(0, 10)
  return new Response('﻿' + toCsv([[...COLUMNS, ...EXPORT_ONLY], ...rows]), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="supervisors-${date}.csv"` },
  })
}
