export const metadata = { title: 'Page not found' }

export default function NotFound() {
  return (
    <main className="state-page">
      <h1>Page not found</h1>
      <p className="muted">This address doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <div className="actions"><a className="btn" href="/">Go to the start page</a></div>
    </main>
  )
}
