import { day } from '@/lib/dashboard'
import { financeOverview, type FinanceOverview } from '@/lib/python'
import { notFound } from 'next/navigation'

import { financeEnabled } from '@/lib/features'
import { requireRole } from '@/lib/session'

export const metadata = { title: 'Finance documents' }

const AUTHORITY: Record<string, string> = {
  state: 'Government circular', 'au-policy': 'AU policy', 'au-guidance': 'AU guidance page',
  'synthetic-policy': 'Synthetic test policy', 'synthetic-faq': 'Synthetic FAQ',
}
const STATUS_CLS: Record<string, string> = {
  'in force': 'pill good', current: 'pill good', replaced: 'pill', 'not yet in force': 'pill warn', 'file missing': 'pill bad',
}
const iso = (d?: string | null) => (d ? day(`${d}T12:00:00`) : '–')

export default async function FinancePage() {
  await requireRole('admin')
  if (!financeEnabled()) notFound()
  let data: FinanceOverview | null = null
  let error = ''
  try {
    data = await financeOverview()
  } catch (e) {
    error = (e as Error).message
  }
  const families = data ? [...new Set(data.documents.map((d) => d.family))] : []
  const review = data?.faqs.filter((f) => f.status === 'needs review') ?? []
  return (
    <>
      <h1>Finance</h1>
      <p className="muted">
        The documents behind travel and expense answers, and the FAQ entries whose rule has changed since they were
        decided. Documents and their dates are listed in <code>data/finance/sources.json</code>.{' '}
        <a href="/dashboard/finance/ask">Ask a question and compare the search systems</a>.
      </p>
      {error && <p className="error">The search service didn&apos;t answer: {error}</p>}
      {data && (
        <>
          <div className="tiles">
            <div className="tile"><strong>{data.documents.filter((d) => d.status !== 'file missing').length}</strong><span>documents indexed</span></div>
            <div className={`tile${data.documents.some((d) => d.status === 'file missing') ? ' alert' : ''}`}>
              <strong>{data.documents.filter((d) => d.status === 'file missing').length}</strong><span>listed but file missing</span>
            </div>
            <div className={`tile${review.length ? ' alert' : ''}`}><strong>{review.length}</strong><span>FAQ entries need review</span></div>
            <div className="tile"><strong>{data.faqs.length - review.length}</strong><span>FAQ entries still valid</span></div>
          </div>

          <h2>FAQ review</h2>
          <p className="muted">
            An FAQ entry needs review when the rule it answers reads differently in the version in force today
            ({iso(data.today)}) than in the version it was decided under. It stays stored; search leaves it out of the evidence.
          </p>
          {review.length === 0 ? <p className="muted pad">Nothing to review.</p> : (
            <ul className="changes">
              {review.map((f) => (
                <li key={f.faq_id} className="change">
                  <div className="change-head">
                    <strong>{f.faq_id}</strong>
                    <span className="sub">rule {f.rule_id} · decided {iso(f.decided_at)} under {f.based_on} · now {f.current_version}</span>
                    {f.synthetic && <span className="demo">synthetic</span>}
                  </div>
                  <p>{f.text.replace(/^FAQ \S+ \([^)]*\): /, '')}</p>
                  <ul className="diff">
                    <li><span className="field">Rule then ({f.based_on})</span><del>{f.old_rule}</del></li>
                    <li><span className="field">Rule now ({f.current_version})</span><ins>{f.current_rule ?? 'removed'}</ins></li>
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <h2>Documents</h2>
          {families.map((fam) => (
            <div key={fam} className="table-wrap fam">
              <table className="dt">
                <thead><tr><th>Document</th><th>Type</th><th>Published</th><th>In force from</th><th>Status today</th></tr></thead>
                <tbody>
                  {data.documents.filter((d) => d.family === fam)
                    .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
                    .map((d) => (
                      <tr key={d.id}>
                        <td>
                          {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">{d.title}</a> : <strong>{d.title}</strong>}
                          {d.supersedes?.length ? <div className="sub">replaces {d.supersedes.join(', ')}</div> : null}
                          {d.note && <div className="sub">{d.note}</div>}
                        </td>
                        <td>{AUTHORITY[d.authority] ?? d.authority}{d.language === 'da' ? <div className="sub">Danish</div> : null}</td>
                        <td>{iso(d.published_at)}{d.captured_at ? <div className="sub">saved {iso(d.captured_at)}</div> : null}</td>
                        <td>{iso(d.effective_from)}</td>
                        <td><span className={STATUS_CLS[d.status] ?? 'pill'}>{d.status}</span></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </>
  )
}
