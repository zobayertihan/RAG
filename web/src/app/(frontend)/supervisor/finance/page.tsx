import { requireRole } from '@/lib/session'
import { FinanceChat } from '../../FinanceChat'

export default async function SupervisorFinancePage() {
  await requireRole('supervisor')
  return (
    <div className="finance-shell">
      <FinanceChat />
    </div>
  )
}
