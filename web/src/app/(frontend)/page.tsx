import { headers as getHeaders } from 'next/headers.js'
import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'
import './styles.css'

// Placeholder until Phase 5 (student page) and Phase 6 (supervisor page).
export default async function HomePage() {
  const payload = await getPayload({ config: await config })
  const { user } = await payload.auth({ headers: await getHeaders() })

  return (
    <main className="home">
      <h1>Supervisor Finder</h1>
      {user ? (
        <p>
          Signed in as {user.email} ({(user as { role?: string }).role}).
        </p>
      ) : (
        <p>Not signed in.</p>
      )}
      <p>
        <a href="/admin">Open the admin panel</a>
      </p>
      <p className="muted">Student and supervisor pages come in Phases 5 and 6.</p>
    </main>
  )
}
