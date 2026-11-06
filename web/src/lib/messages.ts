import type { Payload } from 'payload'

export type Message = { from: 'supervisor' | 'student'; subject: string; message: string; sentAt: string }
export const MAX_MESSAGE = 5000

/** A request's messages in the shape the pages use. */
export const messagesOf = (replies: unknown): Message[] =>
  (Array.isArray(replies) ? replies : []).map((m) => ({
    from: m.from === 'student' ? 'student' : 'supervisor', subject: m.subject || '', message: m.message, sentAt: m.sentAt,
  }))

/**
 * Adds one message to a request. Callers check first that the person may write on this request.
 * The other side gets a notice (printed in the server log while no email service is set up).
 */
export async function addMessage(payload: Payload, requestId: number, msg: Omit<Message, 'sentAt'>) {
  const doc = await payload.findByID({ collection: 'requests', id: requestId, depth: 1, overrideAccess: true })
  const sentAt = new Date().toISOString()
  const replies = [
    ...(doc.replies || []).map(({ from, subject, message, status, sentAt }) => ({ from, subject, message, status, sentAt })),
    { ...msg, status: doc.status, sentAt },
  ]
  await payload.update({ collection: 'requests', id: requestId, data: { replies }, depth: 0, overrideAccess: true })

  const sup = typeof doc.supervisor === 'object' ? doc.supervisor : null
  const stu = typeof doc.student === 'object' ? doc.student : null
  const to = msg.from === 'student' ? sup?.email : stu?.email
  if (to) {
    const base = process.env.WEB_URL || 'http://localhost:3000'
    const who = msg.from === 'student' ? stu?.name || 'The student' : sup?.name || 'Your supervisor'
    payload.sendEmail({
      to, subject: `New message from ${who}`,
      text: `${who} wrote:\n\n${msg.message}\n\nAnswer it here: ${base}${msg.from === 'student' ? '/supervisor' : '/student/requests'}`,
    }).catch((e) => payload.logger.warn(`Message notice not sent: ${(e as Error).message}`))
  }
  return sentAt
}
