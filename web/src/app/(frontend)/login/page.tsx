import { redirect } from 'next/navigation'

import { APP_NAME, APP_TAGLINE } from '@/lib/brand'
import { getSession, homeFor } from '@/lib/session'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in' }

export default async function LoginPage() {
  const { user } = await getSession()
  if (user) redirect(homeFor(user.role))
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>{APP_NAME}</h1>
        <p className="muted">{APP_TAGLINE} Sign in with your AU account. In this prototype, use one of the demo logins.</p>
        <LoginForm />
      </div>
    </div>
  )
}
