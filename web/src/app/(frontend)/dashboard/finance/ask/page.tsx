import { requireRole } from '@/lib/session'
import { FinanceChat } from '../../../FinanceChat'

export default async function FinanceAskPage() {
  await requireRole('admin')
  return (
    <div className="finance-shell flush">
      <FinanceChat showSystems />
    </div>
  )
}
