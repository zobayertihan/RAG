import { idOf, requireRole } from '@/lib/session'
import { RequestList, type RequestItem } from './RequestList'

export default async function SupervisorPage() {
  const { payload, user } = await requireRole('supervisor')
  const supervisorId = idOf(user.supervisor)
  if (!supervisorId) {
    return <div className="page"><h1>Requests</h1><p className="error">This login isn&apos;t linked to a supervisor record yet. Ask the admin to link it.</p></div>
  }
  const [sup, { docs }] = await Promise.all([
    payload.findByID({ collection: 'supervisors', id: supervisorId, depth: 0, overrideAccess: false, user }),
    payload.find({ collection: 'requests', where: { supervisor: { equals: supervisorId } }, sort: '-createdAt', depth: 1, limit: 200, overrideAccess: false, user }),
  ])
  const items: RequestItem[] = docs.map((r) => {
    const st = typeof r.student === 'object' ? r.student : null
    return {
      id: r.id, type: r.type, status: r.status, note: r.note, summary: r.noteSummary || '',
      createdAt: r.createdAt, answeredAt: r.answeredAt || null,
      student: { name: st?.name ?? 'Student', email: st?.email ?? '', programme: st?.programme ?? '',
        skills: (st?.skills || []).map((s: { value: string }) => s.value) },
    }
  })
  const open = items.filter((i) => i.status === 'pending' || i.status === 'info_requested').length
  const used = sup.slotsUsed ?? 0
  return (
    <div className="page">
      <h1>Requests</h1>
      <div className="stats">
        <div><strong>{open}</strong><span>open requests</span></div>
        <div>
          <strong>{typeof sup.capacity === 'number' ? `${used} of ${sup.capacity}` : used}</strong>
          <span>{typeof sup.capacity === 'number' ? 'supervision slots used' : 'supervisions accepted (slots not set)'}</span>
        </div>
      </div>
      <RequestList items={items} />
    </div>
  )
}
