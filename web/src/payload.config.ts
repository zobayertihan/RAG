import { postgresAdapter } from '@payloadcms/db-postgres'
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
const DB_URL = process.env.DATABASE_URL || 'file:./payload.db'

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
  // Local: a SQLite file, nothing to host. Deployed: Postgres (Neon), chosen by the URL.
  db: DB_URL.startsWith('postgres')
    ? postgresAdapter({ pool: { connectionString: DB_URL, max: 5 } })
    : sqliteAdapter({ client: { url: DB_URL } }),
})
