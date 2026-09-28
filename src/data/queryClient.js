/*
 * The one TanStack Query cache for the portal. Hooks read through it, and data
 * modules use `cached` to share sub-requests (project list, lot rows, prices)
 * across table states, so paging, sorting, and searching reuse rows already
 * loaded instead of asking Supabase again.
 */
import { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Portal data changes through this app's own writes, which invalidate the
      // cache; a minute of freshness covers edits made elsewhere.
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

/**
 * Resolve `queryFn` through the cache under `queryKey`, reusing a fresh result.
 * The key must name every table the result is read from (e.g. ['lot-rows',
 * 'mvlc_lots', ...]) so `refreshTables` can find it when that table changes.
 */
export function cached(queryKey, queryFn) {
  return queryClient.fetchQuery({ queryKey, queryFn })
}

/** Mark every cached result stale and refetch the ones on screen — call after a write. */
export function invalidateAll() {
  return queryClient.invalidateQueries()
}

/** Each table's fingerprint as of the last refresh that looked at it. */
const knownFingerprints = new Map()

/** table -> fingerprint from the database, or null when it cannot say (not set up yet, offline). */
async function fingerprintsOf(tables) {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('table_fingerprints', { table_names: tables })
  if (error) return null
  return new Map(data.map((row) => [row.table_name, row.fingerprint]))
}

/** Whether a cached result was read from any of `tables` — by its `meta.tables` or a table named in its key. */
function readsFrom(query, tables) {
  const sources = query.meta?.tables ?? query.queryKey
  return tables.some((table) => sources.includes(table))
}

/**
 * Refresh button: ask the database whether any of `tables` changed since the
 * last refresh and, only if so, drop the cached results read from them and
 * refetch those on screen. Unchanged tables keep their cache and download
 * nothing. Resolves to whether anything was refetched.
 *
 * A table seen for the first time, or a database without
 * table_fingerprints (20261007_create_table_fingerprints.sql), counts as changed,
 * since the cache may predate any fingerprint.
 */
export async function refreshTables(tables) {
  const current = await fingerprintsOf(tables)
  const changed = tables.filter((table) => !current?.has(table) || knownFingerprints.get(table) !== current.get(table))
  if (!changed.length) return false

  changed.forEach((table) => (current?.has(table) ? knownFingerprints.set(table, current.get(table)) : knownFingerprints.delete(table)))
  await queryClient.invalidateQueries({ predicate: (query) => readsFrom(query, changed) })
  return true
}
