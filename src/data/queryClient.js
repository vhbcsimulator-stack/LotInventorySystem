/*
 * The one TanStack Query cache for the portal. Hooks read through it, and data
 * modules use `cached` to share sub-requests (project list, lot rows, prices)
 * across table states, so paging, sorting, and searching reuse rows already
 * loaded instead of asking Supabase again.
 */
import { QueryClient } from '@tanstack/react-query'

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

/** Resolve `queryFn` through the cache under `queryKey`, reusing a fresh result. */
export function cached(queryKey, queryFn) {
  return queryClient.fetchQuery({ queryKey, queryFn })
}

/** Mark every cached result stale and refetch the ones on screen — call after a write. */
export function invalidateAll() {
  return queryClient.invalidateQueries()
}
