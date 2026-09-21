import useApiQuery from '@/hooks/useApiQuery'
import { fetchProjectLots } from '@/data/projectsData'

/**
 * Loads one page of lots for the given table state (search, filters, sort,
 * page). Returns { data, loading, error, reload } — see useApiQuery.
 */
export default function useProjectLots(query) {
  return useApiQuery(fetchProjectLots, query)
}
