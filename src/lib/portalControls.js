/*
 * ---------------------------------------------------------------------------
 * PORTAL CONTROLS
 * ---------------------------------------------------------------------------
 * What a developer account can show, hide, or put under maintenance from the
 * Developer Controls page: the whole portal, each page, and the buttons listed
 * below. The settings live in the `portal_controls` table
 * (supabase/migrations/20261022_create_portal_controls.sql), one row per id;
 * an id with no row is visible.
 *
 * Developers always see everything — marked with its state — so they can
 * check a page before putting it back.
 *
 * Add a button by listing it in BUTTON_CONTROLS and wrapping it in
 * <Controlled id="button.<page>.<name>"> (components/Controlled.jsx).
 */

export const CONTROL_STATE = {
  VISIBLE: 'visible',
  HIDDEN: 'hidden',
  MAINTENANCE: 'maintenance',
}

const STATES = Object.values(CONTROL_STATE)

export const PORTAL_CONTROL = 'portal'

export const pageControl = (pageKey) => `page.${pageKey}`
export const buttonControl = (pageKey, name) => `button.${pageKey}.${name}`

/** The pages, keyed like the nav items in components/Sidebar.jsx. */
export const PAGE_CONTROLS = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'projects', label: 'Projects & Lots' },
  { page: 'clients', label: 'Clients' },
  { page: 'applications', label: 'Pending Applications' },
  { page: 'brokers', label: 'Brokers' },
  { page: 'salesAgents', label: 'Sales Agents' },
  { page: 'regularUsers', label: 'Regular Users' },
  { page: 'announcements', label: 'Announcements' },
].map((item) => ({ ...item, id: pageControl(item.page) }))

/** The account directories share one page component, keyed by account kind. */
export const ACCOUNT_PAGE = { broker: 'brokers', sales_agent: 'salesAgents', regular_user: 'regularUsers' }

/** The buttons and menu items of one account directory (Brokers, Sales Agents, Regular Users). */
const accountButtons = (title) => ({
  Toolbar: [
    ['add', `Add ${title}`],
    ['export', 'Export CSV'],
  ],
  'Each account': [
    ['profile', 'Open profile'],
    ['remove', 'More actions → Remove'],
  ],
})

/**
 * Every controllable button, by page, then by where it sits on the page:
 * [name, label]. The name is the last part of the id, `button.<page>.<name>`.
 * Cancel, Close, paging, sorting, tabs and filters are not listed — they only
 * move around, they do not do anything.
 */
const BUTTONS = {
  dashboard: {
    Dashboard: [
      ['export', 'Export'],
      ['view-map', 'View map'],
      ['explore-inventory', 'Inventory by estate → Explore'],
      ['open-announcement', 'Announcements card → Open'],
    ],
  },
  projects: {
    Views: [['view-map', 'Map tab']],
    // Matching PROJECT_ACTIONS in pages/ProjectsPage.jsx.
    'Project Actions menu': [
      ['featured-project', 'Featured project'],
      ['project-dev', 'Project development'],
      ['future-dev', 'Future development'],
      ['future-projects', 'Future projects'],
      ['flyers', 'Flyer pictures'],
      ['update-prices', 'Update category prices'],
      ['update-discount', 'Update discount'],
      ['add-lot', 'Add lot'],
      ['import-lots', 'Import lots (CSV)'],
      ['export-lots', 'Export lots'],
      ['export-mscc-report', 'Export MSCC status sheet'],
      ['pause-project', 'Pause / resume project'],
    ],
    'Lot table': [
      ['lot-status', 'Change status in the table'],
      ['lot-details', 'Row menu → View details'],
      ['lot-copy-row', 'Row menu → Copy row'],
      ['lot-update', 'Row menu → Update'],
      ['lot-delete', 'Row menu → Delete'],
      ['bulk-delete', 'Delete selected'],
    ],
    'Map view': [
      ['color-lots', 'Color lots'],
      ['annotations-upload', 'Annotations → Upload / replace COCO JSON'],
      ['annotations-delete', 'Annotations → Delete outlines'],
      ['add-map', 'Add map'],
      ['map-fullsize', 'Open full size'],
      ['map-download', 'Download image'],
      ['map-replace', 'Replace image'],
    ],
    'Galleries (project development, future development, flyers)': [
      ['gallery-upload', 'Upload images'],
      ['gallery-replace', 'Replace image'],
      ['gallery-delete', 'Delete images'],
    ],
    'Featured project': [
      ['featured-save', 'Feature / save changes'],
      ['featured-edit', 'Edit'],
      ['featured-remove', 'Remove'],
    ],
    'Future projects': [
      ['future-save', 'Add / save'],
      ['future-edit', 'Edit'],
      ['future-remove', 'Remove'],
    ],
    'Import lots': [['import-template', 'Download template']],
  },
  clients: {
    Toolbar: [['export', 'Export CSV']],
    'Each client': [
      ['view', 'Open client details'],
      ['edit', 'More actions → Edit'],
      ['delete', 'More actions → Delete'],
    ],
  },
  applications: {
    'Each application': [
      ['create-account', 'Copy to form (create account)'],
      ['reject', 'More actions → Reject'],
      ['pending', 'More actions → Move back to pending'],
      ['delete', 'More actions → Delete'],
    ],
  },
  brokers: accountButtons('Brokers'),
  salesAgents: accountButtons('Sales Agents'),
  regularUsers: accountButtons('Regular Users'),
  announcements: {
    Toolbar: [['post', 'Post New Announcement']],
    'Each announcement': [
      ['edit', 'More actions → Edit'],
      ['delete', 'More actions → Delete'],
    ],
  },
}

export const BUTTON_CONTROLS = Object.entries(BUTTONS).flatMap(([page, sections]) =>
  Object.entries(sections).flatMap(([section, buttons]) =>
    buttons.map(([name, label]) => ({ page, section, name, label, id: buttonControl(page, name) })),
  ),
)

/** Only an account given app_metadata.role = 'developer' in Supabase; users cannot set app_metadata themselves. */
export function isDeveloper(user) {
  return user?.app_metadata?.role === 'developer'
}

/** The state of `id` in `controls` (id -> row): visible unless a row says otherwise. */
export function controlState(controls, id) {
  const state = controls?.[id]?.state
  return STATES.includes(state) ? state : CONTROL_STATE.VISIBLE
}

/** The message a developer left for `id`, or ''. */
export function controlMessage(controls, id) {
  const message = controls?.[id]?.message
  return typeof message === 'string' ? message.trim() : ''
}

/**
 * Whether quick access may offer `command` (lib/commands.js) to a non-developer:
 * its page must be visible, and so must the Project Actions item it runs.
 */
export function commandAvailable(controls, command) {
  const visible = (id) => controlState(controls, id) === CONTROL_STATE.VISIBLE
  const { initialAction, initialView, initialMapAction } = command.props ?? {}
  if (!visible(pageControl(command.page))) return false
  if (initialAction && !visible(buttonControl('projects', initialAction))) return false
  if (initialView === 'map' && !visible(buttonControl('projects', 'view-map'))) return false
  return !initialMapAction || visible(buttonControl('projects', initialMapAction))
}
