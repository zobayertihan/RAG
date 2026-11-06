import { SUPERVISOR_POSITIONS, day } from '@/lib/dashboard'
import { searchSupervisors } from '@/lib/python'
import { requireRole } from '@/lib/session'
import { AssignForm, type Option } from './AssignForm'

/**
 * Students who asked the thesis coordinator to find a supervisor (at BTECH the coordinator
 * assigns supervisors based on topic and capacity). Search suggests who fits; the coordinator
 * decides. The chosen supervisor then gets a normal request to accept or decline.
 */
export default async function CoordinatorPage() {
  const { payload, user } = await requireRole('admin')
  const [waiting, assigned, sups] = await Promise.all([
    payload.find({ collection: 'requests', depth: 1, limit: 200, sort: 'createdAt', overrideAccess: false, user,
      where: { and: [{ type: { equals: 'coordinator' } }, { supervisor: { exists: false } }, { status: { in: ['pending', 'info_requested'] } }] } }),
    payload.find({ collection: 'requests', depth: 1, limit: 20, sort: '-updatedAt', overrideAccess: false, user,
      where: { viaCoordinator: { equals: true } } }),
    payload.find({ collection: 'supervisors', depth: 0, limit: 5000, pagination: false, sort: 'name', overrideAccess: false, user }),
  ])
  const eligible = sups.docs.filter((s) => SUPERVISOR_POSITIONS.has(s.position))
  const option = (s: (typeof eligible)[number]): Option => ({
    id: s.id, name: s.name, position: s.position,
    slots: typeof s.capacity === 'number' ? `${Math.max(0, s.capacity - (s.slotsUsed ?? 0))} of ${s.capacity} slots open` : 'slots not set',
    full: typeof s.capacity === 'number' && (s.slotsUsed ?? 0) >= s.capacity,
  })
  const byRecord = new Map(eligible.map((s) => [s.recordId, s]))
  const all = eligible.map(option)

  const items = await Promise.all(waiting.docs.map(async (r) => {
    const st = typeof r.student === 'object' ? r.student : null
    const text = [r.note, ...(st?.interests || []).map((i: { value: string }) => i.value)].join('. ')
    let suggestions: (Option & { score: number })[] = []
    let searchError = ''
    try {
      const { matches } = await searchSupervisors(text)
      suggestions = matches.flatMap((m) => (byRecord.get(m.record_id) ? [{ ...option(byRecord.get(m.record_id)!), score: m.score }] : []))
    } catch (e) {
      searchError = (e as Error).message
    }
    return { r, st, suggestions, searchError }
  }))

  return (
    <>
      <h1>Coordinator</h1>
      <p className="muted">
        Students who asked the thesis coordinator to find a supervisor. Search suggests who fits their note; you decide.
        The supervisor you choose gets it as a normal supervision request to accept or decline, with your reason attached.
      </p>
      {items.length === 0 ? <p className="muted pad">Nobody is waiting.</p> : (
        <ul className="changes">
          {items.map(({ r, st, suggestions, searchError }) => (
            <li key={r.id} className="change coord-item">
              <div className="change-head">
                <strong>{st?.name ?? 'Student'}</strong>
                <span className="sub">{st?.programme} · asked {day(r.createdAt)}</span>
                {r.synthetic && <span className="demo">demo</span>}
              </div>
              {r.noteSummary && <p className="summary"><span>Summary</span>{r.noteSummary}</p>}
              <p className="req-note">{r.note}</p>
              {!!st?.skills?.length && <ul className="chips">{st.skills.map((s: { value: string }) => <li key={s.value}>{s.value}</li>)}</ul>}
              {searchError && <p className="error">Suggestions unavailable: {searchError}</p>}
              <AssignForm requestId={r.id} suggestions={suggestions.slice(0, 5)} all={all} />
            </li>
          ))}
        </ul>
      )}

      <h2>Recently suggested by the coordinator</h2>
      {assigned.docs.length === 0 ? <p className="muted pad">None yet.</p> : (
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>Student</th><th>Suggested supervisor</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              {assigned.docs.map((r) => (
                <tr key={r.id}>
                  <td>{typeof r.student === 'object' ? r.student?.name : ''}</td>
                  <td>{typeof r.supervisor === 'object' ? r.supervisor?.name : ''}</td>
                  <td><span className={r.status === 'accepted' ? 'pill good' : r.status === 'rejected' ? 'pill bad' : 'pill'}>
                    {r.status === 'accepted' ? 'Accepted' : r.status === 'rejected' ? 'Declined' : r.status === 'info_requested' ? 'Details asked' : 'Waiting for the supervisor'}</span></td>
                  <td className="sub">{r.coordinatorNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
