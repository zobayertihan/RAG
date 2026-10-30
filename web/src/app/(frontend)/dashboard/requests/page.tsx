import { STUCK_DAYS, loadDashboard } from '@/lib/dashboard'
import { requireRole } from '@/lib/session'
import { RequestTable } from '../RequestTable'

const VIEWS = {
  assigned: 'Assignments',
  open: 'Open',
  stuck: `Waiting over ${STUCK_DAYS} days`,
  all: 'All',
} as const
type View = keyof typeof VIEWS

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { payload, user } = await requireRole('admin')
  const show = ((await searchParams).show || 'assigned') as View
  const view: View = show in VIEWS ? show : 'assigned'
  const { requests } = await loadDashboard(payload, user)
  const pick: Record<View, typeof requests> = {
    assigned: requests.filter((r) => r.status === 'accepted' && r.type === 'supervision'),
    open: requests.filter((r) => r.status === 'pending' || r.status === 'info_requested').sort((a, b) => b.waitingDays - a.waitingDays),
    stuck: requests.filter((r) => r.stuck).sort((a, b) => b.waitingDays - a.waitingDays),
    all: requests,
  }
  const rows = pick[view]
  return (
    <>
      <h1>Requests</h1>
      <p className="muted">Assignments are accepted supervision requests: which student is connected to which supervisor.</p>
      <nav className="tabs" aria-label="Request views">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <a key={v} href={`?show=${v}`} className={v === view ? 'on' : ''} aria-current={v === view ? 'page' : undefined}>
            {VIEWS[v]} ({pick[v].length})
          </a>
        ))}
      </nav>
      {rows.length ? <RequestTable rows={rows} /> : <p className="muted pad">Nothing here.</p>}
    </>
  )
}
