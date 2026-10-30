import { STALE_DAYS, day, loadDashboard, type SupRow } from '@/lib/dashboard'
import { requireRole } from '@/lib/session'

const VIEWS = {
  all: 'All',
  slots: 'Slots set',
  full: 'Full',
  none: 'No requests',
  stale: 'Profile flagged',
  notset: 'No slots set',
} as const
type View = keyof typeof VIEWS
const FILTER: Record<View, (s: SupRow) => boolean> = {
  all: () => true, slots: (s) => s.capacity !== null, full: (s) => s.full, none: (s) => s.noRequests, stale: (s) => s.stale, notset: (s) => s.slotsNotSet,
}

function Slots({ s }: { s: SupRow }) {
  if (s.capacity === null) return <span className="sub">{s.used ? `${s.used} accepted, ` : ''}not set</span>
  const pct = s.capacity ? Math.min(100, (s.used / s.capacity) * 100) : 100
  return (
    <span className="slots">
      <span className="bar" aria-hidden="true"><span style={{ width: `${pct}%` }} className={s.full ? 'full' : undefined} /></span>
      {s.used} of {s.capacity}
    </span>
  )
}

export default async function SupervisorsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { payload, user } = await requireRole('admin')
  const show = ((await searchParams).show || 'all') as View
  const view: View = show in VIEWS ? show : 'all'
  const { eligible } = await loadDashboard(payload, user)
  const rows = eligible.filter(FILTER[view]).sort((a, b) => Number(b.full) - Number(a.full) || b.open - a.open || a.name.localeCompare(b.name))
  return (
    <>
      <h1>Supervisors</h1>
      <p className="muted">
        Slots and profile freshness for everyone who can supervise. A profile is flagged when it has no research areas
        (search can&apos;t find the person) or hasn&apos;t changed for {STALE_DAYS} days. Click a name to edit.
      </p>
      <nav className="tabs" aria-label="Supervisor views">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <a key={v} href={`?show=${v}`} className={v === view ? 'on' : ''} aria-current={v === view ? 'page' : undefined}>
            {VIEWS[v]} ({eligible.filter(FILTER[v]).length})
          </a>
        ))}
      </nav>
      {rows.length ? (
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr><th>Name</th><th>Slots used</th><th className="num">Open</th><th className="num">All requests</th><th>Profile changed</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><a href={`/admin/collections/supervisors/${s.id}`}>{s.name}</a><div className="sub">{s.position}{s.researchGroup ? ` · ${s.researchGroup}` : ''}</div></td>
                  <td><Slots s={s} /></td>
                  <td className="num">{s.open}</td>
                  <td className="num">{s.total}</td>
                  <td>{s.profileUpdatedAt ? day(s.profileUpdatedAt) : <span className="sub">unknown</span>}</td>
                  <td className="flags">
                    {s.full && <span className="pill bad">Full</span>}
                    {s.interests === 0 && <span className="pill warn">No research areas</span>}
                    {s.interests > 0 && s.stale && <span className="pill warn">Not changed {s.ageDays === null ? 'yet' : `in ${s.ageDays} d`}</span>}
                    {s.noRequests && <span className="pill">No requests</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted pad">Nobody here.</p>}
    </>
  )
}
