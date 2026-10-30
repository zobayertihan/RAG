'use client'

import React, { useState } from 'react'

type Props = { id: number; name: string; position: string; interests: string[]; requirements: string[]; room: string; capacity: number | null; slotsUsed: number }

function ListEditor({ id, label, help, items, setItems, placeholder }: {
  id: string; label: string; help: string; items: string[]; setItems: (v: string[]) => void; placeholder: string
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (v && !items.some((x) => x.toLowerCase() === v.toLowerCase())) setItems([...items, v])
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
        <button type="button" className="ghost" onClick={add}>Add</button>
      </div>
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

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setState({ busy: true })
    const data: Record<string, unknown> = {
      interests: interests.map((value) => ({ value })),
      requirements: requirements.map((value) => ({ value })),
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
        items={interests} setItems={setInterests} placeholder="Add a research area" />
      <ListEditor id="requirement" label="What you expect from students" help="Optional, for example 'Python', 'a company partner' or 'interest in quantitative methods'."
        items={requirements} setItems={setRequirements} placeholder="Add a requirement" />
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
      <button className="btn" disabled={state.busy}>{state.busy ? 'Saving…' : 'Save profile'}</button>
    </form>
  )
}
