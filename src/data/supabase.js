/*
 * The one Supabase client for the portal. It is null until VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY are set, so each data module can report
 * SOURCE.NOT_CONFIGURED instead of throwing.
 */
import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env?.VITE_SUPABASE_URL ?? ''
const ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY ?? ''

export const SUPABASE_ENV = 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'

export const supabase = URL && ANON_KEY ? createClient(URL, ANON_KEY) : null

/** Unwrap a Supabase response, throwing its error so callers have one failure path. */
export function unwrap({ data, count, error }) {
  if (error) throw new Error(error.message)
  return { data: data ?? [], count: count ?? 0 }
}

/** Row count for a query built by `build(query)`, without fetching the rows. */
export async function countRows(table, build = (query) => query) {
  const { count } = unwrap(await build(supabase.from(table).select('id', { count: 'exact', head: true })))
  return count
}

/** Every row of `table`, paged past PostgREST's 1000-row response cap. */
export async function fetchAllRows(table, columns, build = (query) => query) {
  const PAGE = 1000
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data } = unwrap(await build(supabase.from(table).select(columns)).range(from, from + PAGE - 1))
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

/**
 * The database stores some statuses the UI does not name: `rsv-p` (reservation
 * pending) is shown as reserved; anything else (e.g. `hold`) keeps no status.
 */
export const STATUS_ALIASES = { reserved: ['reserved', 'rsv-p'], available: ['available'], sold: ['sold'] }

export function uiStatus(value) {
  const key = String(value ?? '').toLowerCase()
  return Object.keys(STATUS_ALIASES).find((status) => STATUS_ALIASES[status].includes(key)) ?? ''
}

/**
 * Make free text safe inside a PostgREST filter, where commas, parentheses and
 * the `%` / `*` wildcards carry meaning.
 */
export function searchTerm(value) {
  return String(value ?? '').replace(/[,()%*\\]/g, ' ').trim()
}
