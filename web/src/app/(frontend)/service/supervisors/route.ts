import { timingSafeEqual } from 'crypto'
import { getPayload } from 'payload'

import { toPythonRecord } from '@/collections/Supervisors'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * For the Python service only: every supervisor record, in the shape app.py expects.
 * Python calls this at startup to rebuild search from the database (its own disk is
 * wiped on restart on a free host). Needs the shared X-Service-Key.
 */
export async function GET(req: Request) {
  const key = process.env.SERVICE_KEY || ''
  if (!key || !same(req.headers.get('x-service-key') || '', key)) return Response.json({ detail: 'Wrong or missing X-Service-Key.' }, { status: 401 })
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({ collection: 'supervisors', depth: 0, limit: 5000, pagination: false, overrideAccess: true })
  return Response.json({ records: docs.map(toPythonRecord) })
}
