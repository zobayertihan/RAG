import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access'

// What students searched for and how good the best match was, without who searched.
// Used by the admin dashboard to show demand gaps (Phase 7).
export const QueryLogs: CollectionConfig = {
  slug: 'query-logs',
  admin: { useAsTitle: 'query', defaultColumns: ['query', 'mode', 'bestScore', 'createdAt'] },
  access: { read: isAdmin, create: () => false, update: () => false, delete: isAdmin },
  fields: [
    { name: 'query', type: 'text', required: true },
    { name: 'mode', type: 'text' },
    { name: 'bestScore', type: 'number' },
    { name: 'filters', type: 'json' },
  ],
}
