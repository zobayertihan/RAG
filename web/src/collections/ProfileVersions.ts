import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access'

// One entry per supervisor profile change: the values before the change, who changed
// them and when. Written by the Supervisors hook only.
export const ProfileVersions: CollectionConfig = {
  slug: 'profile-versions',
  admin: { defaultColumns: ['supervisor', 'changedFields', 'changedBy', 'createdAt'] },
  access: { read: isAdmin, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'supervisor', type: 'relationship', relationTo: 'supervisors', required: true },
    { name: 'changedFields', type: 'text' },
    { name: 'previous', type: 'json', admin: { description: 'The tracked fields as they were before the change.' } },
    { name: 'changedBy', type: 'relationship', relationTo: 'users' },
  ],
}
