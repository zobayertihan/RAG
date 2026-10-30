'use client'

import React, { useRef, useState } from 'react'

type Source = {
  record_id?: string
  supervisorId?: number
  file?: string
  page?: number | null
  urls?: string[]
  emails?: string[]
  room?: string
  updated_at?: string | null
  capacity?: number | null
  slotsUsed?: number
  type?: string
  snippet?: string
}
type CardT = Source & { name?: string; title?: string; focus?: string; fit?: string; ideas?: string[]; role?: string; slot?: string | null }
type Mention = Source & { name: string }
type Reply = {
  message: string | null
  supervisors: CardT[]
  mentions?: Mention[]
  matches?: Source[]
  history: string
}
type Turn = { id: number; text: string; reply?: Reply; error?: string }
type Msg = { role: 'user' | 'assistant'; content: string }

const POSITIONS = ['Professor', 'Associate Professor', 'Assistant Professor', 'Postdoc']
// "Professor" also covers Distinguished Professor and Professor (Docent).
const POSITION_VALUES: Record<string, string[]> = {
  Professor: ['Professor', 'Distinguished Professor', 'Professor (Docent)'],
  'Associate Professor': ['Associate Professor'],
  'Assistant Professor': ['Assistant Professor'],
  Postdoc: ['Postdoc'],
}
const GROUPS = ['AIROD', 'EngTech']
const SLOT_LABEL: Record<string, string> = { best: 'Best match', business: 'Business angle', engineering: 'Engineering angle', generalist: 'Generalist' }

const safeUrl = (u?: string) => (u && /^https?:\/\//.test(u) ? u : undefined)

function slotsText(s: Source) {
  if (typeof s.capacity !== 'number') return null
  const open = Math.max(0, s.capacity - (s.slotsUsed ?? 0))
  return open === 0 ? 'No supervision slots left' : `${open} of ${s.capacity} slots open`
}

export function StudentChat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [history, setHistory] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'supervisors' | 'finance'>('supervisors')
  const [positions, setPositions] = useState<string[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const nextId = useRef(1)
  const endRef = useRef<HTMLDivElement>(null)

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  function newChat() {
    setTurns([])
    setHistory([])
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    const q = text.trim()
    if (!q || busy) return
    const id = nextId.current++
    const msgs: Msg[] = [...history, { role: 'user', content: q }]
    setTurns((t) => [...t, { id, text: q }])
    setText('')
    setBusy(true)
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50)
    const filters = {
      position: positions.flatMap((p) => POSITION_VALUES[p]),
      research_group: groups,
      type: [] as string[],
    }
    try {
      const res = await fetch('/student/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs, mode, filters }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong.')
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, reply: data } : x)))
      setHistory([...msgs, { role: 'assistant', content: data.history }])
    } catch (err) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: (err as Error).message } : x)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="student-shell">
      <aside className={`panel${panelOpen ? ' open' : ''}`} aria-label="Search options">
        <button type="button" className="panel-toggle ghost" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
          {panelOpen ? 'Hide options' : 'Search options'}
        </button>
        <div className="panel-body">
          <fieldset>
            <legend>What do you need?</legend>
            <label className="opt">
              <input type="radio" name="mode" checked={mode === 'supervisors'} onChange={() => { setMode('supervisors'); newChat() }} />
              Find a supervisor
            </label>
            <label className="opt disabled">
              <input type="radio" name="mode" disabled />
              Travel and expense questions <span className="soon">coming soon</span>
            </label>
          </fieldset>
          <fieldset>
            <legend>Position</legend>
            {POSITIONS.map((p) => (
              <label key={p} className="opt">
                <input type="checkbox" checked={positions.includes(p)} onChange={() => toggle(positions, setPositions, p)} />
                {p}
              </label>
            ))}
            <p className="hint">None ticked means everyone.</p>
          </fieldset>
          <fieldset>
            <legend>Research group</legend>
            {GROUPS.map((g) => (
              <label key={g} className="opt">
                <input type="checkbox" checked={groups.includes(g)} onChange={() => toggle(groups, setGroups, g)} />
                {g}
              </label>
            ))}
            <p className="hint">Only supervisors with a known group are matched when you tick one.</p>
          </fieldset>
          <button type="button" className="ghost" onClick={newChat}>New chat</button>
        </div>
      </aside>

      <section className="chat" aria-live="polite">
        {turns.length === 0 && (
          <div className="empty">
            <h1>What do you want to write your thesis about?</h1>
            <p>
              Describe your idea and your background. You get supervisors whose research fits, with thesis ideas
              and a button to contact them. Keep chatting to narrow it down or change direction.
            </p>
          </div>
        )}
        {turns.map((t) => (
          <div className="turn" key={t.id}>
            <div className="you"><div>{t.text}</div></div>
            <div className="reply">
              {!t.reply && !t.error && <div className="typing" aria-label="Finding supervisors"><span /><span /><span /></div>}
              {t.error && <p className="error">Couldn&apos;t get an answer: {t.error} Send your message again.</p>}
              {t.reply && <ReplyView reply={t.reply} />}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </section>

      <form className="composer-wrap" onSubmit={send}>
        <div className="composer">
          <textarea
            id="q"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e) }}
            placeholder="For example: I want to use LLMs in robotics. My background is software development."
            aria-label="Your message"
          />
          <button className="send" disabled={busy || !text.trim()}>Send</button>
        </div>
        <p className="hint center">Suggestions come from the staff list. Check a supervisor&apos;s profile before contacting them.</p>
      </form>
    </div>
  )
}

function ReplyView({ reply }: { reply: Reply }) {
  if (reply.message === null) {
    return (
      <>
        <p>No language model is connected, so here are the closest matches from the staff list.</p>
        {(reply.matches || []).map((m, i) => (
          <article className="card" key={i}>
            <p className="snippet">{m.snippet}</p>
            <CardFoot s={m} name={m.snippet?.split(';')[0].replace('Name: ', '') || ''} />
          </article>
        ))}
      </>
    )
  }
  const paras = reply.message.replace(/\s*\[S\d+\]/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  return (
    <>
      {paras.map((p, i) => <p key={i}>{p}</p>)}
      {!!reply.mentions?.length && (
        <div className="mentions">
          {reply.mentions.filter((m) => safeUrl(m.urls?.[0])).map((m, i) => (
            <a key={i} className="mention" href={safeUrl(m.urls?.[0])} target="_blank" rel="noopener noreferrer">{m.name}&apos;s profile</a>
          ))}
        </div>
      )}
      {reply.supervisors.map((c, i) => <Card key={i} c={c} first={i === 0} many={reply.supervisors.length > 1} />)}
    </>
  )
}

function Card({ c, first, many }: { c: CardT; first: boolean; many: boolean }) {
  const co = c.role === 'co-supervisor'
  const badge = co ? { text: 'Co-supervisor', cls: 'badge' }
    : c.slot && SLOT_LABEL[c.slot] ? { text: SLOT_LABEL[c.slot], cls: c.slot === 'best' ? 'badge best' : 'badge' }
    : first && many ? { text: 'Best match', cls: 'badge best' } : null
  const chips = (c.focus || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6)
  return (
    <article className={`card${co ? ' co' : ''}`}>
      <div className="card-head">
        <div>
          <h2 className="name">{c.name}</h2>
          <p className="title">{c.title}</p>
        </div>
        {badge && <span className={badge.cls}>{badge.text}</span>}
      </div>
      {!!chips.length && <ul className="chips">{chips.map((x) => <li key={x}>{x}</li>)}</ul>}
      {c.fit && (<><h3>Why it fits you</h3><p>{c.fit}</p></>)}
      {!!c.ideas?.length && (<><h3>Thesis ideas</h3><ul className="ideas">{c.ideas.map((x, i) => <li key={i}>{x}</li>)}</ul></>)}
      <CardFoot s={c} name={c.name || ''} />
    </article>
  )
}

function CardFoot({ s, name }: { s: Source; name: string }) {
  const [open, setOpen] = useState(false)
  const slots = slotsText(s)
  return (
    <>
      <div className="card-foot">
        {s.supervisorId && (
          <button type="button" className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Close' : 'Contact'}
          </button>
        )}
        {safeUrl(s.urls?.[0]) && <a className="btn ghost-btn" href={safeUrl(s.urls?.[0])} target="_blank" rel="noopener noreferrer">Open profile</a>}
        {s.emails?.map((e) => <span key={e} className="email">{e}</span>)}
        {s.room && <span>Room {s.room}</span>}
        {slots && <span className={slots.startsWith('No') ? 'slots full' : 'slots'}>{slots}</span>}
        <span className="src">Staff list{s.updated_at ? `, updated ${s.updated_at}` : ''}</span>
      </div>
      {open && s.supervisorId && <ContactForm supervisorId={s.supervisorId} name={name} full={slots?.startsWith('No') ?? false} />}
    </>
  )
}

function ContactForm({ supervisorId, name, full }: { supervisorId: number; name: string; full: boolean }) {
  const [type, setType] = useState<'discuss' | 'supervision'>('discuss')
  const [note, setNote] = useState('')
  const [state, setState] = useState<{ busy?: boolean; error?: string; sent?: boolean }>({})
  const fid = `note-${supervisorId}`

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!note.trim()) return setState({ error: 'Write a short note first.' })
    setState({ busy: true })
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supervisor: supervisorId, type, note: note.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.errors?.[0]?.message || 'The request could not be sent.')
      setState({ sent: true })
    } catch (err) {
      setState({ error: (err as Error).message })
    }
  }

  if (state.sent) {
    return <p className="sent">Request sent to {name}. You can follow it under <a href="/student/requests">My requests</a>.</p>
  }
  return (
    <form className="contact" onSubmit={submit}>
      <fieldset>
        <legend>What do you want from {name}?</legend>
        <label className="opt">
          <input type="radio" name={`type-${supervisorId}`} checked={type === 'discuss'} onChange={() => setType('discuss')} />
          Discuss an idea first
        </label>
        <label className={`opt${full ? ' disabled' : ''}`}>
          <input type="radio" name={`type-${supervisorId}`} checked={type === 'supervision'} disabled={full} onChange={() => setType('supervision')} />
          Request supervision {full && <span className="soon">no slots left</span>}
        </label>
      </fieldset>
      <label htmlFor={fid}>Your note</label>
      <textarea id={fid} rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="Your preliminary idea, and why you chose this supervisor." />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button className="btn" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send request'}</button>
    </form>
  )
}
