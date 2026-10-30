import { NextResponse } from 'next/server'

import { draftEmail } from '@/lib/python'
import { getSession, idOf } from '@/lib/session'

const STATUS = { accept: 'accepted', reject: 'rejected', ask_details: 'info_requested' } as const

/**
 * A supervisor answers a request: the status is saved first (with all the rules, such as
 * the slot check), then an email draft is made. The draft is never sent automatically;
 * the supervisor opens it in Outlook and edits it.
 */
export async function POST(req: Request) {
  const { payload, user } = await getSession()
  if (!user || user.role !== 'supervisor') return NextResponse.json({ detail: 'Sign in as a supervisor.' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const action = body?.action as keyof typeof STATUS
  if (!body?.requestId || !(action in STATUS)) return NextResponse.json({ detail: 'Unknown answer.' }, { status: 400 })

  let doc
  try {
    doc = await payload.update({
      collection: 'requests', id: body.requestId, data: { status: STATUS[action] }, depth: 1, overrideAccess: false, user,
    })
  } catch (e) {
    const msg = (e as { message?: string }).message || 'The answer could not be saved.'
    return NextResponse.json({ detail: msg }, { status: 400 })
  }

  const student = typeof doc.student === 'object' ? doc.student : null
  const sup = await payload.findByID({ collection: 'supervisors', id: idOf(user.supervisor)!, depth: 0, overrideAccess: false, user })
  const emailAction = action === 'accept' && doc.type === 'discuss' ? 'accept_discuss' : action
  let draft
  try {
    draft = await draftEmail({ action: emailAction, student_name: student?.name || 'student', supervisor_name: sup.name, note: doc.note })
  } catch (e) {
    payload.logger.warn(`No email draft: ${(e as Error).message}`)
    draft = { subject: 'Your request', body: `Dear ${student?.name || 'student'},\n\n\n\nBest regards,\n${sup.name}`, personalized: false }
  }
  return NextResponse.json({ status: doc.status, answeredAt: doc.answeredAt, draft: { to: student?.email || '', ...draft } })
}
