'use client'

import React, { useEffect, useState } from 'react'

type Props = { id: number; name: string; position: string; interests: string[]; requirements: string[]; room: string; capacity: number | null; slotsUsed: number }

/** The list plus text typed in the box but not added yet (Save adds it too, so nothing is lost). */
const withDraft = (items: string[], draft: string) => {
  const v = draft.trim()
  return v && !items.some((x) => x.toLowerCase() === v.toLowerCase()) ? [...items, v] : items
}

function ListEditor({ id, label, help, items, setItems, draft, setDraft, placeholder }: {
  id: string; label: string; help: string; items: string[]; setItems: (v: string[]) => void
  draft: string; setDraft: (v: string) => void; placeholder: string
}) {
  const add = () => {
    setItems(withDraft(items, draft))
    setDraft('')
  }
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <p className="hint">{help}</p>
      <ul className="edit-chips">
        {items.map((x) => (
          <li key={x}>{x}<button type="button" aria-label={`Remove ${x}`} onClick={() => setItems(items.filter((y) => y !== x))}>×</button></li>
        ))}
        {!items.length && <li className="none">None yet</li>}
      </ul>
      <div className="add-row">
        <input id={id} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button type="button" className="ghost" onClick={add} disabled={!draft.trim()}>Add</button>
      </div>
      {draft.trim() && <p className="hint">Press Enter or Add. Save profile also adds it.</p>}
    </fieldset>
  )
}

export function ProfileForm(p: Props) {
  const [interests, setInterests] = useState(p.interests)
  const [requirements, setRequirements] = useState(p.requirements)
  const [room, setRoom] = useState(p.room)
  const [capacity, setCapacity] = useState<number | null>(p.capacity)
  const [savedCap, setSavedCap] = useState<number | null>(p.capacity)
  const [state, setState] = useState<{ busy?: boolean; ok?: string; error?: string }>({})
  const [interestDraft, setInterestDraft] = useState('')
  const [requirementDraft, setRequirementDraft] = useState('')
  // what was last saved, to know whether there are unsaved changes
  const snapshot = (i: string[], r: string[], rm: string, c: number | null) => JSON.stringify([i, r, rm.trim(), c])
  const [last, setLast] = useState({ interests: p.interests, requirements: p.requirements, room: p.room }) // as last saved
  const saved = snapshot(last.interests, last.requirements, last.room, savedCap)
  const current = snapshot(withDraft(interests, interestDraft), withDraft(requirements, requirementDraft), room, capacity)
  const dirty = current !== saved

  // warn before leaving the page with unsaved changes
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  // an edit after saving hides the old "Saved" message
  useEffect(() => { if (dirty) setState((s) => (s.ok ? {} : s)) }, [dirty])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setState({ busy: true })
    const allInterests = withDraft(interests, interestDraft)
    const allRequirements = withDraft(requirements, requirementDraft)
    const data: Record<string, unknown> = {
      interests: allInterests.map((value) => ({ value })),
      requirements: allRequirements.map((value) => ({ value })),
      room,
    }
    if (capacity !== savedCap) data.capacity = capacity
    try {
      const res = await fetch(`/api/supervisors/${p.id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.errors?.[0]?.message || 'Your profile could not be saved.')
      setSavedCap(capacity)
      setInterests(allInterests)
      setRequirements(allRequirements)
      setInterestDraft('')
      setRequirementDraft('')
      setLast({ interests: allInterests, requirements: allRequirements, room })
      setState({ ok: 'Saved. Students will see the change in their next search.' })
    } catch (err) {
      setState({ error: (err as Error).message })
    }
  }

  return (
    <form className="profile" onSubmit={save}>
      <div className="readonly">
        <div><span>Name</span>{p.name}</div>
        <div><span>Position</span>{p.position}</div>
        <p className="hint">Name and position come from the staff list. Ask the admin to change them.</p>
      </div>
      <ListEditor id="interest" label="Research areas" help="What search matches on. Use the words students would type, such as 'computer vision'."
        items={interests} setItems={setInterests} draft={interestDraft} setDraft={setInterestDraft} placeholder="Add a research area" />
      <ListEditor id="requirement" label="What you expect from students" help="Optional, for example 'Python', 'a company partner' or 'interest in quantitative methods'."
        items={requirements} setItems={setRequirements} draft={requirementDraft} setDraft={setRequirementDraft} placeholder="Add a requirement" />
      <div className="field">
        <label htmlFor="room">Office or room</label>
        <input id="room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. 8001, 1407" />
      </div>
      <div className="field">
        <label htmlFor="capacity">Supervision slots this semester</label>
        {savedCap === null ? (
          <p className="hint">Not set yet. The admin sets your slots at the start of the semester.</p>
        ) : (
          <>
            <input id="capacity" type="number" min={p.slotsUsed} max={savedCap} value={capacity ?? ''}
              onChange={(e) => setCapacity(e.target.value === '' ? savedCap : Number(e.target.value))} />
            <p className="hint">{p.slotsUsed} used. You can lower your slots; only the admin can raise them.</p>
          </>
        )}
      </div>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.ok && <p className="sent">{state.ok}</p>}
      <div className="actions">
        <button className="btn" disabled={state.busy || !dirty}>{state.busy ? 'Saving…' : 'Save profile'}</button>
        {dirty && !state.busy && (
          <button type="button" className="ghost" onClick={() => {
            setInterests(last.interests); setRequirements(last.requirements); setRoom(last.room); setCapacity(savedCap)
            setInterestDraft(''); setRequirementDraft(''); setState({})
          }}>Undo changes</button>
        )}
      </div>
      {dirty && !state.busy && <p className="unsaved">You have unsaved changes.</p>}
    </form>
  )
}
