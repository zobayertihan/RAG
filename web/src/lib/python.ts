/**
 * Calls to the Python search service (the existing app.py). The service key is only
 * read here, on the server, so it never reaches a browser.
 */

const BASE = (process.env.PYTHON_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const KEY = process.env.SERVICE_KEY || ''

// A free Render service sleeps after 15 minutes. While it wakes (up to about a minute), Render
// answers 502/503/504 with its own page, or the connection fails. Then we wait until
// /api/health answers and try once more, instead of showing the student an error.
const WAKE_WAIT_MS = 75000
class Asleep extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitUntilAwake(maxMs = WAKE_WAIT_MS) {
  const until = Date.now() + maxMs
  while (Date.now() < until) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(15000) })
      if (res.ok) return true
    } catch {
      // still waking up
    }
    await sleep(4000)
  }
  return false
}

async function attempt<T>(path: string, init: RequestInit & { service?: boolean }, timeoutMs: number): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (init.service) headers['X-Service-Key'] = KEY
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new Error('The search service took too long to answer. Try again.')
    throw new Asleep('unreachable') // connection refused or reset: not up yet
  }
  const text = await res.text()
  let body: any = null
  try {
    body = JSON.parse(text)
  } catch {
    // not JSON: an error page from the host, not from app.py
  }
  if (!res.ok) {
    if (body === null && [502, 503, 504].includes(res.status)) throw new Asleep(String(res.status))
    const detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body ?? text.slice(0, 200))
    throw new Error(`Python service ${path} answered ${res.status}: ${detail}`)
  }
  return body as T
}

// Long timeouts: a free Render service takes up to about a minute to wake up.
async function call<T>(path: string, init: RequestInit & { service?: boolean }, timeoutMs = 90000): Promise<T> {
  try {
    return await attempt<T>(path, init, timeoutMs)
  } catch (e) {
    if (!(e instanceof Asleep)) throw e
  }
  if (!(await waitUntilAwake())) {
    throw new Error("The search service didn't wake up in time. Try again in a minute.")
  }
  try {
    return await attempt<T>(path, init, timeoutMs)
  } catch (e) {
    if (e instanceof Asleep) throw new Error('The search service is restarting. Try again in a minute.')
    throw e
  }
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

export type FinanceOverview = {
  today: string
  documents: {
    id: string; title: string; family: string; authority: string; version?: string | null; synthetic: boolean
    language: string; url: string | null; published_at: string | null; effective_from: string | null
    captured_at?: string | null; supersedes: string[]; note?: string | null; status: string; chunks: number
  }[]
  faqs: {
    faq_id: string; rule_id: string; based_on: string; decided_at: string; text: string; synthetic: boolean
    status: 'valid' | 'needs review'; current_version: string | null; old_rule: string | null; current_rule: string | null
  }[]
}

/** Admin finance page: documents with their status today, FAQ entries with their review status. */
export const financeOverview = () => call<FinanceOverview>('/api/finance/overview', { method: 'GET', service: true })

/** Supervisors that fit a text (the student's note), search only, for the coordinator's suggestions. */
export const searchSupervisors = (query: string, k = 6) =>
  call<{ matches: { record_id: string; name: string; position: string; research_group: string; score: number }[] }>(
    '/api/search-supervisors', { method: 'POST', service: true, body: JSON.stringify({ query: query.slice(0, 4000), k }) },
  )
