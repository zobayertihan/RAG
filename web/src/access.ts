import { APIError } from 'payload'
import type { Access, FieldAccess, PayloadRequest } from 'payload'

export type Role = 'student' | 'supervisor' | 'admin'

type AnyUser = { role?: Role; supervisor?: unknown; student?: unknown } | null | undefined

/** A relationship can arrive as an id or as the full document, depending on depth. */
export const relId = (value: unknown): number | string | undefined => {
  if (value && typeof value === 'object' && 'id' in value) return (value as { id: number | string }).id
  return (value as number | string | undefined) ?? undefined
}

export const roleOf = (req: PayloadRequest): Role | undefined => (req.user as AnyUser)?.role
export const supervisorIdOf = (req: PayloadRequest) => relId((req.user as AnyUser)?.supervisor)
export const studentIdOf = (req: PayloadRequest) => relId((req.user as AnyUser)?.student)

export const isAdmin: Access = ({ req }) => roleOf(req) === 'admin'
export const isLoggedIn: Access = ({ req }) => Boolean(req.user)
export const adminField: FieldAccess = ({ req }) => roleOf(req) === 'admin'

/**
 * A rule error whose message the person sees (e.g. "no slots left"). The name is set by hand:
 * the production build shortens class names, and Payload then hides the message.
 */
export const ruleError = (message: string) => {
  const e = new APIError(message, 400, undefined, true)
  e.name = 'APIError'
  return e
}
