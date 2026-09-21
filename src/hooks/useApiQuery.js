import { useCallback, useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { invalidateAll } from '@/data/queryClient'

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
 * { data, loading, error, reload }. Shared by every database-backed page.
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
  const result = useQuery({
    queryKey: ['api', fetcherId(fetcher), query ?? null],
    queryFn: () => fetcher(query),
    placeholderData: keepPreviousData,
  })

  const reload = useCallback(() => {
    invalidateAll()
  }, [])

  const { data, error, isFetching, isPlaceholderData, isPending } = result
  return useMemo(
    () => ({
      data: data ?? null,
      error: error ?? null,
      loading: isPending || isPlaceholderData || isFetching,
      reload,
    }),
    [data, error, isFetching, isPlaceholderData, isPending, reload],
  )
}
