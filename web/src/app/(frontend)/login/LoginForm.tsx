'use client'

import React, { useState } from 'react'

const HOME: Record<string, string> = { student: '/student', supervisor: '/supervisor', admin: '/dashboard' }

export function LoginForm() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)

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

  const capsCheck = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false)

  return (
    <form onSubmit={onSubmit} className="login-form">
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="username" autoFocus required />
      <label htmlFor="password">Password</label>
      <div className="pw">
        <input id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required
          onKeyDown={capsCheck} onKeyUp={capsCheck} aria-describedby={caps ? 'caps' : undefined} />
        <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} aria-controls="password">
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {caps && <p id="caps" className="hint warn-text">Caps Lock is on.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="hint">Demo: student@example.com, supervisor@example.com or admin@example.com</p>
    </form>
  )
}
