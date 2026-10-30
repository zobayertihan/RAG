/**
 * Fills the database from ../data/supervisors.json and ../data/students_dummy.json,
 * and creates one test login per role. Safe to run again: existing records are updated.
 *
 *     npm run seed
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { getPayload } from 'payload'

import config from './payload.config'

const DATA = path.resolve(process.cwd(), '..', 'data')
const PASSWORD = process.env.SEED_PASSWORD || 'demo-password-1'
const ctx = { skipSideEffects: true } // no search updates or version entries while seeding
const rows = (xs?: string[]) => (xs || []).filter(Boolean).map((value) => ({ value }))

async function upsert(payload: any, collection: string, recordId: string, data: Record<string, unknown>) {
  const found = await payload.find({ collection, where: { recordId: { equals: recordId } }, limit: 1, depth: 0, overrideAccess: true })
  if (found.docs[0]) return payload.update({ collection, id: found.docs[0].id, data, overrideAccess: true, context: ctx })
  return payload.create({ collection, data: { recordId, ...data }, overrideAccess: true, context: ctx })
}

async function login(payload: any, email: string, data: Record<string, unknown>) {
  const found = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, overrideAccess: true })
  if (found.docs[0]) return payload.update({ collection: 'users', id: found.docs[0].id, data, overrideAccess: true })
  return payload.create({ collection: 'users', data: { email, password: PASSWORD, ...data }, overrideAccess: true })
}

const payload = await getPayload({ config })

const sups = JSON.parse(fs.readFileSync(path.join(DATA, 'supervisors.json'), 'utf-8'))
const supId: Record<string, number> = {}
for (const s of sups) {
  const doc = await upsert(payload, 'supervisors', s.id, {
    name: s.name, position: s.position, interests: rows(s.interests), requirements: rows(s.requirements),
    capacity: s.capacity ?? null, type: s.type || null, researchGroup: s.research_group || '', room: s.room || '',
    email: s.email || null, profileUrl: s.profile_url || '',
    profileUpdatedAt: s.updated_at ? new Date(s.updated_at).toISOString() : null,
  })
  supId[s.id] = doc.id
}
console.log(`supervisors: ${sups.length}`)

const studs = JSON.parse(fs.readFileSync(path.join(DATA, 'students_dummy.json'), 'utf-8'))
const stuId: Record<string, number> = {}
for (const s of studs) {
  const doc = await upsert(payload, 'students', s.id, {
    name: s.name, email: s.email || null, programme: s.programme, skills: rows(s.skills),
    pastProjects: rows(s.past_projects), interests: rows(s.interest), synthetic: s.synthetic !== false,
  })
  stuId[s.id] = doc.id
}
console.log(`students: ${studs.length}`)

// Demo logins. Supervisor = Syed Ali Hassan (btech-030), student = Amina Rahman (student-001).
// The demo supervisor gets 7 slots so the slot count can be shown; everyone else stays "not set".
await payload.update({ collection: 'supervisors', id: supId['btech-030'], data: { capacity: 7 }, overrideAccess: true, context: ctx })
await login(payload, 'admin@example.com', { name: 'Demo admin', role: 'admin' })
await login(payload, 'supervisor@example.com', { name: 'Demo supervisor (Syed Ali Hassan)', role: 'supervisor', supervisor: supId['btech-030'] })
await login(payload, 'student@example.com', { name: 'Demo student (Amina Rahman)', role: 'student', student: stuId['student-001'] })
console.log(`logins: admin@example.com, supervisor@example.com, student@example.com (password: ${PASSWORD})`)
process.exit(0)
