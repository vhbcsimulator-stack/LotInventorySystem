/*
 * ---------------------------------------------------------------------------
 * QUICK ACCESS COMMANDS
 * ---------------------------------------------------------------------------
 * Everything the top bar's search can take you to: the pages, each project view,
 * and the project actions that open a dialog — "Add lot" finds the button that
 * opens the Add lot dialog, not just the page it lives on.
 *
 * A command names the page it runs on and the props that page starts with, which
 * is the channel the dashboard's cards already use to open Projects & Lots on a
 * chosen tab (see App.jsx). A project action carries `initialAction`, which
 * ProjectsPage runs once as if the item had been picked from Project Actions.
 *
 * `keywords` are the words that should find a command beyond its own label —
 * synonyms, and the wording used elsewhere in the portal.
 */
import { LOT_TABLES, lotTermsFor } from '@/data/projectsData'

export const SEARCH_SUGGESTIONS = [
  'Projects & Lots',
  'Lot outlines',
  'Color lots',
  'Add lot',
  'Future projects',
  'Featured project',
]

/** The project views, matching VIEWS in components/projects/ProjectHeader.jsx. */
const PROJECT_VIEWS = [
  { value: 'table', label: 'Lot Table', keywords: 'lots list rows inventory' },
  { value: 'map', label: 'Map', keywords: 'maps site plan annotated phases' },
]

/** The Project Actions menu, matching PROJECT_ACTIONS in pages/ProjectsPage.jsx. */
const PROJECT_ACTIONS = [
  { value: 'featured-project', label: 'Featured project', keywords: 'highlight showcase image' },
  { value: 'project-dev', label: 'Project Development', keywords: 'construction progress photos gallery' },
  { value: 'future-dev', label: 'Future Development', keywords: 'upcoming planned photos gallery' },
  { value: 'future-projects', label: 'Future Projects', keywords: 'upcoming planned projects photos gallery' },
  { value: 'flyers', label: 'Flyers Pictures', keywords: 'marketing brochure images gallery' },
  { value: 'update-prices', label: 'Update category prices', keywords: 'price per sqm rates categories' },
  { value: 'update-discount', label: 'Update Discount', keywords: 'discounts interest payment options cash downpayment' },
  { value: 'add-lot', label: 'Add lot', keywords: 'new create' },
  { value: 'import-lots', label: 'Import lots (CSV)', keywords: 'upload csv spreadsheet bulk' },
  { value: 'export-lots', label: 'Export lots', keywords: 'download csv spreadsheet' },
  { value: 'export-mscc-report', label: 'Export MSCC status sheet', keywords: 'download csv spreadsheet report units towers', only: 'MSCC' },
  { value: 'pause-project', label: 'Pause or resume project', keywords: 'pause resume hold suspend stop activate' },
]

const PAGES = [
  { id: 'page.dashboard', label: 'Dashboard', group: 'Pages', page: 'dashboard', keywords: 'home overview summary kpi charts' },
  { id: 'page.projects', label: 'Projects & Lots', group: 'Pages', page: 'projects', keywords: 'lots units inventory' },
  { id: 'page.announcements', label: 'Announcements', group: 'Pages', page: 'announcements', keywords: 'news posts memo' },
]

/**
 * Every command the search can offer. Views and actions are listed once per
 * project, so "add lot eblf" is reachable without switching project first.
 */
export const COMMANDS = [
  ...PAGES,
  ...Object.keys(LOT_TABLES).flatMap((code) => {
    // MSCC sells units, not lots, so its actions are named the way its pages are.
    const one = lotTermsFor(code).item.toLowerCase()
    const named = (label) => label.replace(/\blots\b/i, `${one}s`).replace(/\blot\b/i, one)

    return [
      {
        id: `project.${code}`,
        label: code,
        group: 'Projects',
        page: 'projects',
        props: { initialProjectCode: code },
        keywords: 'project open switch',
      },
      ...PROJECT_VIEWS.map(({ value, label, keywords }) => ({
        id: `project.${code}.view.${value}`,
        label: `${label} — ${code}`,
        group: 'Project views',
        page: 'projects',
        props: { initialProjectCode: code, initialView: value },
        keywords: `${keywords} ${code}`,
      })),
      {
        id: `project.${code}.map.outlines`,
        label: `Lot Outlines — ${code}`,
        group: 'Project maps',
        page: 'projects',
        props: { initialProjectCode: code, initialView: 'map' },
        keywords: `annotated annotations annotation coco polygons lot outlines preview ${code}`,
      },
      {
        id: `project.${code}.map.color-lots`,
        label: `Color Lots — ${code}`,
        group: 'Project maps',
        page: 'projects',
        props: { initialProjectCode: code, initialView: 'map', initialMapAction: 'color-lots' },
        keywords: `colour lots recolor repaint statuses annotated map ${code}`,
      },
      ...PROJECT_ACTIONS.filter((action) => !action.only || action.only === code).map(({ value, label, keywords }) => ({
        id: `project.${code}.action.${value}`,
        label: `${named(label)} — ${code}`,
        group: 'Actions',
        page: 'projects',
        props: { initialProjectCode: code, initialView: 'table', initialAction: value },
        keywords: `${keywords} ${code} action button dialog`,
      })),
    ]
  }),
]

const normalize = (value) => String(value ?? '').toLowerCase().trim()

/**
 * Rank one command against the words typed. Every word must appear somewhere in
 * the command, so "add lot eblf" narrows rather than widens. Returns a score —
 * higher is a better match — or 0 when a word is missing.
 */
function score(command, words) {
  const label = normalize(command.label)
  const haystack = `${label} ${normalize(command.group)} ${normalize(command.keywords)}`

  let total = 0
  for (const word of words) {
    if (!haystack.includes(word)) return 0
    // A hit in the name beats one in the keywords, and a name starting with the
    // word beats one that merely contains it.
    if (label.startsWith(word)) total += 3
    else if (label.includes(word)) total += 2
    else total += 1
  }
  return total
}

/**
 * The commands matching `query`, best first, capped at `limit`. An empty query
 * matches nothing, so the dropdown stays shut until something is typed.
 */
export function searchCommands(query, { limit = 8 } = {}) {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []

  return COMMANDS.map((command) => ({ command, rank: score(command, words) }))
    .filter(({ rank }) => rank > 0)
    .sort((a, b) => b.rank - a.rank || a.command.label.localeCompare(b.command.label))
    .slice(0, limit)
    .map(({ command }) => command)
}
