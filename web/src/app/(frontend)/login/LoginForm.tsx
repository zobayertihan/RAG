'use client'

import React, { useState } from 'react'

const HOME: Record<string, string> = { student: '/student', supervisor: '/admin', admin: '/admin' }

export function LoginForm() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.errors?.[0]?.message || 'Wrong email or password.')
      window.location.href = HOME[data.user?.role] || '/'
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="login-form">
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="hint">Demo: student@example.com, supervisor@example.com or admin@example.com</p>
    </form>
  )
}
