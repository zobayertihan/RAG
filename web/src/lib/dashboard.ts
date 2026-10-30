/**
 * Numbers for the admin dashboard, computed from the database on each page load.
 * Small data (about 100 supervisors), so everything is read once and counted here.
 */
import type { Payload } from 'payload'

import type { SessionUser } from './session'

// Same list as SUPERVISOR_POSITIONS in rag.py: only these positions can supervise.
export const SUPERVISOR_POSITIONS = new Set([
  'Distinguished Professor', 'Professor', 'Professor (Docent)', 'Associate Professor', 'Assistant Professor', 'Postdoc',
])
export const STUCK_DAYS = 7 // a request waiting longer than this needs attention
export const STALE_DAYS = 180 // a profile not changed for this long is flagged
export const GAP_THRESHOLD = 0.62 // see the demand page: no-fit topics scored 0.59 to 0.62 in the Phase 2 eval

const DAY = 86_400_000
export const daysSince = (d?: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY) : null)
export const day = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
export const isOpen = (s: string) => s === 'pending' || s === 'info_requested'
const rel = (v: unknown) => (v && typeof v === 'object' ? (v as { id: number }).id : (v as number))

export type SupRow = {
  id: number; recordId: string; name: string; position: string; researchGroup: string; email: string
  interests: number; capacity: number | null; used: number; open: number; total: number
  profileUpdatedAt: string | null; ageDays: number | null
  eligible: boolean; searchable: boolean
  full: boolean; noRequests: boolean; stale: boolean; slotsNotSet: boolean
}
export type ReqRow = {
  id: number; status: string; type: string; createdAt: string; answeredAt: string | null; waitingDays: number
  stuck: boolean; synthetic: boolean
  student: { id: number; name: string; programme: string }; supervisor: { id: number; name: string }
}

export async function loadDashboard(payload: Payload, user: SessionUser) {
  const opts = { depth: 0, limit: 5000, pagination: false, overrideAccess: false, user } as const
  const [sups, reqs, studs] = await Promise.all([
    payload.find({ collection: 'supervisors', ...opts, sort: 'name' }),
    payload.find({ collection: 'requests', ...opts, sort: '-createdAt' }),
    payload.find({ collection: 'students', ...opts }),
  ])
  const supName = new Map(sups.docs.map((s) => [s.id, s.name]))
  const stu = new Map(studs.docs.map((s) => [s.id, s]))

  const requests: ReqRow[] = reqs.docs.map((r) => {
    const s = stu.get(rel(r.student))
    const waitingDays = daysSince(r.createdAt) ?? 0
    return {
      id: r.id, status: r.status, type: r.type, createdAt: r.createdAt, answeredAt: r.answeredAt || null, waitingDays,
      stuck: isOpen(r.status) && waitingDays > STUCK_DAYS, synthetic: !!r.synthetic,
      student: { id: rel(r.student), name: s?.name ?? 'Unknown student', programme: s?.programme ?? '' },
      supervisor: { id: rel(r.supervisor), name: supName.get(rel(r.supervisor)) ?? 'Unknown supervisor' },
    }
  })

  const bySup = new Map<number, ReqRow[]>()
  for (const r of requests) bySup.set(r.supervisor.id, [...(bySup.get(r.supervisor.id) || []), r])

  const supervisors: SupRow[] = sups.docs.map((s) => {
    const rs = bySup.get(s.id) || []
    const used = rs.filter((r) => r.status === 'accepted' && r.type === 'supervision').length
    const capacity = typeof s.capacity === 'number' ? s.capacity : null
    const interests = (s.interests || []).length
    const eligible = SUPERVISOR_POSITIONS.has(s.position)
    const searchable = eligible && interests > 0
    const ageDays = daysSince(s.profileUpdatedAt)
    return {
      id: s.id, recordId: s.recordId, name: s.name, position: s.position, researchGroup: s.researchGroup || '', email: s.email || '',
      interests, capacity, used, open: rs.filter((r) => isOpen(r.status)).length, total: rs.length,
      profileUpdatedAt: s.profileUpdatedAt || null, ageDays, eligible, searchable,
      full: capacity !== null && used >= capacity,
      noRequests: searchable && rs.length === 0,
      stale: eligible && (interests === 0 || ageDays === null || ageDays > STALE_DAYS),
      slotsNotSet: eligible && capacity === null,
    }
  })
  return { supervisors, requests, eligible: supervisors.filter((s) => s.eligible) }
}
