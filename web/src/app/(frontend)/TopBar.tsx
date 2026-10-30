'use client'

import React from 'react'

export function TopBar({ name, links }: { name: string; links: { href: string; label: string; active?: boolean }[] }) {
  async function logout() {
    await fetch('/api/users/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    window.location.href = '/login'
  }
  return (
    <header className="top">
      <div className="top-inner">
        <span className="brand">Supervisor Finder</span>
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <a key={l.href} href={l.href} className={l.active ? 'active' : undefined} aria-current={l.active ? 'page' : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="who">
          <span className="muted">{name}</span>
          <button type="button" className="ghost" onClick={logout}>Log out</button>
        </div>
      </div>
    </header>
  )
}
