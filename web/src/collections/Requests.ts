import { APIError, type CollectionConfig, type Where } from 'payload'

import { adminField, isAdmin, relId, roleOf, studentIdOf, supervisorIdOf } from '../access'
import { summarizeNote } from '../lib/python'

export const MAX_OPEN_REQUESTS = 3 // per student, to confirm at the 4 Nov meeting
const OPEN = ['pending', 'info_requested']

const fail = (msg: string) => new APIError(msg, 400, undefined, true)

export const Requests: CollectionConfig = {
  slug: 'requests',
  admin: { useAsTitle: 'id', defaultColumns: ['student', 'supervisor', 'type', 'status', 'createdAt'] },
  access: {
    read: ({ req }): boolean | Where => {
      const role = roleOf(req)
      if (role === 'admin') return true
      if (role === 'supervisor') {
        const id = supervisorIdOf(req)
        return id !== undefined ? { supervisor: { equals: id } } : false
      }
      if (role === 'student') {
        const id = studentIdOf(req)
        return id !== undefined ? { student: { equals: id } } : false
      }
      return false
    },
    create: ({ req }) => roleOf(req) === 'student' || roleOf(req) === 'admin',
    // Supervisors answer requests sent to them; students can't edit after sending.
    update: ({ req }) => {
      if (roleOf(req) === 'admin') return true
      const id = supervisorIdOf(req)
      return roleOf(req) === 'supervisor' && id !== undefined ? { supervisor: { equals: id } } : false
    },
    delete: isAdmin, // requests are never deleted in normal use, only answered
  },
  fields: [
    { name: 'student', type: 'relationship', relationTo: 'students', required: true, access: { update: adminField } },
    { name: 'supervisor', type: 'relationship', relationTo: 'supervisors', required: true, access: { update: adminField } },
    { name: 'type', type: 'select', required: true, access: { update: adminField },
      options: [{ label: 'Discuss an idea', value: 'discuss' }, { label: 'Request supervision', value: 'supervision' }] },
    { name: 'note', type: 'textarea', required: true, maxLength: 2000, access: { update: adminField },
      admin: { description: 'Preliminary idea, or why the student chose this supervisor.' } },
    { name: 'status', type: 'select', required: true, defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'More details asked', value: 'info_requested' },
        { label: 'Accepted', value: 'accepted' },
        { label: 'Rejected', value: 'rejected' },
      ] },
    { name: 'noteSummary', type: 'textarea', admin: { readOnly: true, description: 'Two-sentence LLM summary for the supervisor. It never decides.' } },
    { name: 'answeredAt', type: 'date', admin: { readOnly: true } },
  ],
  hooks: {
    afterChange: [
      async ({ doc, operation, req, context }) => {
        // Tell the supervisor a new request has arrived. Without an email setup (the prototype),
        // Payload prints the email in the terminal instead of sending it.
        if (operation !== 'create' || context.skipSideEffects) return doc
        try {
          const sup = await req.payload.findByID({ collection: 'supervisors', id: relId(doc.supervisor) as number, depth: 0, overrideAccess: true, req })
          const stu = await req.payload.findByID({ collection: 'students', id: relId(doc.student) as number, depth: 0, overrideAccess: true, req })
          if (sup.email) {
            const base = process.env.WEB_URL || 'http://localhost:3000'
            await req.payload.sendEmail({
              to: sup.email,
              subject: `New ${doc.type === 'supervision' ? 'supervision request' : 'request to discuss an idea'} from ${stu.name}`,
              text: `${stu.name} (${stu.programme || 'programme not given'}) wrote:\n\n${doc.note}\n\n` +
                `${doc.noteSummary ? `Summary: ${doc.noteSummary}\n\n` : ''}Answer it here: ${base}/supervisor`,
            })
          }
        } catch (e) {
          req.payload.logger.warn(`Request notice not sent: ${(e as Error).message}`)
        }
        return doc
      },
    ],
    beforeChange: [
      async ({ data, operation, originalDoc, req, context }) => {
        const payload = req.payload

        if (operation === 'create') {
          // A student always sends as themselves, whatever the form says.
          if (roleOf(req) === 'student') data.student = studentIdOf(req)
          data.status = 'pending'
          const studentId = relId(data.student)
          const supervisorId = relId(data.supervisor)

          const open = await payload.find({
            collection: 'requests', depth: 0, limit: 100, overrideAccess: true, req,
            where: { and: [{ student: { equals: studentId } }, { status: { in: OPEN } }] },
          })
          if (open.docs.some((d) => relId(d.supervisor) === supervisorId)) {
            throw fail('You already have an open request to this supervisor.')
          }
          if (open.totalDocs >= MAX_OPEN_REQUESTS) {
            throw fail(`You can have at most ${MAX_OPEN_REQUESTS} open requests. Wait for an answer first.`)
          }

          const sup = await payload.findByID({ collection: 'supervisors', id: supervisorId as number, depth: 0, overrideAccess: true, req })
          if (data.type === 'supervision' && typeof sup.capacity === 'number' && (sup.slotsUsed ?? 0) >= sup.capacity) {
            throw fail(`${sup.name} has no supervision slots left. You can still ask to discuss an idea.`)
          }

          if (!context.skipSideEffects) {
            try {
              data.noteSummary = (await summarizeNote(data.note, sup.recordId, data.type)).summary ?? ''
            } catch (e) {
              payload.logger.warn(`No note summary: ${(e as Error).message}`)
            }
          }
          return data
        }

        // update
        if (data.status && data.status !== originalDoc?.status) {
          if (originalDoc?.status === 'pending' || originalDoc?.status === 'info_requested') {
            data.answeredAt = new Date().toISOString()
          }
          if (data.status === 'accepted' && (data.type ?? originalDoc?.type) === 'supervision') {
            // Checked at the moment of acceptance, on the server, so two accepts can't overbook.
            const supervisorId = relId(originalDoc?.supervisor)
            const sup = await payload.findByID({ collection: 'supervisors', id: supervisorId as number, depth: 0, overrideAccess: true, req })
            if (typeof sup.capacity === 'number' && (sup.slotsUsed ?? 0) >= sup.capacity) {
              throw fail('No supervision slots left. Lower another commitment or ask the admin to raise your slots.')
            }
          }
        }
        return data
      },
    ],
  },
}
