import { NextResponse, after } from 'next/server'

import { chat } from '@/lib/python'
import { getSession } from '@/lib/session'

type Card = { record_id?: string; [k: string]: unknown }

/**
 * The student chat goes through here instead of straight to Python: it checks the login,
 * stores the query (without who asked) for the admin's demand view, and adds live slot
 * numbers from the database to each card.
 */
export async function POST(req: Request) {
  const { payload, user } = await getSession()
  if (!user || (user.role !== 'student' && user.role !== 'admin')) {
    return NextResponse.json({ detail: 'Sign in as a student first.' }, { status: 401 })
  }
  const body = await req.json().catch(() => null)
  if (!body?.messages?.length) return NextResponse.json({ detail: 'No message.' }, { status: 400 })

  let data: Record<string, any>
  try {
    data = await chat({ messages: body.messages.slice(-20), mode: body.mode || 'supervisors', filters: body.filters || null })
  } catch (e) {
    return NextResponse.json({ detail: (e as Error).message }, { status: 502 })
  }

  // Query log for the admin dashboard (Phase 7). A failure here never breaks the chat.
  // after(): on Vercel, work left running after the response is cut off unless registered here.
  const log = { query: String(data.query || '').slice(0, 500), mode: data.mode, bestScore: data.best_score ?? null, filters: body.filters || null }
  after(() =>
    payload
      .create({ collection: 'query-logs', data: log, overrideAccess: true })
      .then(() => undefined, (e) => payload.logger.warn(`Query not logged: ${(e as Error).message}`)),
  )

  // Live slots and the database id for the Contact button, matched by recordId.
  const cards: Card[] = [...(data.supervisors || []), ...(data.mentions || []), ...(data.matches || [])]
  const ids = [...new Set(cards.map((c) => c.record_id).filter(Boolean))] as string[]
  if (ids.length) {
    const found = await payload.find({
      collection: 'supervisors', where: { recordId: { in: ids } }, limit: ids.length, depth: 0, overrideAccess: true,
    })
    const byRecord = new Map(found.docs.map((d) => [d.recordId, d]))
    for (const c of cards) {
      const d = c.record_id ? byRecord.get(c.record_id) : undefined
      if (d) Object.assign(c, { supervisorId: d.id, capacity: d.capacity ?? null, slotsUsed: d.slotsUsed ?? 0, type: d.type || '' })
    }
  }
  return NextResponse.json(data)
}
