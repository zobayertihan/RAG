import { idOf, requireRole } from '@/lib/session'

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Waiting for an answer', cls: 'pill' },
  info_requested: { label: 'More details asked', cls: 'pill warn' },
  accepted: { label: 'Accepted', cls: 'pill good' },
  rejected: { label: 'Declined', cls: 'pill bad' },
}
const TYPE: Record<string, string> = { discuss: 'Discuss an idea', supervision: 'Supervision' }
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

export default async function MyRequestsPage() {
  const { payload, user } = await requireRole('student', 'admin')
  const studentId = idOf(user.student)
  const { docs } = await payload.find({
    collection: 'requests',
    where: studentId ? { student: { equals: studentId } } : {},
    sort: '-createdAt',
    depth: 1,
    limit: 100,
    overrideAccess: false,
    user,
  })
  const open = docs.filter((d) => d.status === 'pending' || d.status === 'info_requested').length

  return (
    <div className="page">
      <h1>My requests</h1>
      <p className="muted">{open} of 3 open requests used. You can send a new one when a supervisor has answered.</p>
      {docs.length === 0 ? (
        <div className="empty-box">
          <p>You haven&apos;t contacted anyone yet.</p>
          <a className="btn" href="/student">Find supervisors</a>
        </div>
      ) : (
        <ul className="req-list">
          {docs.map((r) => {
            const sup = typeof r.supervisor === 'object' ? r.supervisor : null
            const st = STATUS[r.status] ?? { label: r.status, cls: 'pill' }
            return (
              <li key={r.id} className="req">
                <div className="req-head">
                  <div>
                    <h2>{sup?.name ?? 'Supervisor'}</h2>
                    <p className="muted">{TYPE[r.type] ?? r.type} · sent {day(r.createdAt)}{r.answeredAt ? ` · answered ${day(r.answeredAt)}` : ''}</p>
                  </div>
                  <span className={st.cls}>{st.label}</span>
                </div>
                <p className="req-note">{r.note}</p>
                {r.status === 'info_requested' && (
                  <p className="hint">{sup?.name ?? 'The supervisor'} asked for more details. Check your email for their message.</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
