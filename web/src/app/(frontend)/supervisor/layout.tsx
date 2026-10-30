import React from 'react'

import { requireRole } from '@/lib/session'
import { TopBar } from '../TopBar'

export default async function SupervisorLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole('supervisor')
  return (
    <>
      <TopBar
        name={user.name || user.email}
        links={[
          { href: '/supervisor', label: 'Requests' },
          { href: '/supervisor/profile', label: 'My profile' },
        ]}
      />
      {children}
    </>
  )
}
