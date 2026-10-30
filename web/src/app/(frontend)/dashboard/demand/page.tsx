import { GAP_THRESHOLD, day } from '@/lib/dashboard'
import { queryGaps } from '@/lib/python'
import { requireRole } from '@/lib/session'

type Topic = { label: string; queries: string[]; count: number; loggedBest: number; bestNow: number | null; bestNowName: string | null; last: string }

const f2 = (n: number | null) => (n === null ? '–' : n.toFixed(2))

export default async function DemandPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { payload, user } = await requireRole('admin')
  const asked = Number((await searchParams).t)
  const t = asked >= 0.3 && asked <= 0.95 ? asked : GAP_THRESHOLD

  const { docs } = await payload.find({
    collection: 'query-logs', where: { mode: { equals: 'supervisors' } }, sort: '-createdAt',
    depth: 0, limit: 5000, pagination: false, overrideAccess: false, user,
  })
  const scored = docs.filter((d) => typeof d.bestScore === 'number')
  const weak = scored.filter((d) => (d.bestScore as number) < t)
  const synthetic = docs.filter((d) => d.synthetic).length

  // one entry per distinct query text, with how often it was asked
  const byText = new Map<string, { n: number; best: number; last: string }>()
  for (const d of weak) {
    const k = d.query.trim().toLowerCase()
    const e = byText.get(k)
    byText.set(k, e ? { n: e.n + 1, best: Math.max(e.best, d.bestScore as number), last: e.last > d.createdAt ? e.last : d.createdAt }
      : { n: 1, best: d.bestScore as number, last: d.createdAt })
  }
  const texts = [...byText.keys()]

  let topics: Topic[] = []
  let grouped = true
  try {
    const { groups } = texts.length ? await queryGaps(texts) : { groups: [] }
    topics = groups.map((g) => {
      const qs = g.members.map((i) => texts[i])
      const es = qs.map((q) => byText.get(q)!)
      return {
        label: g.label, queries: qs, count: es.reduce((n, e) => n + e.n, 0), loggedBest: Math.max(...es.map((e) => e.best)),
        bestNow: g.best_now, bestNowName: g.best_now_name, last: es.map((e) => e.last).sort().at(-1)!,
      }
    })
  } catch {
    grouped = false // Python is not running: show each distinct query on its own
    topics = texts.map((q) => ({ label: q, queries: [q], count: byText.get(q)!.n, loggedBest: byText.get(q)!.best, bestNow: null, bestNowName: null, last: byText.get(q)!.last }))
  }
  topics.sort((a, b) => b.count - a.count || a.loggedBest - b.loggedBest)

  return (
    <>
      <h1>Demand</h1>
      <p className="muted">
        What students searched for where even the best supervisor was a weak match, grouped into topics.
        These are candidates to review, not proof of a gap: in the Phase 2 test set, topics nobody covers scored 0.59 to 0.62,
        but a few good matches also scored below 0.62. Queries are stored without who asked.
      </p>
      <div className="tiles">
        <div className="tile"><strong>{docs.length}</strong><span>searches logged{synthetic ? ` (${synthetic} made up by the demo seed)` : ''}</span></div>
        <div className="tile"><strong>{weak.length}</strong><span>best match below {t.toFixed(2)}</span></div>
        <div className="tile"><strong>{topics.length}</strong><span>topics</span></div>
      </div>
      <form className="threshold" method="get">
        <label htmlFor="t">Weak below</label>
        <input id="t" name="t" type="number" step="0.01" min="0.3" max="0.95" defaultValue={t.toFixed(2)} />
        <button className="ghost">Update</button>
      </form>
      {!grouped && <p className="error">The search service is not reachable, so queries are not grouped and today&apos;s scores are missing.</p>}
      {topics.length === 0 ? <p className="muted pad">No weak searches.</p> : (
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>Topic</th><th className="num">Searches</th><th className="num">Best when asked</th><th>Best match today</th><th>Last asked</th></tr></thead>
            <tbody>
              {topics.map((g) => (
                <tr key={g.label}>
                  <td><strong>{g.label}</strong>{g.queries.length > 1 && <div className="sub">also: {g.queries.slice(1, 5).join(' · ')}{g.queries.length > 5 ? ` · +${g.queries.length - 5}` : ''}</div>}</td>
                  <td className="num">{g.count}</td>
                  <td className="num">{f2(g.loggedBest)}</td>
                  <td>
                    {g.bestNow === null ? '–' : <>
                      <span className="num-inline">{f2(g.bestNow)}</span> {g.bestNowName}
                      {g.bestNow >= t && <span className="pill good">better now</span>}
                    </>}
                  </td>
                  <td>{day(g.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
