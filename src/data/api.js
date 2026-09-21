/*
 * Shared plumbing for every database-backed data module. Each module owns its
 * own schema and zero state; this file only knows how to talk to an endpoint
 * and how to coerce untrusted JSON into safe primitives.
 */

/** How a payload was obtained — pages use this to explain zeros. */
export const SOURCE = {
  DATABASE: 'database',
  NOT_CONFIGURED: 'not-configured',
  UNAVAILABLE: 'unavailable',
}

/**
 * A finite number, or the fallback — never NaN or null. Numeric strings are
 * parsed because Postgres `numeric`/`bigint` columns can arrive as text.
 */
export function num(value, fallback = 0) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback
}

export function list(value) {
  return Array.isArray(value) ? value : []
}

export function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

/** Build `base?key=value`, skipping empty values so the API sees only real filters. */
export function withQuery(base, params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })
  const qs = search.toString()
  if (!qs) return base
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`
}

/** GET JSON, throwing on a non-OK status or a non-JSON body. */
export async function requestJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON, got "${contentType}"`)
  }
  return res.json()
}
