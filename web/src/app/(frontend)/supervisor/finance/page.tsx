import { notFound } from 'next/navigation'

import { financeEnabled } from '@/lib/features'
import { requireRole } from '@/lib/session'
import { FinanceChat } from '../../FinanceChat'

export const metadata = { title: 'Travel and expenses' }

export default async function SupervisorFinancePage() {
  await requireRole('supervisor')
  if (!financeEnabled()) notFound()
  return (
    <div className="finance-shell">
      <FinanceChat />
    </div>
  )
}
