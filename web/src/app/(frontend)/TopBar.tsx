'use client'

import { usePathname } from 'next/navigation'
import React from 'react'

import { APP_NAME } from '@/lib/brand'

/** The link for the current page: the longest href that is the path itself or a parent of it. */
function currentHref(path: string, hrefs: string[]) {
  return hrefs
    .filter((h) => path === h || path.startsWith(h.endsWith('/') ? h : `${h}/`))
    .sort((a, b) => b.length - a.length)[0]
}

export function TopBar({ name, links }: { name: string; links: { href: string; label: string; active?: boolean }[] }) {
  const path = usePathname() || ''
  const current = currentHref(path, links.map((l) => l.href))
  async function logout() {
    await fetch('/api/users/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    window.location.href = '/login'
  }
  return (
    <header className={links.length > 5 ? 'top many' : 'top'}>
      <div className="top-inner">
        <span className="brand">{APP_NAME}</span>
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <a key={l.href} href={l.href} className={l.active || l.href === current ? 'active' : undefined}
              aria-current={l.active || l.href === current ? 'page' : undefined}>
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
