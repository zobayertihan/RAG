'use client'

import React, { useState } from 'react'

/** A small "write a message" box. Calls onSent with the sent text and time. */
export function MessageBox({ url, requestId, to, label = 'Write a message', onSent, startOpen = false }: {
  url: string; requestId: number; to: string; label?: string; startOpen?: boolean
  onSent: (m: { message: string; sentAt: string }) => void
}) {
  const [open, setOpen] = useState(startOpen)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(url, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, message: text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'The message could not be sent.')
      onSent({ message: text.trim(), sentAt: data.sentAt })
      setText('')
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return <div className="actions"><button type="button" className="ghost" onClick={() => setOpen(true)}>{label}</button></div>
  }
  return (
    <div className="msg-box">
      <label className="draft-field">
        <strong>Message to {to}</strong>
        <textarea className="draft-body" rows={5} value={text} autoFocus maxLength={5000}
          placeholder={`Write to ${to}.`} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => { setOpen(false); setText(''); setError('') }}>Cancel</button>
      </div>
    </div>
  )
}
