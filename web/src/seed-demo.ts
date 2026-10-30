/**
 * Demo data for the admin dashboard: made-up requests between the dummy students and real
 * supervisors, made-up slots for some supervisors, and made-up searches. Everything it
 * creates is marked synthetic and shown as "demo" on the dashboard. Run after `npm run seed`,
 * with the Python service running (it scores the searches and picks each student's top match).
 *
 *     npm run seed:demo
 *
 * Safe to run again: it first deletes the demo requests and searches it made before.
 * `npm run seed` puts every supervisor's slots back to the values in supervisors.json.
 * The demo student (Amina Rahman) gets no demo requests, so a live demo starts clean.
 */
import 'dotenv/config'
import { getPayload } from 'payload'

import config from './payload.config'
import { queryGaps } from './lib/python'

const ctx = { skipSideEffects: true } // no emails, LLM summaries, versions or search updates
const DAY = 86_400_000
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString()

// fixed random numbers, so every run makes the same demo data
let seed = 42
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1))

// Searches students might type: covered topics, and some the staff list covers poorly.
const SEARCHES: [string, number][] = [
  ['computer vision for quality inspection', 3], ['IoT sensors in manufacturing', 3], ['supply chain optimization', 2],
  ['renewable energy systems', 2], ['agile project management', 2], ['digital transformation of SMEs', 2],
  ['entrepreneurship and startups', 2], ['circular economy business models', 1], ['robotics and automation', 2],
  ['responsible AI and ethics', 1], ['smart grids', 1], ['lean production', 1],
  ['digital marketing', 3], ['marketing strategy on social media', 2], ['brand management', 2], ['consumer behavior online', 1],
  ['veterinary medicine', 2], ['animal health monitoring', 1],
  ['food science and nutrition', 2], ['food product development', 1],
  ['cybersecurity for small companies', 2], ['network security and intrusion detection', 1],
  ['music production technology', 1], ['sports analytics', 2], ['fashion design and textiles', 1], ['tax law for startups', 1],
]

const payload = await getPayload({ config })
const find = (collection: any, where: any) => payload.find({ collection, where, depth: 0, limit: 5000, pagination: false, overrideAccess: true })

// 0. clear earlier demo data
for (const c of ['requests', 'query-logs'] as const) {
  await payload.delete({ collection: c, where: { synthetic: { equals: true } }, overrideAccess: true, context: ctx })
}

// 1. ask the search service for scores and each student's top supervisor
const students = (await find('students', { recordId: { not_equals: 'student-001' } })).docs as any[]
const interests = students.map((s) => (s.interests?.[0]?.value || s.programme || 'thesis topic') as string)
const texts = [...new Set([...SEARCHES.map(([q]) => q), ...interests])]
let groups
try {
  groups = (await queryGaps(texts, 0.99)).groups // 0.99: every text is its own group, so each gets its own score
} catch (e) {
  console.error(`The Python service is not reachable (${(e as Error).message}).\nStart it first: uvicorn app:app --reload`)
  process.exit(1)
}
const score = new Map(groups.map((g) => [g.label, g]))

const sups = (await find('supervisors', {})).docs as any[]
const byName = new Map(sups.map((s) => [s.name, s]))
const searchable = sups.filter((s) => s.interests?.length && ['Distinguished Professor', 'Professor', 'Professor (Docent)', 'Associate Professor', 'Assistant Professor', 'Postdoc'].includes(s.position))
const hassan = sups.find((s) => s.recordId === 'btech-030')

// 2. plan the requests
type Plan = { student: any; sup: any; type: 'discuss' | 'supervision'; status: string; days: number; interest: string }
const STATUSES = ['accepted', 'pending', 'accepted', 'rejected', 'pending', 'info_requested', 'accepted', 'pending', 'accepted_discuss']
const plans: Plan[] = []
students.forEach((student, i) => {
  const interest = interests[i]
  const top = byName.get(score.get(interest)?.best_now_name ?? '') ?? searchable[int(0, searchable.length - 1)]
  let status = STATUSES[i % STATUSES.length]
  const type = status === 'accepted_discuss' ? 'discuss' : i % 4 === 3 ? 'discuss' : 'supervision'
  if (status === 'accepted_discuss') status = 'accepted'
  // some pending requests are old (stuck), the rest recent
  const days = status === 'pending' ? (i % 3 === 0 ? int(9, 20) : int(0, 6)) : int(4, 28)
  plans.push({ student, sup: top, type, status, days, interest })
  if (i % 4 === 1) {
    let other = searchable[int(0, searchable.length - 1)]
    if (other.id === top.id) other = searchable[(searchable.indexOf(other) + 1) % searchable.length]
    plans.push({ student, sup: other, type: 'discuss', status: 'pending', days: int(0, 12), interest })
  }
})
// the demo supervisor gets two new requests and one accepted student, so the supervisor demo has content
const forHassan = students.filter((s) => !plans.some((p) => p.student.id === s.id && p.sup.id === hassan.id)).slice(0, 3)
plans.push({ student: forHassan[0], sup: hassan, type: 'supervision', status: 'pending', days: 1, interest: 'computer vision for quality inspection' })
plans.push({ student: forHassan[1], sup: hassan, type: 'discuss', status: 'pending', days: 2, interest: 'underwater drones' })
plans.push({ student: forHassan[2], sup: hassan, type: 'supervision', status: 'accepted', days: 15, interest: 'robotics' })

// 3. slots: enough for the accepted students, some supervisors exactly full, a few more with free slots
const accepted = new Map<number, number>()
for (const p of plans) if (p.status === 'accepted' && p.type === 'supervision') accepted.set(p.sup.id, (accepted.get(p.sup.id) || 0) + 1)
const capacity = new Map<number, number>()
for (const [id, n] of accepted) if (id !== hassan.id) capacity.set(id, Math.min(7, n + (rand() < 0.4 ? 0 : int(1, 3))))
for (const s of searchable.filter((s) => !accepted.has(s.id) && s.id !== hassan.id).sort(() => rand() - 0.5).slice(0, 8)) capacity.set(s.id, int(2, 5))
for (const [id, cap] of capacity) await payload.update({ collection: 'supervisors', id, data: { capacity: cap }, overrideAccess: true, context: ctx })

// 4. create the requests, then answer them, then set the dates
for (const p of plans) {
  const note = p.type === 'supervision'
    ? `I would like to write my thesis on ${p.interest.toLowerCase()} and I think your research fits well. I can send a one-page proposal.`
    : `I have an early idea about ${p.interest.toLowerCase()} and would like to hear your view before I decide on a topic.`
  const doc = await payload.create({
    collection: 'requests', overrideAccess: true, context: ctx,
    data: { student: p.student.id, supervisor: p.sup.id, type: p.type, note, status: 'pending', synthetic: true },
  })
  if (p.status !== 'pending') await payload.update({ collection: 'requests', id: doc.id, data: { status: p.status as any }, overrideAccess: true, context: ctx })
  const sent = ago(p.days, int(0, 8))
  const answered = p.status === 'pending' ? null : new Date(Math.min(Date.now(), new Date(sent).getTime() + int(1, 4) * DAY)).toISOString()
  await payload.update({ collection: 'requests', id: doc.id, data: { createdAt: sent, answeredAt: answered } as any, overrideAccess: true, context: ctx })
}

// 5. searches, spread over the last 30 days
let logs = 0
for (const [q, times] of SEARCHES) {
  for (let k = 0; k < times; k++) {
    const doc = await payload.create({
      collection: 'query-logs', overrideAccess: true,
      data: { query: q, mode: 'supervisors', bestScore: score.get(q)?.best_now ?? null, synthetic: true },
    })
    await payload.update({ collection: 'query-logs', id: doc.id, data: { createdAt: ago(int(0, 30), int(0, 20)) } as any, overrideAccess: true })
    logs++
  }
}

console.log(`demo requests: ${plans.length} (${plans.filter((p) => p.status === 'pending' && p.days > 7).length} waiting over 7 days)`)
console.log(`demo slots set for ${capacity.size} supervisors; demo searches: ${logs}`)
process.exit(0)
