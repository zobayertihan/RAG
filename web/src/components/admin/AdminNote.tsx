/** Shown above the collection cards on the admin home page. */
export function AdminNote() {
  return (
    <div className="sf-note">
      <strong>This is the data editor.</strong> Use it to fix a record by hand. Slots, requests, demand and change
      history are on the <a href="/dashboard">dashboard</a>. Profile edits saved here are versioned and update search,
      the same as edits made by supervisors.
    </div>
  )
}
