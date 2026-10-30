import { redirect } from 'next/navigation'

import { getSession, homeFor } from '@/lib/session'

// The start page sends everyone to their own area, or to the login page.
export default async function HomePage() {
  const { user } = await getSession()
  redirect(user ? homeFor(user.role) : '/login')
}
