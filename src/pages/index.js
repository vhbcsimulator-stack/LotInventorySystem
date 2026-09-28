import { lazy } from 'react'
import DashboardSkeleton from '@/components/skeletons/DashboardSkeleton'
import ProjectsSkeleton from '@/components/skeletons/ProjectsSkeleton'
import AnnouncementsSkeleton from '@/components/skeletons/AnnouncementsSkeleton'
import BrokersSkeleton from '@/components/skeletons/BrokersSkeleton'

/*
 * Each page is its own chunk, so sign-in does not wait on code for pages not yet
 * opened. `preloadPages` fetches them in the background once someone is signed in,
 * so switching pages later does not stall on a download.
 */
const loaders = {
  dashboard: () => import('./DashboardPage'),
  projects: () => import('./ProjectsPage'),
  announcements: () => import('./AnnouncementsPage'),
  brokers: () => import('./BrokersPage'),
}

/*
 * Keys match the nav item `key` values in components/Sidebar.jsx. Add a page by
 * adding a nav item there, a loader above, and a fallback below.
 * 'logout' is deliberately absent: it is an action, not a destination.
 */
export const PAGES = Object.fromEntries(Object.entries(loaders).map(([key, load]) => [key, lazy(load)]))

/** What shows while a page's code is still downloading — the page's own skeleton. */
export const PAGE_FALLBACKS = {
  dashboard: DashboardSkeleton,
  projects: ProjectsSkeleton,
  announcements: AnnouncementsSkeleton,
  brokers: BrokersSkeleton,
}

export function preloadPages() {
  Object.values(loaders).forEach((load) => load().catch(() => {}))
}

export default PAGES
