/**
 * Supervisor CSV: the columns, and how a CSV row becomes Payload data.
 * Lists (interests, requirements) are separated by " ; " inside one cell.
 */
import { plain } from '@/collections/Supervisors'

export const COLUMNS = ['record_id', 'name', 'position', 'interests', 'requirements', 'capacity', 'type', 'research_group', 'room', 'email', 'profile_url'] as const
export const EXPORT_ONLY = ['slots_used', 'profile_updated_at'] as const // written on export, ignored on import
export const LIST_SEP = ';'

const FIELD: Record<string, string> = {
  name: 'name', position: 'position', interests: 'interests', requirements: 'requirements', capacity: 'capacity', type: 'type',
  research_group: 'researchGroup', room: 'room', email: 'email', profile_url: 'profileUrl',
}
const TYPES = new Set(['', 'business', 'engineering', 'generalist'])

export const listCell = (rows: unknown) =>
  Array.isArray(rows) ? rows.map((r) => (r as { value: string }).value).filter(Boolean).join(` ${LIST_SEP} `) : ''

/** Turns one CSV row into Payload fields. Only columns in the file are set; a missing column is left alone. */
export function rowToData(header: string[], cells: string[]): { recordId: string; data: Record<string, unknown>; error?: string } {
  const get = (c: string) => (cells[header.indexOf(c)] ?? '').trim()
  const recordId = get('record_id')
  if (!recordId) return { recordId, data: {}, error: 'record_id is empty' }
  const data: Record<string, unknown> = {}
  for (const col of header) {
    const field = FIELD[col]
    if (!field) continue
    const v = get(col)
    if (field === 'interests' || field === 'requirements') {
      data[field] = v.split(LIST_SEP).map((x) => x.trim()).filter(Boolean).map((value) => ({ value }))
    } else if (field === 'capacity') {
      if (v === '') data.capacity = null
      else if (!/^\d+$/.test(v) || Number(v) > 7) return { recordId, data, error: `capacity "${v}" must be a whole number from 0 to 7, or empty` }
      else data.capacity = Number(v)
    } else if (field === 'type') {
      if (!TYPES.has(v.toLowerCase())) return { recordId, data, error: `type "${v}" must be business, engineering, generalist or empty` }
      data.type = v.toLowerCase() || null
    } else if (field === 'email') {
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { recordId, data, error: `email "${v}" doesn't look like an email address` }
      data.email = v || null
    } else data[field] = v
  }
  return { recordId, data }
}

/** Which fields would change, compared without row ids or empty-string noise. */
export const diffFields = (before: Record<string, unknown>, data: Record<string, unknown>) =>
  Object.keys(data).filter((f) => JSON.stringify(plain(f, before[f])) !== JSON.stringify(plain(f, data[f])))
