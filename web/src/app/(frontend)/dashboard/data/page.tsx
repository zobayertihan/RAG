import { requireRole } from '@/lib/session'
import { COLUMNS, LIST_SEP } from '@/lib/supervisorCsv'
import { ImportForm } from './ImportForm'

export default async function DataPage() {
  await requireRole('admin')
  return (
    <>
      <h1>Import and export</h1>
      <h2>Export supervisors</h2>
      <p className="muted">All supervisor records as a CSV file that opens in Excel. Includes slots used and when each profile last changed.</p>
      <a className="btn" href="/dashboard/data/export">Download CSV</a>

      <h2>Import supervisors</h2>
      <p className="muted">
        Edit the exported file, or make your own with the column names in the first row. Rows are matched by <code>record_id</code>:
        a known id updates that supervisor, a new id adds one. Only the columns in your file are changed. Separate several research
        areas with <code>{LIST_SEP}</code> in one cell. You see what would change before anything is saved, and every saved change
        appears under Changes and in search right away.
      </p>
      <p className="hint">Columns: {COLUMNS.join(', ')}</p>
      <ImportForm />
    </>
  )
}
