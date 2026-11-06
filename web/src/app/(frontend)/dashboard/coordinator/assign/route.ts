import { NextResponse } from 'next/server'

import { getSession } from '@/lib/session'

/** The coordinator picks a supervisor for a coordinator request; the Requests hooks check slots and duplicates. */
export async function POST(req: Request) {
  const { payload, user } = await getSession()
  if (!user || user.role !== 'admin') return NextResponse.json({ detail: 'Only the coordinator (admin) can do this.' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body?.requestId || !body?.supervisorId) return NextResponse.json({ detail: 'Choose a supervisor.' }, { status: 400 })
  try {
    const doc = await payload.update({
      collection: 'requests', id: body.requestId, depth: 1, overrideAccess: false, user,
      data: { supervisor: Number(body.supervisorId), coordinatorNote: String(body.note || '').slice(0, 1000) || null },
    })
    const sup = typeof doc.supervisor === 'object' ? doc.supervisor : null
    return NextResponse.json({ status: doc.status, supervisor: sup?.name ?? '', emailed: !!sup?.email })
  } catch (e) {
    return NextResponse.json({ detail: (e as Error).message || 'Could not assign.' }, { status: 400 })
  }
}
