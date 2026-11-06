'use client'

import React, { useState } from 'react'

export type Option = { id: number; name: string; position: string; slots: string; full: boolean }

export function AssignForm({ requestId, suggestions, all }: { requestId: number; suggestions: (Option & { score: number })[]; all: Option[] }) {
  // pre-select the best match with known free slots; "slots not set" only if nobody has known free slots
  const firstFree = suggestions.find((s) => !s.full && s.slots.includes('open')) ?? suggestions.find((s) => !s.full)
  const [choice, setChoice] = useState<number | ''>(firstFree?.id ?? '')
  const [note, setNote] = useState('')
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: string; emailed?: boolean }>({})
  const [confirming, setConfirming] = useState(false) // asked first, sent only on "Yes, send"
  const chosen = [...suggestions, ...all].find((o) => o.id === choice)

  function ask(e: React.FormEvent) {
    e.preventDefault()
    if (!choice) return setState({ error: 'Choose a supervisor.' })
    setState({})
    setConfirming(true)
  }

  async function assign() {
    setConfirming(false)
    setState({ busy: true })
    try {
      const res = await fetch('/dashboard/coordinator/assign', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, supervisorId: choice, note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Could not assign.')
      setState({ done: data.supervisor, emailed: data.emailed })
    } catch (err) {
      setState({ error: (err as Error).message })
    }
  }

  if (state.done) {
    return (
      <p className="sent">
        Sent to {state.done}. They will accept or decline it like any other request.
        {state.emailed ? ' They get an email notice.' : ' There is no email address on file for them, so tell them directly.'}
      </p>
    )
  }
  return (
    <form className="assign" onSubmit={ask}>
      <fieldset className="field">
        <legend>Suggested by search</legend>
        {suggestions.length === 0 && <p className="hint">No suggestions. Pick someone from the full list below.</p>}
        {suggestions.map((s) => (
          <label key={s.id} className={`opt${s.full ? ' disabled' : ''}`}>
            <input type="radio" name={`sup-${requestId}`} checked={choice === s.id} disabled={s.full || confirming} onChange={() => setChoice(s.id)} />
            <span><strong>{s.name}</strong> <span className="muted">{s.position} · {s.full ? 'full' : s.slots}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={`any-${requestId}`}>Or anyone else</label>
        <select id={`any-${requestId}`} value={suggestions.some((s) => s.id === choice) ? '' : choice}
          onChange={(e) => setChoice(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Choose from all supervisors…</option>
          {all.map((o) => <option key={o.id} value={o.id} disabled={o.full}>{o.name} ({o.full ? 'full' : o.slots})</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`note-${requestId}`}>Why this supervisor (shown to them)</label>
        <textarea id={`note-${requestId}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Fits the student's interest in supply chain analytics; has free slots." />
      </div>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {confirming && chosen ? (
        <div className="confirm" role="alertdialog" aria-label="Confirm the suggestion">
          <p>Send this request to {chosen.name}? They get it as a supervision request to accept or decline{note.trim() ? ', with your reason' : ''}.</p>
          <div className="actions">
            <button type="button" className="btn" autoFocus onClick={assign}>Yes, send to {chosen.name}</button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn" disabled={state.busy}>{state.busy ? 'Sending…' : 'Suggest this supervisor'}</button>
      )}
    </form>
  )
}
