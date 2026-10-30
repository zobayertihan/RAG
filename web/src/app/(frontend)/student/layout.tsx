import React from 'react'

import { requireRole } from '@/lib/session'
import { TopBar } from '../TopBar'

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole('student', 'admin')
  return (
    <>
      <TopBar
        name={user.name || user.email}
        links={[
          { href: '/student', label: 'Find supervisors' },
          { href: '/student/requests', label: 'My requests' },
        ]}
      />
      {children}
    </>
  )
}
