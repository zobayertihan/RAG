import { redirect } from 'next/navigation'

import { getSession, homeFor } from '@/lib/session'
import { LoginForm } from './LoginForm'

export default async function LoginPage() {
  const { user } = await getSession()
  if (user) redirect(homeFor(user.role))
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Supervisor Finder</h1>
        <p className="muted">Sign in with your AU account. In this prototype, use one of the demo logins.</p>
        <LoginForm />
      </div>
    </div>
  )
}
