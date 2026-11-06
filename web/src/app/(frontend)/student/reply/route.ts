import { NextResponse } from 'next/server'

import { addMessage, MAX_MESSAGE } from '@/lib/messages'
import { getSession, idOf } from '@/lib/session'

/** A student answers the supervisor on one of their own requests (for example after "Ask for details"). */
export async function POST(req: Request) {
  const { payload, user } = await getSession()
  if (!user || user.role !== 'student') return NextResponse.json({ detail: 'Sign in as a student.' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!body?.requestId || !message) return NextResponse.json({ detail: 'Write a message first.' }, { status: 400 })
  if (message.length > MAX_MESSAGE) return NextResponse.json({ detail: `The message is longer than ${MAX_MESSAGE} characters.` }, { status: 400 })
  try {
    // read with the student's own access, so a student can only write on their own requests
    const doc = await payload.findByID({ collection: 'requests', id: body.requestId, depth: 0, overrideAccess: false, user })
    if (idOf(doc.student) !== idOf(user.student)) return NextResponse.json({ detail: 'This request is not yours.' }, { status: 403 })
    if (!doc.supervisor) return NextResponse.json({ detail: 'No supervisor has been chosen yet.' }, { status: 400 })
    if (doc.status === 'rejected') return NextResponse.json({ detail: 'This request was declined, so it is closed.' }, { status: 400 })
    const sentAt = await addMessage(payload, doc.id, { from: 'student', subject: '', message })
    return NextResponse.json({ sentAt })
  } catch (e) {
    return NextResponse.json({ detail: (e as { message?: string }).message || 'The message could not be sent.' }, { status: 400 })
  }
}
