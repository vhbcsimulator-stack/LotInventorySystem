import DashboardPage from './DashboardPage'
import ProjectsPage from './ProjectsPage'
import AnnouncementsPage from './AnnouncementsPage'

/*
 * Keys match the nav item `key` values in components/Sidebar.jsx. Add a page by
 * adding a nav item there and an entry here — nothing else needs to change.
 * 'logout' is deliberately absent: it is an action, not a destination.
 */
export const PAGES = {
  dashboard: DashboardPage,
  projects: ProjectsPage,
  announcements: AnnouncementsPage,
}

export default PAGES
