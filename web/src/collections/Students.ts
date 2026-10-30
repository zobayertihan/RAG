import type { CollectionConfig } from 'payload'

import { isAdmin, roleOf, studentIdOf } from '../access'

const textList = (name: string) => ({ name, type: 'array' as const, fields: [{ name: 'value', type: 'text' as const, required: true }] })

export const Students: CollectionConfig = {
  slug: 'students',
  defaultSort: 'name',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'programme', 'email', 'synthetic'] },
  access: {
    // Admins and supervisors see students (supervisors need them for requests; all students
    // are dummy data in the prototype). A student sees only their own record.
    read: ({ req }) => {
      const role = roleOf(req)
      if (role === 'admin' || role === 'supervisor') return true
      const sid = studentIdOf(req)
      return role === 'student' && sid !== undefined ? { id: { equals: sid } } : false
    },
    create: isAdmin,
    update: ({ req }) => {
      if (roleOf(req) === 'admin') return true
      const sid = studentIdOf(req)
      return roleOf(req) === 'student' && sid !== undefined ? { id: { equals: sid } } : false
    },
    delete: isAdmin,
  },
  fields: [
    { name: 'recordId', type: 'text', required: true, unique: true, index: true },
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'email' },
    { name: 'programme', type: 'text' },
    textList('skills'),
    textList('pastProjects'),
    textList('interests'),
    { name: 'synthetic', type: 'checkbox', defaultValue: true, admin: { description: 'Dummy data for the prototype.' } },
  ],
}
