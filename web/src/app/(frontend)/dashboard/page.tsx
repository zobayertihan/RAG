import { GAP_THRESHOLD, STALE_DAYS, STUCK_DAYS, loadDashboard } from '@/lib/dashboard'
import { requireRole } from '@/lib/session'
import { RequestTable } from './RequestTable'

export default async function Overview() {
  const { payload, user } = await requireRole('admin')
  const { eligible, requests } = await loadDashboard(payload, user)
  const [weak, demo] = await Promise.all([
    payload.count({ collection: 'query-logs', where: { bestScore: { less_than: GAP_THRESHOLD } }, overrideAccess: false, user }),
    payload.count({ collection: 'requests', where: { synthetic: { equals: true } }, overrideAccess: false, user }),
  ])

  const open = requests.filter((r) => r.status === 'pending' || r.status === 'info_requested')
  const stuck = requests.filter((r) => r.stuck)
  const withSlots = eligible.filter((s) => s.capacity !== null)
  const slotsTotal = withSlots.reduce((n, s) => n + (s.capacity ?? 0), 0)
  const slotsUsed = withSlots.reduce((n, s) => n + s.used, 0)
  const full = eligible.filter((s) => s.full)
  const noReq = eligible.filter((s) => s.noRequests)
  const stale = eligible.filter((s) => s.stale)
  const notSet = eligible.filter((s) => s.slotsNotSet)

  return (
    <>
      <h1>Overview</h1>
      <p className="muted">
        {eligible.length} people who can supervise, {requests.length} requests.
        {demo.totalDocs > 0 && <> <span className="pill warn">Demo data</span> {demo.totalDocs} of the requests are made up by the demo seed.</>}
      </p>

      <div className="tiles">
        <a className="tile" href="/dashboard/requests?show=open"><strong>{open.length}</strong><span>open requests</span></a>
        <a className={`tile${stuck.length ? ' alert' : ''}`} href="/dashboard/requests?show=stuck"><strong>{stuck.length}</strong><span>waiting over {STUCK_DAYS} days</span></a>
        <a className="tile" href="/dashboard/supervisors?show=slots">
          <strong>{slotsUsed} of {slotsTotal}</strong><span>slots used ({withSlots.length} supervisors with slots set)</span>
        </a>
        <a className="tile" href="/dashboard/demand"><strong>{weak.totalDocs}</strong><span>searches with a weak best match</span></a>
      </div>

      <h2>Needs attention</h2>
      <ul className="attention">
        <li><a href="/dashboard/requests?show=stuck"><strong>{stuck.length}</strong> requests have waited more than {STUCK_DAYS} days for an answer</a></li>
        <li><a href="/dashboard/supervisors?show=full"><strong>{full.length}</strong> supervisors are full</a></li>
        <li><a href="/dashboard/supervisors?show=none"><strong>{noReq.length}</strong> searchable supervisors have had no requests</a></li>
        <li><a href="/dashboard/supervisors?show=stale"><strong>{stale.length}</strong> profiles are empty or unchanged for over {STALE_DAYS} days</a></li>
        <li><a href="/dashboard/supervisors?show=notset"><strong>{notSet.length}</strong> supervisors have no slots set for this semester</a></li>
      </ul>

      <h2>Waiting longest</h2>
      {stuck.length ? <RequestTable rows={stuck.slice(0, 8)} /> : <p className="muted">No request has waited more than {STUCK_DAYS} days.</p>}
    </>
  )
}
