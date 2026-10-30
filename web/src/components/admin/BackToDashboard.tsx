/** First item in the admin sidebar: the way back to the app's own dashboard. */
export function BackToDashboard() {
  return (
    <a className="sf-back" href="/dashboard">
      <span aria-hidden="true">←</span> Back to dashboard
    </a>
  )
}
