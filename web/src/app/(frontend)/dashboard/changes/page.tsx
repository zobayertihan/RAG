import { day } from '@/lib/dashboard'
import { requireRole } from '@/lib/session'

const LABEL: Record<string, string> = {
  name: 'Name', position: 'Position', interests: 'Research areas', requirements: 'Expectations', capacity: 'Slots',
  type: 'Type', researchGroup: 'Research group', room: 'Room', email: 'Email', profileUrl: 'Profile link',
}

function Value({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === '') return <span className="sub">empty</span>
  return <>{Array.isArray(v) ? v.join(', ') : String(v)}</>
}

/** Lists show what was removed and added; other fields show old → new. */
function Change({ field, from, to }: { field: string; from: unknown; to: unknown }) {
  if (Array.isArray(from) || Array.isArray(to)) {
    const a = (from as string[]) || [], b = (to as string[]) || []
    const removed = a.filter((x) => !b.includes(x)), added = b.filter((x) => !a.includes(x))
    return (
      <li><span className="field">{LABEL[field] ?? field}</span>
        {removed.map((x) => <del key={`-${x}`}>{x}</del>)}
        {added.map((x) => <ins key={`+${x}`}>{x}</ins>)}
        {!removed.length && !added.length && <span className="sub">order changed</span>}
      </li>
    )
  }
  return <li><span className="field">{LABEL[field] ?? field}</span><del><Value v={from} /></del> → <ins><Value v={to} /></ins></li>
}

export default async function ChangesPage() {
  const { payload, user } = await requireRole('admin')
  const { docs } = await payload.find({ collection: 'profile-versions', sort: '-createdAt', depth: 1, limit: 200, overrideAccess: false, user })
  return (
    <>
      <h1>Changes</h1>
      <p className="muted">Every supervisor profile change, newest first. The old values are kept; search uses the new ones right away.</p>
      {docs.length === 0 ? <p className="muted pad">No profile has changed since the import.</p> : (
        <ul className="changes">
          {docs.map((v) => {
            const sup = typeof v.supervisor === 'object' ? v.supervisor : null
            const by = typeof v.changedBy === 'object' ? v.changedBy : null
            const changes = (v.changes || null) as Record<string, { from: unknown; to: unknown }> | null
            return (
              <li key={v.id} className="change">
                <div className="change-head">
                  <a href={sup ? `/admin/collections/supervisors/${sup.id}` : undefined}>{sup?.name ?? 'Supervisor'}</a>
                  <span className="sub">{day(v.createdAt)}, {new Date(v.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · by {by?.name || by?.email || 'unknown'}</span>
                </div>
                {changes ? (
                  <ul className="diff">{Object.entries(changes).map(([f, c]) => <Change key={f} field={f} from={c.from} to={c.to} />)}</ul>
                ) : (
                  <p className="sub">Changed: {v.changedFields}. (Saved before old and new values were both recorded.)</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
