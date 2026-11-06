'use client'

import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

type Row = { source: string; recordId: string; name: string; action: string; fields: string[]; note?: string; error?: string }
type Result = {
  applied: boolean; warnings: string[]; missing: string[]; rows: Row[]
  counts: Record<'create' | 'update' | 'unchanged' | 'error', number>
}

const ACTION: Record<string, { label: string; cls: string }> = {
  create: { label: 'New', cls: 'pill good' }, update: { label: 'Update', cls: 'pill' }, error: { label: 'Error', cls: 'pill bad' },
  unchanged: { label: 'No change', cls: 'pill' },
}
const FIELD_LABEL: Record<string, string> = {
  name: 'name', position: 'position', interests: 'research areas', requirements: 'requirements', capacity: 'slots',
  type: 'type', researchGroup: 'research group', room: 'room', email: 'email', profileUrl: 'profile link',
}

export function ImportForm() {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [replaceEdited, setReplaceEdited] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState<'check' | 'save' | null>(null)
  const [error, setError] = useState('')
  const [inputKey, setInputKey] = useState(0) // to empty the file picker

  async function send(apply: boolean) {
    setBusy(apply ? 'save' : 'check')
    setError('')
    try {
      const form = new FormData()
      files.forEach((f) => form.append('files', f))
      form.append('apply', String(apply))
      form.append('replaceEdited', String(replaceEdited))
      const res = await fetch('/dashboard/data/import', { method: 'POST', credentials: 'include', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'The files could not be read.')
      setResult(data)
      if (apply) router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []))
    setResult(null)
    setError('')
  }

  function clear() {
    setFiles([])
    setResult(null)
    setError('')
    setInputKey((k) => k + 1)
  }

  const n = result ? result.counts.create + result.counts.update : 0
  return (
    <div className="import">
      <div className="add-row">
        <input key={inputKey} type="file" multiple accept=".pdf,.csv,application/pdf,text/csv" onChange={pick} aria-label="PDF or CSV files" />
        <button type="button" className="ghost" disabled={!files.length || !!busy} onClick={() => send(false)}>
          {busy === 'check' ? 'Checking…' : 'Check files'}
        </button>
        {!!files.length && <button type="button" className="ghost" disabled={!!busy} onClick={clear}>Clear</button>}
      </div>
      {!!files.length && <p className="hint">{files.length} file{files.length === 1 ? '' : 's'}: {files.map((f) => f.name).join(', ')}</p>}
      <label className="opt">
        <input type="checkbox" checked={replaceEdited} onChange={(e) => { setReplaceEdited(e.target.checked); setResult(null) }} />
        Also replace research areas that supervisors edited themselves
      </label>
      {busy === 'check' && files.some((f) => f.name.toLowerCase().endsWith('.pdf')) && (
        <p className="hint" role="status">Reading the PDFs. If the search service was asleep, this takes up to a minute.</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {result && (
        <div className="import-result">
          <p>
            {result.counts.create} new, {result.counts.update} to update, {result.counts.unchanged} unchanged,{' '}
            {result.counts.error} with errors{result.applied ? '. Saved.' : '. Nothing is saved yet.'}
          </p>
          {result.warnings.map((w) => <p key={w} className="hint warn-text">{w}</p>)}
          {!!result.rows.length && (
            <div className="table-wrap">
              <table className="dt">
                <thead><tr><th>Supervisor</th><th>What</th><th>Changes</th><th>From</th></tr></thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={`${i}-${r.recordId}`}>
                      <td>{r.name || '–'}<div className="sub">{r.recordId || 'no record_id'}</div></td>
                      <td><span className={ACTION[r.action]?.cls ?? 'pill'}>{ACTION[r.action]?.label ?? r.action}</span></td>
                      <td>
                        {r.error ? <span className="error">{r.error}</span> : r.fields.map((f) => FIELD_LABEL[f] ?? f).join(', ')}
                        {r.note && <div className="sub">{r.note}</div>}
                      </td>
                      <td className="sub">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!!result.missing.length && (
            <details className="missing">
              <summary>{result.missing.length} supervisors in the database are not in these files (nothing is removed)</summary>
              <p className="hint">{result.missing.join(', ')}</p>
            </details>
          )}
          <div className="actions">
            {!result.applied && n > 0 && (
              <button type="button" className="btn" disabled={!!busy} onClick={() => send(true)}>
                {busy === 'save' ? 'Saving…' : `Save ${n} change${n === 1 ? '' : 's'}`}
              </button>
            )}
            {(result.applied || n === 0) && <button type="button" className="ghost" onClick={clear}>Done</button>}
          </div>
          {!result.applied && result.counts.error > 0 && n > 0 && <p className="hint">Rows with errors are skipped.</p>}
          {busy === 'save' && <p className="hint" role="status">Saving and updating search for each supervisor. This can take a minute.</p>}
        </div>
      )}
    </div>
  )
}
