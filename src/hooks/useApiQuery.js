import { useCallback, useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { invalidateAll, refreshTables } from '@/data/queryClient'

// Function names are minified in production builds, so each fetcher gets a
// stable numeric id for its cache key instead.
const fetcherIds = new WeakMap()
let nextFetcherId = 1
function fetcherId(fetcher) {
  if (!fetcherIds.has(fetcher)) fetcherIds.set(fetcher, nextFetcherId++)
  return fetcherIds.get(fetcher)
}

/**
 * Runs `fetcher(query)` through the TanStack Query cache and returns
 * { data, loading, error, reload, refresh }. Shared by every database-backed page.
 *
 * `fetcher` must be a stable, module-level function (e.g. fetchAgents). Equal
 * queries share one cached result, so revisiting a page, filter, or page number
 * within the stale window makes no request. The previous result stays on screen
 * while the next one loads, so tables do not flash empty.
 *
 * `reload` is called after writes, so it invalidates the whole cache: other
 * pages that show the changed rows refetch too.
 */
export default function useApiQuery(fetcher, query) {
  // `fetcher.tables(query)` lists the tables it reads; the Refresh button checks those.
  const tables = fetcher.tables?.(query ?? {}) ?? []
  const tablesKey = tables.join(',')
  const result = useQuery({
    queryKey: ['api', fetcherId(fetcher), query ?? null],
    queryFn: () => fetcher(query),
    placeholderData: keepPreviousData,
    meta: { tables },
  })

  const reload = useCallback(() => {
    invalidateAll()
  }, [])

  /*
   * For a Refresh button: refetches only when one of the fetcher's tables changed
   * in Supabase since the last refresh, otherwise keeps the cache. Resolves to
   * whether anything was refetched.
   */
  const { refetch } = result
  const refresh = useCallback(async () => {
    if (!tablesKey) {
      await refetch()
      return true
    }
    return refreshTables(tablesKey.split(','))
  }, [tablesKey, refetch])

  const { data, error, isFetching, isPlaceholderData, isPending } = result
  return useMemo(
    () => ({
      data: data ?? null,
      error: error ?? null,
      loading: isPending || isPlaceholderData || isFetching,
      reload,
      refresh,
    }),
    [data, error, isFetching, isPlaceholderData, isPending, reload, refresh],
  )
}
