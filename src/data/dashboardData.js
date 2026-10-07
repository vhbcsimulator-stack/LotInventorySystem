/*
 * ---------------------------------------------------------------------------
 * DASHBOARD DATA SOURCE
 * ---------------------------------------------------------------------------
 * Every figure is computed from the per-project Supabase lot tables and the
 * `projects` table. MVLC is read from `mvlc_lots` through LOT_TABLES; the legacy
 * `lots` table is not used for it. There is no sample data: until
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set the dashboard renders zeros.
 *
 * Every figure is a count or an area, never an amount of money. A lot's `total`
 * is its size times whatever price per sqm the price table holds at the moment,
 * and that table is repriced — so a peso figure here would be today's price
 * applied to last year's sales, and would change without a single lot moving.
 * Lots sold and square metres moved are what the records actually pin down.
 *
 * Figures the database does not hold yet — sales targets, clearance days, client
 * names — stay at zero / '—' rather than being guessed. Dates are the same case:
 * `lots.last_updated` records when a row was last touched, is empty on most
 * rows, and never meant the day a lot actually moved — so nothing here is
 * counted by month, filtered by date window, or presented as a date. The
 * dashboard is a snapshot of what the portal holds now.
 *
 * Every project is covered, not only MVLC: each keeps its lots in its own table
 * (LOT_TABLES), so the dashboard reads them all and sums across them. A project
 * whose table is missing or unreadable is skipped rather than failing the page,
 * and the announcements board is summarised alongside, so the dashboard is the
 * whole portal at a glance.
 */
import { SOURCE } from './api'
import { fetchAnnouncements } from './announcementsData'
import { LOT_TABLES, lotTermsFor } from './projectsData'
import { fetchAllRows, supabase, uiStatus, unwrap } from './supabase'

export { SOURCE }

// Rows per page in the recent-movements list; the card pages through the rest.
const TRANSACTION_ROWS = 5
const ANNOUNCEMENT_ROWS = 4

/** The zero state — also the shape every widget reads. */
export const EMPTY_DASHBOARD = {
  headline: {
    soldLots: 0,
    soldAreaSqm: 0,
    soldSharePct: 0,
    totalLots: 0,
    reservedLots: 0,
    reservedAreaSqm: 0,
    reservedClearanceDays: 0,
    availableLots: 0,
    availableAreaSqm: 0,
    portfolioSharePct: 0,
  },
  /*
   * How far each phase has sold through, as
   * [{ key, label, unit, soldPct, sold, reserved, open, total,
   *    phases: [{ key, label, soldPct, sold, reserved, open, total }] }].
   * A count, like everything else here — no date is involved, so a project whose
   * sheets never recorded when a lot moved is still fully represented.
   */
  sellThrough: [],
  estates: [], // [{ id, name, sold, reserved, open, total }]
  estatesTotalUnits: 0,
  distribution: {
    activeLots: 0,
    available: 0,
    sold: 0,
    reserved: 0,
    totalAreaSqm: 0,
  },
  /*
   * The same shape again, once for the portfolio and once per project, so the
   * distribution can be read whole or one estate at a time:
   * [{ key: 'overall' | 'MVLC', label, activeLots, available, sold, reserved, totalAreaSqm }]
   */
  distributions: [],
  transactions: {
    // [{ id, projectCode, projectName, property, areaSqm, status, date }] — all
    // of them; the card searches, filters and pages through these itself.
    rows: [],
    projects: [], // [{ code, name }] the movements cover, for the project filter
    total: 0,
    page: 1,
    pageSize: TRANSACTION_ROWS,
  },
  // The announcements board in brief: the newest few, and how many there are.
  announcements: { items: [], total: 0 },
  // Projects counted, and any whose lots could not be read — so a partial total
  // is never passed off as the whole portfolio.
  coverage: { projects: 0, unavailable: [] },
}

/**
 * One lot named as a reader would say it: "Mountain View · Phase 2 · B1 L3".
 * The grouping word is the project's own — Tower at MSCC — and is left out
 * entirely by a project that does not group its lots.
 */
const phaseLabel = (group, phase, section = null) =>
  group && phase !== null && phase !== undefined
    ? `${group} ${phase}${section ? (section === 'East' ? ' East' : section) : ''}`
    : ''

const lotLabel = (project, lot) =>
  [project.name, phaseLabel(project.group, lot.phase, lot.map_section), lot.lot_no]
    .filter(Boolean)
    .join(' · ')

/**
 * How far each phase has sold through: of everything a phase holds, how much is
 * sold, how much is reserved, how much is still open.
 *
 * This is what the dashboard can say about movement without a date to say it
 * with. A phase two thirds sold is a fact the lot rows pin down exactly, where
 * "12 lots in March" only ever meant twelve rows last touched in March.
 *
 * Projects are ordered by how much they hold, phases within a project in their
 * own order, with a project's undivided lots last under its own name.
 */
function sellThrough(rows) {
  const byProject = new Map()

  rows.forEach((lot) => {
    if (!byProject.has(lot.projectCode)) {
      byProject.set(lot.projectCode, {
        key: lot.projectCode,
        label: lot.projectName,
        unit: lot.group || '',
        phases: new Map(),
        sold: 0,
        reserved: 0,
        open: 0,
        total: 0,
      })
    }
    const project = byProject.get(lot.projectCode)
    // MVLC sections are distinct phases on screen: 1A, 1B, 1 East, and so on.
    // null covers a project that does not group its lots, and a row missing its phase.
    const phaseKey = lot.phase === null ? '' : `${lot.phase}|${lot.mapSection ?? ''}`
    if (!project.phases.has(phaseKey)) {
      project.phases.set(phaseKey, {
        key: `${lot.projectCode}-${phaseKey || 'ungrouped'}`,
        label: phaseKey ? phaseLabel(project.unit, lot.phase, lot.mapSection) : project.label,
        phase: lot.phase,
        mapSection: lot.mapSection,
        sold: 0,
        reserved: 0,
        open: 0,
        total: 0,
      })
    }
    const phase = project.phases.get(phaseKey)
    const bucket = lot.status === 'available' ? 'open' : lot.status
    project[bucket] += 1
    project.total += 1
    phase[bucket] += 1
    phase.total += 1
  })

  const pct = (part, whole) => (whole ? (part / whole) * 100 : 0)
  const withPct = (entry) => ({ ...entry, soldPct: pct(entry.sold, entry.total) })

  return [...byProject.values()]
    .sort((a, b) => b.total - a.total)
    .map((project) => ({
      ...withPct(project),
      phases: [...project.phases.values()]
        // Numbered phases in order, then whatever the project does not group.
        .sort(
          (a, b) =>
            (a.phase === null ? 1 : b.phase === null ? -1 : a.phase - b.phase) ||
            String(a.mapSection ?? '').localeCompare(String(b.mapSection ?? '')),
        )
        .map(withPct),
    }))
}

/**
 * The movements a set of dashboard filters leaves: `project` a code or
 * 'overall', and `statuses` the ones to keep. Shared by the transactions table
 * and the export, so what is downloaded is what is on screen.
 */
export function filterMovements(rows = [], { project = 'overall', statuses = [] } = {}) {
  return rows.filter((row) => {
    if (project !== 'overall' && row.projectCode !== project) return false
    if (statuses.length && !statuses.includes(row.status)) return false
    return true
  })
}

/**
 * Project code -> { id, name, paused }, newest row per code (the table repeats
 * codes). `paused` needs 20261012_add_project_paused.sql; until then every
 * project reads as active.
 */
async function fetchProjectNames() {
  const read = (columns) => supabase.from('projects').select(columns).order('id', { ascending: false })
  let result = await read('id, code, name, paused')
  if (result.error && /paused/.test(result.error.message)) result = await read('id, code, name')
  const { data } = unwrap(result)
  const byCode = new Map()
  data.forEach((row) => {
    const code = String(row.code ?? '').trim()
    if (code && !byCode.has(code)) byCode.set(code, { id: row.id, name: String(row.name ?? '').trim() || code, paused: row.paused === true })
  })
  return byCode
}

/**
 * One project's lots, as the figures the dashboard needs. Resolves null when the
 * table cannot be read — a project not set up yet must not zero the portfolio.
 */
async function fetchLotsFor(code, table, names) {
  try {
    // No `last_updated`: nothing the dashboard shows is counted by date any more.
    const tracksSections = table === LOT_TABLES.MVLC
    const lots = await fetchAllRows(
      table,
      `id, lot_no, phase, size_sqm, status, total${tracksSections ? ', map_section' : ''}`,
    )
    const count = { available: 0, reserved: 0, sold: 0 }
    // Square metres per status: the size of what has moved, which no repricing
    // can change underneath the figure.
    const area = { available: 0, reserved: 0, sold: 0 }
    const sold = []
    let totalAreaSqm = 0

    lots.forEach((lot) => {
      const sqm = Number(lot.size_sqm ?? 0)
      totalAreaSqm += sqm
      const status = uiStatus(lot.status)
      if (!status) return
      count[status] += 1
      area[status] += sqm
      if (status === 'sold') sold.push(lot)
    })

    const project = {
      code,
      id: names.get(code)?.id ?? code,
      name: names.get(code)?.name ?? code,
      // What this project calls a grouping: "Phase 2" at MVLC, "Tower 2" at MSCC.
      group: lotTermsFor(code).group,
    }

    /*
     * The lots as flat rows, each carrying its project. Everything the page shows
     * is derived from these — see summarize — so the range switch and the filter
     * menu narrow every card at once rather than the table alone, and no card can
     * disagree with another about what is being shown.
     */
    return {
      ...project,
      rows: lots
        .map((lot) => ({
          id: `${code}-${lot.id}`,
          projectCode: code,
          projectName: project.name,
          property: lotLabel(project, lot),
          areaSqm: Number(lot.size_sqm ?? 0),
          status: uiStatus(lot.status),
          // Phase and the project's word for it, for the sell-through card.
          phase: lot.phase === null || lot.phase === undefined || lot.phase === '' ? null : Number(lot.phase),
          mapSection: String(lot.map_section ?? '').trim() || null,
          group: project.group,
        }))
        // A status the portal does not recognise belongs to no count at all.
        .filter((row) => row.status),
      count,
      area,
      sold,
      totalAreaSqm,
      lots,
    }
  } catch (err) {
    console.error(`[dashboard] skipping ${code}:`, err)
    return null
  }
}

/**
 * Every figure the dashboard shows, for one set of filters.
 *
 * `project` narrows all of it — inventory, movements and sell-through — to one
 * estate, and `statuses` narrows the movement list. There is no date window:
 * the only date the lot tables hold is `last_updated`, which most rows leave
 * empty and which never recorded when a lot actually moved, so every figure
 * here describes the portfolio as it stands rather than a stretch of time.
 */
export function summarize(lots = [], filters = {}) {
  const { project = 'overall', statuses = [] } = filters
  const inScope = project === 'overall' ? lots : lots.filter((lot) => lot.projectCode === project)

  const count = { available: 0, reserved: 0, sold: 0 }
  const area = { available: 0, reserved: 0, sold: 0 }
  let totalAreaSqm = 0
  inScope.forEach((lot) => {
    totalAreaSqm += lot.areaSqm
    count[lot.status] += 1
    area[lot.status] += lot.areaSqm
  })
  const totalLots = inScope.length

  /*
   * Sold and reserved lots, narrowed to the statuses asked for and ordered by
   * project and lot. They were ordered newest first while there was a date to
   * sort on; with none, a stable reading order beats an arbitrary one.
   */
  const movements = filterMovements(
    inScope.filter((lot) => lot.status === 'sold' || lot.status === 'reserved'),
    { project: 'overall', statuses },
  ).sort((a, b) => a.projectName.localeCompare(b.projectName) || a.property.localeCompare(b.property))

  const byProject = new Map()
  inScope.forEach((lot) => {
    if (!byProject.has(lot.projectCode)) {
      byProject.set(lot.projectCode, {
        key: lot.projectCode,
        label: lot.projectName,
        activeLots: 0,
        available: 0,
        sold: 0,
        reserved: 0,
        totalAreaSqm: 0,
      })
    }
    const entry = byProject.get(lot.projectCode)
    entry.activeLots += 1
    entry[lot.status] += 1
    entry.totalAreaSqm += lot.areaSqm
  })
  const perProject = [...byProject.values()].sort((a, b) => b.activeLots - a.activeLots)

  const overall = {
    key: 'overall',
    label: 'Overall',
    activeLots: totalLots,
    available: count.available,
    sold: count.sold,
    reserved: count.reserved,
    totalAreaSqm,
  }

  return {
    headline: {
      ...EMPTY_DASHBOARD.headline,
      soldLots: count.sold,
      soldAreaSqm: area.sold,
      soldSharePct: totalLots ? (count.sold / totalLots) * 100 : 0,
      totalLots,
      reservedLots: count.reserved,
      reservedAreaSqm: area.reserved,
      availableLots: count.available,
      availableAreaSqm: area.available,
      portfolioSharePct: totalLots ? (count.available / totalLots) * 100 : 0,
    },
    sellThrough: sellThrough(inScope),
    estates: perProject.map((entry) => ({
      id: entry.key,
      name: entry.label,
      sold: entry.sold,
      reserved: entry.reserved,
      open: entry.available,
      total: entry.activeLots,
    })),
    estatesTotalUnits: totalLots,
    distribution: overall,
    /*
     * Overall first, then one entry per project. A distribution summed over
     * estates that sell different things at different stages hides exactly what
     * it is asked about — whether a particular estate is moving — so both
     * readings are offered rather than only the total.
     */
    distributions: perProject.length > 1 ? [overall, ...perProject] : perProject,
    transactions: {
      rows: movements,
      total: movements.length,
      pageSize: TRANSACTION_ROWS,
      page: 1,
    },
  }
}

/**
 * Fetch the dashboard payload: every project's lots, once, for the page to
 * summarise itself — so changing the project filter reworks the page without
 * asking the database for anything again.
 *
 * Never throws and never fabricates: if Supabase is not configured or cannot be
 * reached, it resolves to zeros and reports why via `source`.
 */
export async function fetchDashboard() {
  if (!supabase) return { ...EMPTY_DASHBOARD, source: SOURCE.NOT_CONFIGURED }

  try {
    const names = await fetchProjectNames()
    // A paused project (Project Actions → Pause project) is left off the dashboard entirely.
    const codes = Object.keys(LOT_TABLES).filter((code) => !names.get(code)?.paused)
    /*
     * Every project's lots and the announcements board, in parallel: the page
     * summarises both, and neither waits on the other.
     */
    const [perProject, board] = await Promise.all([
      Promise.all(codes.map((code) => fetchLotsFor(code, LOT_TABLES[code], names))),
      fetchAnnouncements({ sort: 'newest' }),
    ])

    const projects = perProject.filter(Boolean)
    const unavailable = codes.filter((code, index) => !perProject[index])
    /*
     * One flat list spanning every project's table. These tables have no relation
     * to each other in the database, so the portfolio only exists once their rows
     * are in one place — and holding them here lets the page re-summarise on a
     * filter change without asking the database for anything.
     */
    const lots = projects.flatMap((project) => project.rows)

    return {
      lots,
      // The projects to offer as a filter, largest first, as the cards list them.
      projects: projects
        .map((project) => ({ code: project.code, name: project.name, total: project.rows.length }))
        .filter((project) => project.total)
        .sort((a, b) => b.total - a.total),
      announcements: {
        items: board.announcements.slice(0, ANNOUNCEMENT_ROWS),
        total: board.announcements.length,
      },
      coverage: { projects: projects.length, unavailable },
      source: SOURCE.DATABASE,
    }
  } catch (err) {
    // Log it — the operator should see a broken connection — but still render
    // zeros rather than an empty screen or invented figures.
    console.error('[dashboard] falling back to zeros:', err)
    return { ...EMPTY_DASHBOARD, source: SOURCE.UNAVAILABLE }
  }
}

export default fetchDashboard

/** The tables fetchDashboard reads, so its Refresh button knows what to check. */
fetchDashboard.tables = () => ['projects', ...Object.values(LOT_TABLES), 'announcements']
