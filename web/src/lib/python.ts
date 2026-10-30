/**
 * Calls to the Python search service (the existing app.py). The service key is only
 * read here, on the server, so it never reaches a browser.
 */

const BASE = (process.env.PYTHON_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const KEY = process.env.SERVICE_KEY || ''

// Long timeouts: a free Render service takes up to about a minute to wake up.
async function call<T>(path: string, init: RequestInit & { service?: boolean }, timeoutMs = 90000): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (init.service) headers['X-Service-Key'] = KEY
  const res = await fetch(`${BASE}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body)
    throw new Error(`Python service ${path} answered ${res.status}: ${detail}`)
  }
  return body as T
}

/** The supervisor record in the shape app.py expects (snake_case, plain lists). */
export type PythonSupervisor = {
  id: string
  name: string
  position: string
  interests: string[]
  profile_url: string
  email: string
  room: string
  research_group: string
  type: '' | 'business' | 'engineering' | 'generalist'
  requirements: string[]
  capacity: number | null
}

export const reindexSupervisor = (record: PythonSupervisor) =>
  call<{ status: string; version: number; searchable: number }>('/api/reindex/supervisors', {
    method: 'POST',
    service: true,
    body: JSON.stringify(record),
  })

export const summarizeNote = (note: string, supervisorRecordId: string, requestType: string) =>
  call<{ summary: string | null }>('/api/summarize-note', {
    method: 'POST',
    service: true,
    body: JSON.stringify({ note, supervisor_id: supervisorRecordId, request_type: requestType }),
  })

export const draftEmail = (body: {
  action: 'accept' | 'accept_discuss' | 'reject' | 'ask_details'
  student_name: string
  supervisor_name: string
  note?: string
  topic?: string
}) =>
  call<{ subject: string; body: string; personalized: boolean }>('/api/draft-email', {
    method: 'POST',
    service: true,
    body: JSON.stringify(body),
  })

/** The student chat. Public on the Python side, but routed through Next.js from Phase 5. */
export const chat = (body: unknown) =>
  call<Record<string, unknown>>('/api/chat', { method: 'POST', body: JSON.stringify(body) }, 120000)

/** Admin demand view: groups queries into topics and scores each topic against today's index. */
export const queryGaps = (queries: string[], similarity?: number) =>
  call<{ similarity: number; groups: { label: string; members: number[]; best_now: number | null; best_now_name: string | null }[] }>(
    '/api/query-gaps',
    { method: 'POST', service: true, body: JSON.stringify({ queries, ...(similarity ? { similarity } : {}) }) },
    60000,
  )

/** Wakes the Python service early (free hosts sleep), so the first real call is fast. Never throws. */
export const wakePython = () =>
  fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(90000) }).then(() => undefined, () => undefined)
