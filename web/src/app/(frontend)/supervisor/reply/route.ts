import { NextResponse } from 'next/server'

import { addMessage, MAX_MESSAGE } from '@/lib/messages'
import { getSession, idOf } from '@/lib/session'

/** A supervisor writes to the student on one of their requests. Shown under the student's My requests. */
export async function POST(req: Request) {
  const { payload, user } = await getSession()
  if (!user || user.role !== 'supervisor') return NextResponse.json({ detail: 'Sign in as a supervisor.' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const subject = typeof body?.subject === 'string' ? body.subject.trim().slice(0, 200) : ''
  if (!body?.requestId || !message) return NextResponse.json({ detail: 'Write a message first.' }, { status: 400 })
  if (message.length > MAX_MESSAGE) return NextResponse.json({ detail: `The message is longer than ${MAX_MESSAGE} characters.` }, { status: 400 })
  try {
    // read with the supervisor's own access, so only requests sent to them can be answered
    const doc = await payload.findByID({ collection: 'requests', id: body.requestId, depth: 0, overrideAccess: false, user })
    if (idOf(doc.supervisor) !== idOf(user.supervisor)) return NextResponse.json({ detail: 'This request is not yours.' }, { status: 403 })
    const sentAt = await addMessage(payload, doc.id, { from: 'supervisor', subject, message })
    return NextResponse.json({ sentAt })
  } catch (e) {
    return NextResponse.json({ detail: (e as { message?: string }).message || 'The message could not be sent.' }, { status: 400 })
  }
}
