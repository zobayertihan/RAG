'use client'

import React, { useState } from 'react'

type Row = { line: number; recordId: string; name: string; action: string; fields: string[]; error?: string }
type Result = { applied: boolean; unknownColumns: string[]; rows: Row[]; counts: Record<'create' | 'update' | 'unchanged' | 'error', number> }

const ACTION: Record<string, { label: string; cls: string }> = {
  create: { label: 'New', cls: 'pill good' }, update: { label: 'Update', cls: 'pill' }, error: { label: 'Error', cls: 'pill bad' },
}

export function ImportForm() {
  const [csv, setCsv] = useState('')
  const [file, setFile] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send(apply: boolean) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/dashboard/data/import', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv, apply }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'The file could not be read.')
      setResult(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    setResult(null)
    setError('')
    if (!f) return
    setFile(f.name)
    setCsv(await f.text())
  }

  const n = result ? result.counts.create + result.counts.update : 0
  return (
    <div className="import">
      <div className="add-row">
        <input type="file" accept=".csv,text/csv" onChange={pick} aria-label="CSV file" />
        <button className="ghost" disabled={!csv || busy} onClick={() => send(false)}>{busy && !result ? 'Checking…' : 'Check file'}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {result && (
        <div className="import-result">
          <p>
            <strong>{file}</strong>: {result.counts.create} new, {result.counts.update} to update, {result.counts.unchanged} unchanged,{' '}
            {result.counts.error} with errors{result.applied ? '. Saved.' : '. Nothing is saved yet.'}
          </p>
          {!!result.unknownColumns.length && <p className="hint">Ignored columns: {result.unknownColumns.join(', ')}</p>}
          {!!result.rows.length && (
            <div className="table-wrap">
              <table className="dt">
                <thead><tr><th className="num">Line</th><th>Supervisor</th><th>What</th><th>Fields</th></tr></thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={`${r.line}-${r.recordId}`}>
                      <td className="num">{r.line}</td>
                      <td>{r.name || '–'}<div className="sub">{r.recordId || 'no record_id'}</div></td>
                      <td><span className={ACTION[r.action]?.cls ?? 'pill'}>{ACTION[r.action]?.label ?? r.action}</span></td>
                      <td>{r.error ? <span className="error">{r.error}</span> : r.fields.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!result.applied && n > 0 && (
            <button className="btn" disabled={busy} onClick={() => send(true)}>
              {busy ? 'Saving…' : `Save ${n} change${n === 1 ? '' : 's'}`}
            </button>
          )}
          {!result.applied && result.counts.error > 0 && n > 0 && <p className="hint">Rows with errors are skipped.</p>}
        </div>
      )}
    </div>
  )
}
