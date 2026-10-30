import React from 'react'

import { requireRole } from '@/lib/session'
import { TopBar } from '../TopBar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole('admin')
  return (
    <>
      <TopBar
        name={user.name || user.email}
        links={[
          { href: '/dashboard', label: 'Overview' },
          { href: '/dashboard/supervisors', label: 'Supervisors' },
          { href: '/dashboard/requests', label: 'Requests' },
          { href: '/dashboard/demand', label: 'Demand' },
          { href: '/dashboard/changes', label: 'Changes' },
          { href: '/dashboard/data', label: 'Import/export' },
          { href: '/admin', label: 'Admin panel' },
        ]}
      />
      <div className="dash">{children}</div>
    </>
  )
}
