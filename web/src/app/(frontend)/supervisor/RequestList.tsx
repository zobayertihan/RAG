'use client'

import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

export type RequestItem = {
  id: number
  type: 'discuss' | 'supervision'
  status: 'pending' | 'info_requested' | 'accepted' | 'rejected'
  note: string
  summary: string
  createdAt: string
  answeredAt: string | null
  viaCoordinator: boolean
  coordinatorNote: string
  student: { name: string; email: string; programme: string; skills: string[] }
}
type Action = 'accept' | 'reject' | 'ask_details'
type Draft = { to: string; subject: string; body: string; personalized: boolean }

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'New', cls: 'pill' },
  info_requested: { label: 'Details asked', cls: 'pill warn' },
  accepted: { label: 'Accepted', cls: 'pill good' },
  rejected: { label: 'Declined', cls: 'pill bad' },
}
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')
const isOpen = (s: string) => s === 'pending' || s === 'info_requested'

export function RequestList({ items: initial }: { items: RequestItem[] }) {
  const [items, setItems] = useState(initial)
  const [tab, setTab] = useState<'open' | 'all'>('open')
  // rows answered during this visit stay in the Open tab so their email draft stays visible
  const [answered, setAnswered] = useState<number[]>([])
  const shown = tab === 'open' ? items.filter((i) => isOpen(i.status) || answered.includes(i.id)) : items

  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'open'} className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
          Open ({items.filter((i) => isOpen(i.status)).length})
        </button>
        <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          All ({items.length})
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="empty-box"><p>{tab === 'open' ? 'No open requests. New ones also arrive by email.' : 'No requests yet.'}</p></div>
      ) : (
        <ul className="req-list">
          {shown.map((r) => (
            <RequestRow key={r.id} r={r} onStatus={(status, answeredAt) => {
              setAnswered((a) => [...a, r.id])
              setItems((xs) => xs.map((x) => (x.id === r.id ? { ...x, status, answeredAt } : x)))
            }} onDone={() => setAnswered((a) => a.filter((id) => id !== r.id))} />
          ))}
        </ul>
      )}
    </>
  )
}

const CONFIRM_LABEL: Record<Action, (r: RequestItem) => string> = {
  accept: (r) => (r.type === 'supervision' ? 'Yes, accept' : 'Yes, agree to meet'),
  ask_details: () => 'Yes, ask for details',
  reject: () => 'Yes, decline',
}

function confirmText(action: Action, r: RequestItem) {
  const who = r.student.name
  if (action === 'accept') {
    return r.type === 'supervision'
      ? `Accept ${who} for supervision? This uses one of your slots, and ${who} will see "Accepted". You then get an email draft to send.`
      : `Agree to meet ${who} about their idea? This is not yet a supervision agreement. You then get an email draft to send.`
  }
  if (action === 'ask_details') return `Ask ${who} for more details? The status becomes "Details asked", and you get an email draft to write your questions in.`
  return `Decline ${who}'s request? ${who} will see "Declined". You then get an email draft to send.`
}

function RequestRow({ r, onStatus, onDone }: { r: RequestItem; onStatus: (s: RequestItem['status'], at: string) => void; onDone: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState<Action | null>(null)
  const [confirm, setConfirm] = useState<Action | null>(null) // asked first, saved only on Confirm
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [copied, setCopied] = useState(false)
  // the draft as the supervisor edits it; the original stays in `draft` for "Restore draft"
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const st = STATUS[r.status]
  const acceptLabel = r.type === 'supervision' ? 'Accept' : 'Agree to meet'

  async function act(action: Action) {
    setConfirm(null)
    setBusy(action)
    setError('')
    try {
      const res = await fetch('/supervisor/answer', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: r.id, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'The answer could not be saved.')
      onStatus(data.status, data.answeredAt)
      setDraft(data.draft)
      setSubject(data.draft?.subject ?? '')
      setBody(data.draft?.body ?? '')
      setCopied(false)
      router.refresh() // updates the open and slot counts at the top
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const mailto = draft && `mailto:${draft.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  const edited = !!draft && (subject !== draft.subject || body !== draft.body)

  async function copy() {
    if (!draft) return
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  // Closes the draft. The answer itself was saved on Confirm and stays saved.
  function done() {
    setDraft(null)
    setSubject('')
    setBody('')
    setCopied(false)
    onDone()
  }

  return (
    <li className="req">
      <div className="req-head">
        <div>
          <h2>{r.student.name}</h2>
          <p className="muted">
            {r.student.programme}{r.student.programme ? ' · ' : ''}{r.type === 'supervision' ? 'Requests supervision' : 'Wants to discuss an idea'} · {day(r.createdAt)}
          </p>
        </div>
        <span className={st.cls}>{st.label}</span>
      </div>
      {r.viaCoordinator && (
        <p className="summary coord"><span>Suggested by the thesis coordinator</span>{r.coordinatorNote || 'The student asked the coordinator to find a supervisor, and the coordinator chose you.'}</p>
      )}
      {r.summary && <p className="summary"><span>Summary</span>{r.summary}</p>}
      <p className="req-note">{r.note}</p>
      {!!r.student.skills.length && <ul className="chips">{r.student.skills.map((s) => <li key={s}>{s}</li>)}</ul>}

      {isOpen(r.status) && !draft && (
        <div className="actions">
          <button className="btn" disabled={!!busy || !!confirm} onClick={() => setConfirm('accept')}>{busy === 'accept' ? 'Saving…' : acceptLabel}</button>
          <button className="ghost" disabled={!!busy || !!confirm} onClick={() => setConfirm('ask_details')}>{busy === 'ask_details' ? 'Saving…' : 'Ask for details'}</button>
          <button className="ghost" disabled={!!busy || !!confirm} onClick={() => setConfirm('reject')}>{busy === 'reject' ? 'Saving…' : 'Decline'}</button>
        </div>
      )}
      {confirm && !busy && (
        <div className="confirm" role="alertdialog" aria-label="Confirm your answer">
          <p>{confirmText(confirm, r)}</p>
          <div className="actions">
            <button className="btn" autoFocus onClick={() => act(confirm)}>{CONFIRM_LABEL[confirm](r)}</button>
            <button className="ghost" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {draft && (
        <div className="draft">
          <p className="draft-head">Saved. Here is a draft email to {r.student.name}{draft.personalized ? ', based on their note' : ''}. Edit it here, or clear it and write your own.</p>
          <p className="draft-meta"><strong>To:</strong> <span className="email">{draft.to || '(no email on file)'}</span></p>
          <label className="draft-field">
            <strong>Subject</strong>
            <input value={subject} onChange={(e) => { setSubject(e.target.value); setCopied(false) }} />
          </label>
          <label className="draft-field">
            <strong>Message</strong>
            <textarea className="draft-body" rows={10} value={body} placeholder="Write your email to the student here."
              onChange={(e) => { setBody(e.target.value); setCopied(false) }} />
          </label>
          <div className="actions">
            {draft.to && mailto && <a className="btn" href={mailto}>Open in Outlook</a>}
            <button className="ghost" type="button" onClick={copy} disabled={!body.trim()}>{copied ? 'Copied' : 'Copy text'}</button>
            <button className="ghost" type="button" onClick={() => { setBody(''); setCopied(false) }} disabled={!body}>Clear text</button>
            {edited && <button className="ghost" type="button" onClick={() => { setSubject(draft.subject); setBody(draft.body); setCopied(false) }}>Restore draft</button>}
            <button className="ghost" type="button" onClick={done}>Done</button>
          </div>
          <p className="hint">Done closes the draft. Your answer ({st.label.toLowerCase()}) is already saved.</p>
        </div>
      )}
    </li>
  )
}
