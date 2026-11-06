'use client'

import React, { useEffect } from 'react'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error])
  return (
    <main className="state-page">
      <h1>Something went wrong</h1>
      <p className="muted">The page couldn&apos;t be loaded. Try again, and if it keeps happening, tell the admin.</p>
      <div className="actions">
        <button type="button" className="btn" onClick={reset}>Try again</button>
        <a className="ghost" href="/">Go to the start page</a>
      </div>
    </main>
  )
}
