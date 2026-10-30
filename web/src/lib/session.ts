import { headers as getHeaders } from 'next/headers.js'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@/payload.config'

export type SessionUser = {
  id: number
  email: string
  name?: string | null
  role?: 'student' | 'supervisor' | 'admin'
  student?: number | { id: number } | null
  supervisor?: number | { id: number } | null
}

export async function getSession() {
  const payload = await getPayload({ config: await config })
  const { user } = await payload.auth({ headers: await getHeaders() })
  return { payload, user: user as unknown as SessionUser | null }
}

// Supervisors use the admin panel until their own page arrives in Phase 6.
export const homeFor = (role?: string) => (role === 'student' ? '/student' : '/admin')

/** Server-side guard for a page: sends people who aren't signed in, or have another role, away. */
export async function requireRole(...roles: NonNullable<SessionUser['role']>[]) {
  const session = await getSession()
  if (!session.user) redirect('/login')
  if (!roles.includes(session.user.role!)) redirect(homeFor(session.user.role))
  return session as { payload: typeof session.payload; user: SessionUser }
}

export const idOf = (v: unknown) => (v && typeof v === 'object' ? (v as { id: number }).id : (v as number | undefined))
