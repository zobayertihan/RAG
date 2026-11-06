import { financeEnabled } from '@/lib/features'
import { StudentChat } from './StudentChat'

export const metadata = { title: 'Find supervisors' }

export default function StudentPage() {
  return <StudentChat finance={financeEnabled()} />
}
