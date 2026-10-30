import type { CollectionConfig } from 'payload'

import { adminField, isAdmin, roleOf } from '../access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email', defaultColumns: ['email', 'name', 'role'] },
  auth: true,
  access: {
    // Only admins create accounts. Payload still lets the very first user sign up at /admin.
    create: isAdmin,
    read: ({ req }) => (roleOf(req) === 'admin' ? true : req.user ? { id: { equals: req.user.id } } : false),
    update: ({ req }) => (roleOf(req) === 'admin' ? true : req.user ? { id: { equals: req.user.id } } : false),
    delete: isAdmin,
  },
  fields: [
    { name: 'name', type: 'text' },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'admin', // the first user created at /admin becomes the admin
      options: [
        { label: 'Student', value: 'student' },
        { label: 'Supervisor', value: 'supervisor' },
        { label: 'Admin', value: 'admin' },
      ],
      access: { update: adminField },
      saveToJWT: true,
    },
    {
      name: 'supervisor',
      type: 'relationship',
      relationTo: 'supervisors',
      admin: { condition: (data) => data?.role === 'supervisor', description: 'The supervisor record this login belongs to.' },
      access: { update: adminField },
      saveToJWT: true,
    },
    {
      name: 'student',
      type: 'relationship',
      relationTo: 'students',
      admin: { condition: (data) => data?.role === 'student', description: 'The student record this login belongs to.' },
      access: { update: adminField },
      saveToJWT: true,
    },
  ],
}
