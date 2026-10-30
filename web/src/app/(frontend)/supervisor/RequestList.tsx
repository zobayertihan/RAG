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
            }} />
          ))}
        </ul>
      )}
    </>
  )
}

function RequestRow({ r, onStatus }: { r: RequestItem; onStatus: (s: RequestItem['status'], at: string) => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState<Action | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [copied, setCopied] = useState(false)
  const st = STATUS[r.status]
  const acceptLabel = r.type === 'supervision' ? 'Accept' : 'Agree to meet'

  async function act(action: Action) {
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
      router.refresh() // updates the open and slot counts at the top
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const mailto = draft && `mailto:${draft.to}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`

  async function copy() {
    if (!draft) return
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
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
      {r.summary && <p className="summary"><span>Summary</span>{r.summary}</p>}
      <p className="req-note">{r.note}</p>
      {!!r.student.skills.length && <ul className="chips">{r.student.skills.map((s) => <li key={s}>{s}</li>)}</ul>}

      {isOpen(r.status) && !draft && (
        <div className="actions">
          <button className="btn" disabled={!!busy} onClick={() => act('accept')}>{busy === 'accept' ? 'Saving…' : acceptLabel}</button>
          <button className="ghost" disabled={!!busy} onClick={() => act('ask_details')}>{busy === 'ask_details' ? 'Saving…' : 'Ask for details'}</button>
          <button className="ghost" disabled={!!busy} onClick={() => act('reject')}>{busy === 'reject' ? 'Saving…' : 'Decline'}</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {draft && (
        <div className="draft">
          <p className="draft-head">Saved. Here is a draft email to {r.student.name}{draft.personalized ? ', based on their note' : ''}. Edit it before you send it.</p>
          <p className="draft-meta"><strong>To:</strong> <span className="email">{draft.to || '(no email on file)'}</span></p>
          <p className="draft-meta"><strong>Subject:</strong> {draft.subject}</p>
          <pre className="draft-body">{draft.body}</pre>
          <div className="actions">
            {draft.to && mailto && <a className="btn" href={mailto}>Open in Outlook</a>}
            <button className="ghost" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy text'}</button>
          </div>
        </div>
      )}
    </li>
  )
}
