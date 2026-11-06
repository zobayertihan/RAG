import { notFound } from 'next/navigation'

import { financeEnabled } from '@/lib/features'
import { requireRole } from '@/lib/session'
import { FinanceChat } from '../../../FinanceChat'

export const metadata = { title: 'Finance assistant' }

export default async function FinanceAskPage() {
  await requireRole('admin')
  if (!financeEnabled()) notFound()
  return (
    <div className="finance-shell flush">
      <FinanceChat showSystems />
    </div>
  )
}
