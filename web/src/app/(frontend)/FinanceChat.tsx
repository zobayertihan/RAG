'use client'

import React, { useRef, useState } from 'react'

type Citation = {
  id: string; title: string; doc_id: string | null; version: string | null; authority: string | null
  synthetic: boolean; published_at: string | null; effective_from: string | null; captured_at: string | null
  page: number | null; section: string | null; url: string | null; snippet: string
}
type Stale = { faq_id: string; rule_id: string; based_on: string; current_version: string | null; reason: string; faq_text: string; current_rule: string | null; synthetic: boolean }
type Context = { event_date?: string | null; date_precision?: string | null; as_published_on?: string | null; doc_ref?: string | null }
type Reply = {
  message: string | null; status: 'answered' | 'depends' | 'not_found' | 'conflict' | 'search_only'; system: string
  citations: Citation[]; stale_faqs: Stale[]; context: Context; next_step: string | null; history: string
}
type Turn = { id: number; text: string; reply?: Reply; error?: string }
type Msg = { role: 'user' | 'assistant'; content: string }

export const SYSTEM_LABEL: Record<string, string> = {
  plain: 'Plain RAG (all versions)',
  newest: 'Newest document only',
  versioned: 'Version-aware',
  versioned_faq: 'Version-aware + FAQ check',
}
const STATUS: Record<string, { label: string; cls: string }> = {
  answered: { label: 'Answered from the sources', cls: 'pill good' },
  depends: { label: 'Depends on details', cls: 'pill warn' },
  conflict: { label: 'Outdated guidance found', cls: 'pill warn' },
  not_found: { label: 'Not found in the sources', cls: 'pill bad' },
  search_only: { label: 'Search only (no language model)', cls: 'pill' },
}
const AUTHORITY: Record<string, string> = {
  state: 'Government circular', 'au-policy': 'AU policy', 'au-guidance': 'AU guidance page',
  'synthetic-policy': 'Synthetic test policy', 'synthetic-faq': 'Synthetic FAQ',
}
type Corpus = 'real' | 'synthetic'
const EXAMPLES: Record<Corpus, string[]> = {
  real: [
    'What is the full daily allowance for a trip in Denmark in September 2026?',
    'What is the hotel allowance per night in Germany in June 2026, and was it different in 2025?',
    'What Danish hotel amount is printed in circular 006-26, and what does 007-26 say?',
  ],
  synthetic: [
    'What is the hotel limit in Denmark for a night on 20 September 2025?',
    'My train arrives at 00:30 on 5 April 2026 and buses still run. Can I take a taxi home without approval?',
    'I lost a receipt from a trip in May 2026. Can it still be reimbursed?',
  ],
}
const day = (d?: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

function contextLine(c: Context) {
  if (c.doc_ref) return `About document ${c.doc_ref}`
  if (c.as_published_on) return `What the documents said on ${day(c.as_published_on)}`
  if (c.event_date) return c.date_precision === 'year' ? `For ${c.event_date.slice(0, 4)} (only the year was given)` : `For a trip or expense on ${day(c.event_date)}`
  return 'No date given: based on the rules in force today'
}

export function FinanceChat({ showSystems = false, placeholder }: { showSystems?: boolean; placeholder?: string }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [history, setHistory] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const [system, setSystem] = useState('versioned_faq')
  const [corpus, setCorpus] = useState<Corpus>('real')
  const nextId = useRef(1)
  const endRef = useRef<HTMLDivElement>(null)

  async function ask(q: string) {
    if (!q.trim() || busy) return
    const id = nextId.current++
    const msgs: Msg[] = [...history, { role: 'user', content: q.trim() }]
    setTurns((t) => [...t, { id, text: q.trim() }])
    setText('')
    setBusy(true)
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50)
    const slowTimer = setTimeout(() => setSlow(true), 7000)
    try {
      const res = await fetch('/finance/chat', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs, system, corpus }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong.')
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, reply: data } : x)))
      setHistory([...msgs, { role: 'assistant', content: data.history }])
    } catch (err) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: (err as Error).message } : x)))
    } finally {
      clearTimeout(slowTimer)
      setSlow(false)
      setBusy(false)
    }
  }

  function switchCorpus(c: Corpus) {
    if (c === corpus) return
    setCorpus(c)
    setTurns([])
    setHistory([])
  }

  return (
    <>
      <section className="chat" aria-live="polite">
        <div className="corpus" role="radiogroup" aria-label="Which documents">
          <button type="button" role="radio" aria-checked={corpus === 'real'} className={corpus === 'real' ? 'on' : ''}
            onClick={() => switchCorpus('real')}>Real AU and government documents</button>
          <button type="button" role="radio" aria-checked={corpus === 'synthetic'} className={corpus === 'synthetic' ? 'on' : ''}
            onClick={() => switchCorpus('synthetic')}>Demonstration policy (synthetic)</button>
        </div>
        {corpus === 'synthetic' && (
          <p className="hint synth-note">
            A made-up policy with four versions and outdated FAQ answers, built to test how the assistant handles
            changing rules. Nothing here is real Aarhus University policy.
          </p>
        )}
        {showSystems && (
          <div className="system-pick">
            <label htmlFor="system">Search system</label>
            <select id="system" value={system} onChange={(e) => setSystem(e.target.value)}>
              {Object.entries(SYSTEM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="hint">For comparing the systems. Students and supervisors always get the last one.</span>
          </div>
        )}
        {turns.length === 0 && (
          <div className="empty">
            <h1>Travel and expense questions</h1>
            <p>
              Ask about hotels, taxis, allowances, receipts or settlement. Say when the trip or expense happens:
              the rules change over time, and the answer depends on the date.
            </p>
            <div className="examples">
              {EXAMPLES[corpus].map((e) => <button key={e} type="button" className="ghost" onClick={() => ask(e)}>{e}</button>)}
            </div>
          </div>
        )}
        {turns.map((t) => (
          <div className="turn" key={t.id}>
            <div className="you"><div>{t.text}</div></div>
            <div className="reply">
              {!t.reply && !t.error && <div className="typing" aria-label="Looking it up"><span /><span /><span /></div>}
              {!t.reply && !t.error && slow && (
                <p className="hint" role="status">Waking up the search service. After a quiet period this takes up to a minute.</p>
              )}
              {t.error && <p className="error">Couldn&apos;t get an answer. {t.error}</p>}
              {t.reply && <FinanceReply r={t.reply} turn={t.id} showSystem={showSystems} />}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </section>

      <form className="composer-wrap" onSubmit={(e) => { e.preventDefault(); ask(text) }}>
        <div className="composer">
          <textarea id="fq" rows={1} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text) } }}
            placeholder={placeholder || 'For example: Can I take a taxi from the airport on 3 March 2026?'} aria-label="Your question" />
          <button className="send" disabled={busy || !text.trim()}>Send</button>
        </div>
        <p className="hint center">
          A research prototype, not official AU advice. Answers come from government circulars, AU pages and a synthetic
          test policy. Check the source before you rely on it.
        </p>
      </form>
    </>
  )
}

/** "[S1]" in the answer becomes a link to that source in the list below. */
function withRefs(text: string, turn: number, ids: Set<string>) {
  return text.split(/(\[S\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(S\d+)\]$/)
    if (!m) return <React.Fragment key={i}>{part}</React.Fragment>
    return ids.has(m[1])
      ? <a key={i} className="ref" href={`#t${turn}-${m[1]}`}>{m[1].slice(1)}</a>
      : null // a marker for a source that isn't shown: leave it out rather than link nowhere
  })
}

function FinanceReply({ r, turn, showSystem }: { r: Reply; turn: number; showSystem: boolean }) {
  const st = STATUS[r.status] ?? STATUS.answered
  const ids = new Set(r.citations.map((c) => c.id))
  const paras = (r.message || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  return (
    <div className="fin">
      <div className="fin-meta">
        <span className={st.cls}>{st.label}</span>
        <span className="muted">{contextLine(r.context || {})}</span>
        {showSystem && <span className="muted">· {SYSTEM_LABEL[r.system] ?? r.system}</span>}
      </div>
      {r.message === null && <p>No language model is connected, so here are the closest passages.</p>}
      {paras.map((p, i) => <p key={i}>{withRefs(p, turn, ids)}</p>)}
      {r.next_step && <p className="next"><strong>Next step:</strong> {r.next_step}</p>}

      {!!r.stale_faqs.length && (
        <div className="stale" role="note">
          <strong>Outdated FAQ {r.stale_faqs.length === 1 ? 'entry' : 'entries'} left out</strong>
          {r.stale_faqs.map((s) => (
            <div key={s.faq_id} className="stale-item">
              <p><span className="tag">{s.faq_id}</span> {s.faq_text.replace(/^FAQ \S+ \([^)]*\): /, '')}</p>
              <p className="muted">{s.reason}{s.synthetic ? ' (synthetic test data)' : ''}</p>
            </div>
          ))}
        </div>
      )}

      {!!r.citations.length && (
        <ol className="evidence">
          {r.citations.map((c) => (
            <li key={c.id} id={`t${turn}-${c.id}`} className={c.synthetic ? 'synthetic' : undefined}>
              <div className="ev-head">
                <span className="ev-n">{c.id.slice(1)}</span>
                <span className={c.synthetic ? 'tag synth' : 'tag'}>{AUTHORITY[c.authority || ''] ?? c.authority}</span>
                <strong>{c.title}</strong>
              </div>
              <p className="muted ev-dates">
                {[c.version && `version ${c.version}`, c.effective_from && `in force from ${day(c.effective_from)}`,
                  c.published_at && `published ${day(c.published_at)}`, c.captured_at && `page saved ${day(c.captured_at)}`,
                  c.page && `page ${c.page}`, c.section && !c.page && c.section].filter(Boolean).join(' · ')}
              </p>
              <details>
                <summary>Show the passage</summary>
                <p className="passage">{c.snippet}</p>
              </details>
              {c.url
                ? <a href={c.url} target="_blank" rel="noopener noreferrer">Open the document{c.page ? ` at page ${c.page}` : ''}</a>
                : c.synthetic && <span className="muted">Made-up document for testing, not published anywhere.</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
