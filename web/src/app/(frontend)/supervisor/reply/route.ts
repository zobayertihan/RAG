import { NextResponse } from 'next/server'

import { getSession, idOf } from '@/lib/session'

/**
 * A supervisor sends their (edited) email draft to the student inside the app. It is added to
 * the request's messages, and the student sees it under My requests. Nothing is emailed.
 */
export async function POST(req: Request) {
  const { payload, user } = await getSession()
  if (!user || user.role !== 'supervisor') return NextResponse.json({ detail: 'Sign in as a supervisor.' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const subject = typeof body?.subject === 'string' ? body.subject.trim().slice(0, 200) : ''
  if (!body?.requestId || !message) return NextResponse.json({ detail: 'Write a message first.' }, { status: 400 })
  if (message.length > 5000) return NextResponse.json({ detail: 'The message is longer than 5000 characters.' }, { status: 400 })

  try {
    // read with the supervisor's own access, so only requests sent to them can be answered
    const doc = await payload.findByID({ collection: 'requests', id: body.requestId, depth: 0, overrideAccess: false, user })
    if (idOf(doc.supervisor) !== idOf(user.supervisor)) return NextResponse.json({ detail: 'This request is not yours.' }, { status: 403 })
    const sentAt = new Date().toISOString()
    const replies = [...(doc.replies || []).map(({ subject, message, status, sentAt }) => ({ subject, message, status, sentAt })),
      { subject, message, status: doc.status, sentAt }]
    await payload.update({ collection: 'requests', id: doc.id, data: { replies }, depth: 0, overrideAccess: false, user })
    return NextResponse.json({ sentAt })
  } catch (e) {
    return NextResponse.json({ detail: (e as { message?: string }).message || 'The message could not be sent.' }, { status: 400 })
  }
}
