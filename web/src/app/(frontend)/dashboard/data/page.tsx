import { requireRole } from '@/lib/session'
import { COLUMNS, LIST_SEP } from '@/lib/supervisorCsv'
import { ImportForm } from './ImportForm'

export const metadata = { title: 'Import and export' }

export default async function DataPage() {
  await requireRole('admin')
  return (
    <>
      <h1>Import and export</h1>

      <h2>Add or update supervisors from files</h2>
      <p className="muted">
        Choose one or more files: staff list PDFs, CSV files, or both. You see who is new and what would change before anything
        is saved. Saved changes appear under Changes and in search right away. Nobody is removed: people who are missing from
        the files are only listed.
      </p>
      <ul className="muted small-list">
        <li>
          <strong>PDF:</strong> a staff list with a table of name, position (or designation) and research areas, like the BTECH
          list. People are matched by their profile link, then by name. Research areas a supervisor has edited themselves are kept,
          unless you tick the box.
        </li>
        <li>
          <strong>CSV:</strong> the exported file, edited in Excel, or your own with the column names in the first row. Rows are
          matched by <code>record_id</code>; a new id adds a supervisor. Only the columns in the file are changed. Separate several
          research areas with <code>{LIST_SEP}</code> in one cell.
        </li>
      </ul>
      <p className="hint">CSV columns: {COLUMNS.join(', ')}</p>
      <ImportForm />

      <h2>Export supervisors</h2>
      <p className="muted">
        All supervisor records as they are now. The CSV opens in Excel and includes slots used and when each profile last changed.
        The JSON has the same format as <code>data/supervisors.json</code> in the code, so it can replace that file.
      </p>
      <div className="actions">
        <a className="btn" href="/dashboard/data/export">Download CSV</a>
        <a className="ghost" href="/dashboard/data/export?format=json">Download JSON</a>
      </div>
    </>
  )
}
