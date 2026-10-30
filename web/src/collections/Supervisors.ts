import type { CollectionConfig, PayloadRequest } from 'payload'

import { adminField, isAdmin, isLoggedIn, relId, roleOf, ruleError, supervisorIdOf } from '../access'
import { reindexSupervisor, type PythonSupervisor } from '../lib/python'

// Fields whose changes are kept in ProfileVersions (the thesis' freshness record).
const TRACKED = ['name', 'position', 'interests', 'requirements', 'capacity', 'type', 'researchGroup', 'room', 'email', 'profileUrl'] as const

const list = (rows: unknown) =>
  Array.isArray(rows) ? rows.map((r) => String((r as { value?: string }).value ?? '').trim()).filter(Boolean) : []

/** A field's value without row ids or empty strings, so only real content changes count. */
export const plain = (field: string, v: unknown): unknown =>
  field === 'interests' || field === 'requirements' ? list(v) : v === '' || v === undefined ? null : v

const changedFields = (before: Record<string, any> | undefined, after: Record<string, any>) =>
  TRACKED.filter((f) => JSON.stringify(plain(f, before?.[f])) !== JSON.stringify(plain(f, after[f])))

export const toPythonRecord = (doc: Record<string, any>): PythonSupervisor => ({
  id: doc.recordId,
  name: doc.name,
  position: doc.position,
  interests: list(doc.interests),
  profile_url: doc.profileUrl || '',
  email: doc.email || '',
  room: doc.room || '',
  research_group: doc.researchGroup || '',
  type: doc.type || '',
  requirements: list(doc.requirements),
  capacity: typeof doc.capacity === 'number' ? doc.capacity : null,
})

const ownRecord = (req: PayloadRequest) => {
  const sid = supervisorIdOf(req)
  return sid !== undefined ? { id: { equals: sid } } : false
}

export const Supervisors: CollectionConfig = {
  slug: 'supervisors',
  defaultSort: 'name',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'position', 'researchGroup', 'type', 'capacity', 'slotsUsed'] },
  access: {
    read: isLoggedIn,
    create: isAdmin,
    delete: isAdmin,
    // Admins edit everyone; a supervisor edits only their own record.
    update: ({ req }) => (roleOf(req) === 'admin' ? true : roleOf(req) === 'supervisor' ? ownRecord(req) : false),
  },
  fields: [
    { name: 'recordId', type: 'text', required: true, unique: true, index: true, access: { update: adminField },
      admin: { description: 'Id shared with the Python search service, e.g. btech-030.' } },
    { name: 'name', type: 'text', required: true, access: { update: adminField } },
    { name: 'position', type: 'text', required: true, access: { update: adminField } },
    { name: 'interests', type: 'array', fields: [{ name: 'value', type: 'text', required: true }],
      admin: { description: 'Research areas. This is what search matches on.' } },
    { name: 'requirements', type: 'array', fields: [{ name: 'value', type: 'text', required: true }],
      admin: { description: 'What a supervisor expects from students, e.g. "Python", "a company partner".' } },
    { name: 'capacity', type: 'number', min: 0, max: 7,
      admin: { description: 'Supervision slots this semester, 0 to 7. Set by the admin; a supervisor can only lower it (to confirm at the 4 Nov meeting).' } },
    { name: 'slotsUsed', type: 'number', virtual: true, admin: { readOnly: true, description: 'Accepted supervision requests.' },
      hooks: {
        afterRead: [
          async ({ data, req }) => {
            if (!data?.id) return 0
            const { totalDocs } = await req.payload.count({
              collection: 'requests',
              where: { and: [{ supervisor: { equals: data.id } }, { status: { equals: 'accepted' } }, { type: { equals: 'supervision' } }] },
              req,
            })
            return totalDocs
          },
        ],
      } },
    { name: 'type', type: 'select', access: { update: adminField },
      options: [{ label: 'Business', value: 'business' }, { label: 'Engineering', value: 'engineering' }, { label: 'Generalist', value: 'generalist' }],
      admin: { description: 'Used for the typed suggestion cards (Phase 2, after the meeting).' } },
    { name: 'researchGroup', type: 'text', access: { update: adminField } },
    { name: 'room', type: 'text' },
    { name: 'email', type: 'email', access: { update: adminField } },
    { name: 'profileUrl', type: 'text', access: { update: adminField } },
    // Set by the hook below only; any value sent in by a person is ignored.
    { name: 'profileUpdatedAt', type: 'date',
      admin: { readOnly: true, position: 'sidebar', description: 'When the profile content last changed (not when the record was last saved).' } },
  ],
  hooks: {
    beforeChange: [
      ({ data, originalDoc, operation, req, context }) => {
        // Supervisors may lower their slots but not raise them.
        if (operation === 'update' && roleOf(req) === 'supervisor' && typeof data.capacity === 'number') {
          const before = typeof originalDoc?.capacity === 'number' ? originalDoc.capacity : null
          if (before === null || data.capacity > before) {
            throw ruleError('You can lower your slots, but only the admin can raise them.')
          }
        }
        // The freshness date moves only when the content changes. The seed sets it itself.
        if (!context.skipSideEffects) {
          const merged = { ...(originalDoc || {}), ...data }
          data.profileUpdatedAt = operation === 'create' || changedFields(originalDoc, merged).length
            ? new Date().toISOString()
            : originalDoc?.profileUpdatedAt ?? null
        }
        return data
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, operation, req, context }) => {
        if (context.skipSideEffects) return doc
        // 1. Keep the old version (freshness record).
        if (operation === 'update') {
          const changed = changedFields(previousDoc, doc)
          if (changed.length) {
            const snapshot = Object.fromEntries(TRACKED.map((f) => [f, plain(f, previousDoc?.[f])]))
            const changes = Object.fromEntries(changed.map((f) => [f, { from: plain(f, previousDoc?.[f]), to: plain(f, doc[f]) }]))
            await req.payload.create({
              collection: 'profile-versions',
              data: { supervisor: doc.id, changedFields: changed.join(', '), previous: snapshot, changes, changedBy: relId(req.user?.id) as number },
              overrideAccess: true,
              req,
            })
          }
        }
        // 2. Update search right away. A failure doesn't undo the save; it is logged.
        try {
          await reindexSupervisor(toPythonRecord(doc))
        } catch (e) {
          req.payload.logger.warn(`Search was not updated for ${doc.recordId}: ${(e as Error).message}`)
        }
        return doc
      },
    ],
  },
}
