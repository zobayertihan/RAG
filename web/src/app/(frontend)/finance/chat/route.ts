import { NextResponse, after } from 'next/server'

import { chat } from '@/lib/python'
import { getSession } from '@/lib/session'

export const maxDuration = 300 // room for a sleeping search service to wake up

const SYSTEMS = ['plain', 'newest', 'versioned', 'versioned_faq'] as const

/**
 * Travel and expense questions, for every signed-in role. Students are answered as students,
 * everyone else as staff. Only admins may pick a search system (to compare them in a demo);
 * everyone else always gets the full version-aware system.
 */
export async function POST(req: Request) {
  const { payload, user } = await getSession()
  if (!user) return NextResponse.json({ detail: 'Sign in first.' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body?.messages?.length) return NextResponse.json({ detail: 'No message.' }, { status: 400 })
  const system = user.role === 'admin' && SYSTEMS.includes(body.system) ? body.system : 'versioned_faq'
  const corpus = body.corpus === 'synthetic' ? 'synthetic' : 'real'

  let data: Record<string, any>
  try {
    data = await chat({ messages: body.messages.slice(-20), mode: 'finance', system, corpus, role: user.role === 'student' ? 'student' : 'staff' })
  } catch (e) {
    return NextResponse.json({ detail: (e as Error).message }, { status: 502 })
  }
  const log = { query: String(data.query || '').slice(0, 500), mode: 'finance', bestScore: data.best_score ?? null, filters: { system, corpus } }
  after(() =>
    payload
      .create({ collection: 'query-logs', data: log, overrideAccess: true })
      .then(() => undefined, (e) => payload.logger.warn(`Query not logged: ${(e as Error).message}`)),
  )
  return NextResponse.json(data)
}
