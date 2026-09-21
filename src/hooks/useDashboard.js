import useApiQuery from '@/hooks/useApiQuery'
import { fetchDashboard } from '@/data/dashboardData'

/**
 * Loads the dashboard's lots and announcements once.
 *
 * No longer keyed by range: the page summarises the payload itself, so the range
 * switch and the filter menu rework what is on screen without fetching every lot
 * again each time one is clicked.
 *
 * Returns { data, loading, error, reload } — see useApiQuery.
 */
export default function useDashboard() {
  return useApiQuery(fetchDashboard, 'all')
}
