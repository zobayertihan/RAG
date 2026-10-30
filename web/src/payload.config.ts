import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { ProfileVersions } from './collections/ProfileVersions'
import { QueryLogs } from './collections/QueryLogs'
import { Requests } from './collections/Requests'
import { Students } from './collections/Students'
import { Supervisors } from './collections/Supervisors'
import { Users } from './collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: ' | Supervisor Finder' },
  },
  collections: [Users, Supervisors, Students, Requests, ProfileVersions, QueryLogs],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  // A local SQLite file for the prototype: nothing to host or sign up for.
  db: sqliteAdapter({ client: { url: process.env.DATABASE_URL || 'file:./payload.db' } }),
})
