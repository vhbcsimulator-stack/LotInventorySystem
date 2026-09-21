/*
 * ---------------------------------------------------------------------------
 * PROJECTS & LOTS DATA SOURCE
 * ---------------------------------------------------------------------------
 * Reads the Supabase `projects` table and each project's lot table. There is no
 * sample data: until VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set the page
 * shows zeros.
 *
 * Filtering, sorting, and paging run in the database, so a search covers every
 * lot rather than only the page already loaded.
 *
 * Lots are not linked to projects by a column; each project keeps its lots in its
 * own table, listed in LOT_TABLES. A project without an entry shows an empty
 * table until its lots are stored.
 */
import { SOURCE, num, text } from './api'
import { STATUS_ALIASES, fetchAllRows, supabase, uiStatus, unwrap } from './supabase'
import { fetchPriceLookup } from './pricesData'
import { cached } from './queryClient'

export { SOURCE }

export const LOT_STATUSES = ['available', 'reserved', 'sold']

/** Stored lot categories offered by the add/update lot form, in display order. */
export const LOT_CATEGORIES = [
  'commercial',
  'commercial_corner',
  // MVLC's commercial sheets grade a lot CP; mvlc_price has the matching column.
  'prime_commercial',
  'prime',
  'prime_corner',
  'regular',
  'regular_corner',
]

/**
 * Projects that sell something other than land offer their own categories. MSCC
 * sells finished condominium units, so it is graded by fit-out, not by corner.
 */
export const CATEGORIES_BY_PROJECT = {
  MSCC: ['bare', 'semi_furnished', 'fully_furnished'],
}
export const categoriesFor = (projectCode) => CATEGORIES_BY_PROJECT[projectCode] ?? LOT_CATEGORIES

/**
 * Projects whose sales sheets write a code in the phase column instead of a plain
 * number, carrying the lot's category and — where the project has phases — its
 * phase number too. Only the CSV import reads this; a category column in the file
 * always wins over it.
 *
 * The code is read as tokens split on spaces and dashes, which is what tells a
 * location label apart from a category marker:
 *
 *   MV-1A     Phase 1, block A   -> Regular
 *   MV-1C     Phase 1, block C   -> Regular      (C is attached: a block)
 *   MV-2B C   Phase 2, block B   -> Commercial   (C stands alone: a marker)
 *   MV-C-1A   Phase 1, block A   -> Commercial
 *   MV 2E     Phase 2, East      -> Regular
 *   MV 2E-PC  Phase 2, East      -> Prime Corner
 *   MV PH1E-C Phase 1, East      -> Commercial   (the commercial sheets write PH1E)
 *   MV PH1E-CC                     -> Commercial Corner
 *   MV PH1E-CP                     -> Prime Commercial
 *   ERHD-P    no phases          -> Prime
 *
 * `markers` therefore only ever matches a whole token, and every other token —
 * MV, A, B, E, 2E — is a label the portal does not track. C means Commercial at
 * MVLC but Corner at ERHD, which is why the meanings live per project.
 */
export const PHASE_CODES = {
  /*
   * The commercial sheets abbreviate the marker differently from one file to the
   * next — MV PH1E-C, -COM, -COMM, -COMM'L, -COMMERCIAL — so `prefixes` catches
   * any token that starts with COM, and the apostrophe is stripped before either
   * lookup runs.
   */
  MVLC: {
    phase: true,
    markers: {
      C: 'commercial',
      CC: 'commercial_corner',
      CP: 'prime_commercial',
      P: 'prime',
      PC: 'prime_corner',
    },
    prefixes: { COM: 'commercial' },
    fallback: 'regular',
  },
  ERHD: { phase: false, markers: { C: 'regular_corner', P: 'prime', PC: 'prime_corner' }, fallback: 'regular' },
}

/**
 * The phase number and category encoded in a phase-column code, as
 * { phase, category }. Both are empty for a project that uses plain phase numbers
 * and for a blank cell, so the caller falls back to reading the cell as a number.
 */
export function parsePhaseCode(projectCode, value) {
  const config = PHASE_CODES[projectCode]
  if (!config) return { phase: null, category: '' }

  // Typed by hand, so "MV-3 C", "MV 1 E- C" and an auto-corrected en dash all
  // have to come apart the same way.
  // Apostrophes, dots, and the like are dropped so COMM'L and COMM.L both read as
  // COMML — a marker, not an unknown token.
  const tokens = text(value)
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .split(/[\s-]+/)
    .map((token) => token.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean)
  if (!tokens.length) return { phase: null, category: '' }

  let phase = null
  let category = ''
  tokens.forEach((token) => {
    /*
     * The first token carrying a number is the phase: "2E" is Phase 2, and so is
     * "PH2E" — the commercial sheets spell the phase out as "MV PH1E-C", where
     * the token starts with PH rather than the digit.
     */
    const numbered = config.phase && phase === null ? /^(?:PH)?(\d+)/.exec(token) : null
    if (numbered) phase = Number.parseInt(numbered[1], 10)
    else if (!category) {
      // An exact marker first; then a prefix, so every spelling of COMMERCIAL lands.
      const prefix = Object.keys(config.prefixes ?? {}).find((start) => token.startsWith(start))
      category = config.markers[token] ?? (prefix ? config.prefixes[prefix] : '')
    }
  })

  return { phase, category: category || config.fallback }
}

/**
 * Extra per-unit columns for condominium projects, shared by the table, the
 * add/update form, the details dialog, and a copied row so all four stay in step.
 * `column` is the database column (see
 * supabase/migrations/20260916_add_mscc_unit_columns.sql); the stored value is
 * the label itself, so nothing has to be translated on the way in or out.
 */
export const UNIT_FIELDS = [
  { key: 'unitType', column: 'unit_type', label: 'Unit Type', options: ['1 Bedroom', '2 Bedroom', '2 Bedroom Deluxe'] },
  {
    key: 'floorLevel',
    column: 'floor_level',
    label: 'Floor Level',
    options: ['2nd Floor', '3rd Floor', '4th Floor', '5th Floor', '6th Floor'],
  },
  { key: 'view', column: 'unit_view', label: 'View', options: ['Nature View', 'Facing Amenities'] },
  { key: 'endUnit', column: 'end_unit', label: 'End Unit', options: ['Yes', 'No'] },
]

/** Project code → the table holding its lots (same columns as `lots`). */
export const LOT_TABLES = {
  MVLC: 'lots',
  // Created by supabase/migrations/20260915_create_project_lot_tables.sql (erhd_lots
  // already existed) and given the lots columns by 20260915_copy_lots_columns_to_project_lot_tables.sql.
  EBLF: 'eblf_lots',
  ERHD: 'erhd_lots',
  GLS: 'gls_lots',
  MSCC: 'mscc_lots',
}

export const DEFAULT_PROJECT_CODE = 'MVLC'

/**
 * What each project calls its lots and how they are grouped. MSCC sells units in
 * towers; ERHD has a single phase, so its lots are not grouped at all (`group`
 * is null). The database column stays `phase` either way.
 */
export const DEFAULT_LOT_TERMS = {
  item: 'Lot',
  identifier: 'Lot Identifier',
  area: 'Lot Area',
  group: 'Phase',
  placeholder: 'e.g. B1 L3',
  // Whether price per sqm and TCP are shown. MSCC prices units as a package, so
  // its table, details, and copied rows leave both out. The figures are still
  // stored and still exported — only the columns are hidden.
  pricing: true,
  // Extra per-unit columns (UNIT_FIELDS); empty for projects that sell land.
  unitFields: [],
}
export const LOT_TERMS_BY_PROJECT = {
  MSCC: {
    item: 'Unit',
    identifier: 'Unit',
    area: 'Unit Area',
    group: 'Tower',
    placeholder: 'e.g. 1205',
    pricing: false,
    unitFields: UNIT_FIELDS,
  },
  ERHD: { ...DEFAULT_LOT_TERMS, group: null },
}
export const lotTermsFor = (projectCode) => LOT_TERMS_BY_PROJECT[projectCode] ?? DEFAULT_LOT_TERMS

/** Fields the table can sort by, with their display labels. */
export const SORTABLE_FIELDS = {
  phase: 'Phase',
  identifier: 'Lot Identifier',
  areaSqm: 'Lot Area',
  pricePerSqm: 'Price / sqm',
  tcp: 'TCP',
}

export const DEFAULT_SORT = { by: 'phase', dir: 'asc' }

const byLotNo = (a, b) => a.lotNo.localeCompare(b.lotNo, undefined, { numeric: true, sensitivity: 'base' })

/** Ascending comparators; ties always fall back to phase, then natural lot number. */
const SORTERS = {
  phase: (a, b) => (a.phaseNo ?? Infinity) - (b.phaseNo ?? Infinity),
  identifier: byLotNo,
  areaSqm: (a, b) => a.areaSqm - b.areaSqm,
  pricePerSqm: (a, b) => a.pricePerSqm - b.pricePerSqm,
  tcp: (a, b) => a.tcp - b.tcp,
}

/** The zero state — also the shape every component reads. */
export const EMPTY_PROJECT_LOTS = {
  project: {
    id: null,
    name: '',
    code: '',
    location: '',
    grossAreaHectares: 0,
  },
  // What the selected project calls its lots and their grouping — see LOT_TERMS_BY_PROJECT.
  terms: DEFAULT_LOT_TERMS,
  // Every project, for the project switcher: [{ code, name, hasLots }]
  projects: [],
  // False when the selected project has no lot table yet.
  hasLotTable: false,
  // Project-wide counts. Unlike `lots`/`total`, these ignore the table filters.
  stats: { totalLots: 0, available: 0, reserved: 0, sold: 0 },
  // Filter options come from the database, never a hardcoded list.
  facets: { phases: [], phaseFilters: [], categories: [] },
  // [{ id, identifier, phase, category, areaSqm, pricePerSqm, tcp, vatInclusive, status, rawStatus }]
  lots: [],
  total: 0, // lots matching the current filters, across every page
  page: 1,
  pageSize: 10,
}

const phaseLabel = (phase, terms = DEFAULT_LOT_TERMS) =>
  phase === null || phase === undefined || !terms.group ? '' : `${terms.group} ${phase}`
const categoryLabel = (category) =>
  text(category)
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

/**
 * Categories that also get a phase filter of their own.
 *
 * MVLC's commercial strip sits inside Phase 1 alongside the residential lots, so
 * "Phase 1" on its own could not show it by itself. Each phase that holds one of
 * these categories therefore gets a second option — "Phase 1 Commercial" — listed
 * under its plain phase. A category with no lots in a phase adds nothing, so a
 * project without commercial lots sees exactly the phase list it always had.
 *
 * Only the filter dropdown reads this; the add/update form still offers the plain
 * phases (`facets.phases`).
 */
export const PHASE_FILTER_CATEGORIES = ['commercial', 'commercial_corner', 'prime_commercial']

/** A phase-filter option — "Phase 1" or "Phase 1 Commercial" — as { phase, category }. */
export function parsePhaseFilter(value, terms = DEFAULT_LOT_TERMS) {
  const label = text(value).trim()
  if (!label) return { phase: null, category: '' }
  // The longest matching label wins: "Phase 1 Prime Commercial" ends with
  // "Commercial" too, and must not be read as the plain commercial filter.
  const category =
    PHASE_FILTER_CATEGORIES.filter((name) => label.toLowerCase().endsWith(categoryLabel(name).toLowerCase())).sort(
      (a, b) => b.length - a.length,
    )[0] ?? ''
  const phase = num(label.replace(/\D/g, ''), NaN)
  return { phase: Number.isFinite(phase) ? phase : null, category }
}

function emptyPayload(query, source) {
  return {
    ...EMPTY_PROJECT_LOTS,
    page: num(query.page, 1) || 1,
    pageSize: num(query.pageSize, 10) || 10,
    source,
  }
}

/**
 * One entry per project code. The table repeats codes (older rows were
 * re-created), so the newest row — highest id — represents each code.
 */
async function fetchProjects() {
  const data = await cached(['projects'], async () =>
    unwrap(await supabase.from('projects').select('id, code, name').order('id', { ascending: false })).data,
  )
  const byCode = new Map()
  data.forEach((row) => {
    const code = text(row.code).trim()
    if (code && !byCode.has(code)) byCode.set(code, row)
  })
  return [...byCode.values()]
    .map((row) => ({ id: row.id, code: row.code, name: text(row.name, row.code), hasLots: Boolean(LOT_TABLES[row.code]) }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

/**
 * Phase options for the filter: every phase, each followed by the
 * PHASE_FILTER_CATEGORIES that actually have lots in it.
 */
function phaseFilterOptions(rows, phases, terms) {
  const present = new Set(rows.map((row) => `${row.phase}|${text(row.category).trim().toLowerCase()}`))
  return phases.flatMap((phase) => [
    phaseLabel(phase, terms),
    ...PHASE_FILTER_CATEGORIES.filter((category) => present.has(`${phase}|${category}`)).map(
      (category) => `${phaseLabel(phase, terms)} ${categoryLabel(category)}`,
    ),
  ])
}

/** Project-wide stats and filter facets for one lot table — independent of table state. */
async function fetchSummary(table, terms) {
  const rows = await cached(['lot-summary', table], () => fetchAllRows(table, 'phase, category, status'))

  const stats = { totalLots: rows.length, available: 0, reserved: 0, sold: 0 }
  rows.forEach((row) => {
    const status = uiStatus(row.status)
    if (status) stats[status] += 1
  })

  const phases = [...new Set(rows.map((row) => row.phase).filter((phase) => phase !== null))].sort((a, b) => a - b)
  const categories = [...new Set(rows.map((row) => row.category).filter(Boolean))].sort()

  return {
    stats,
    // A project whose lots are not grouped (ERHD) offers no phase filter.
    facets: {
      phases: terms.group ? phases.map((phase) => phaseLabel(phase, terms)) : [],
      // The filter's own list: the phases plus any "Phase 1 Commercial" entries.
      phaseFilters: terms.group ? phaseFilterOptions(rows, phases, terms) : [],
      categories: categories.map(categoryLabel),
    },
    categoryByLabel: Object.fromEntries(categories.map((category) => [categoryLabel(category), category])),
  }
}

/**
 * One filtered, sorted page of lots. Filters run in the database; price per sqm
 * comes from the project's price table (by phase + category) and TCP is area x
 * that price, so sorting and paging happen here, after those are computed.
 */
async function fetchLotsPage(projectCode, table, query, categoryByLabel) {
  const page = num(query.page, 1) || 1
  const pageSize = num(query.pageSize, 10) || 10
  const terms = lotTermsFor(projectCode)

  const columns = 'id, lot_no, phase, category, size_sqm, price_per_sqm, status, last_updated, updated_at'
  const filter = (request) => {
    let filtered = request
    if (STATUS_ALIASES[query.status]) filtered = filtered.in('status', STATUS_ALIASES[query.status])
    // "Phase 1 Commercial" narrows by category as well as by phase.
    const { phase, category } = parsePhaseFilter(query.phase, terms)
    if (phase !== null) filtered = filtered.eq('phase', phase)
    if (category) filtered = filtered.eq('category', category)
    if (categoryByLabel[query.category]) filtered = filtered.eq('category', categoryByLabel[query.category])
    return filtered
  }

  /*
   * Two groups of columns may not exist yet: `sold_by` needs
   * 20260915_add_lots_sold_by.sql and the MSCC unit columns need
   * 20260916_add_mscc_unit_columns.sql. Each attempt drops the newest group, so
   * the page keeps loading before either migration has been run instead of
   * failing outright.
   *
   * Search, sort, and paging run below on these rows, so only the database
   * filters key the cache — changing pages or typing a search sends no request.
   */
  const unitColumns = terms.unitFields.map((field) => field.column)
  const attempts = [[...unitColumns, 'last_updated_precision', 'sold_by'], ['sold_by'], []]

  const fetchRows = () =>
    cached(['lot-rows', table, query.status ?? '', query.phase ?? '', query.category ?? ''], async () => {
      for (const [index, optional] of attempts.entries()) {
        try {
          return await fetchAllRows(table, [columns, ...optional].join(', '), filter)
        } catch (err) {
          // Anything other than a missing optional column is a real failure.
          if (index === attempts.length - 1 || !optional.some((column) => err.message.includes(column))) throw err
        }
      }
    })

  const [rows, priceFor] = await Promise.all([fetchRows(), fetchPriceLookup(projectCode)])

  const lots = rows.map((lot) => {
    const areaSqm = num(lot.size_sqm)
    // A lot whose category has no price in the table keeps its stored price.
    const pricePerSqm = priceFor(lot.phase, lot.category) ?? num(lot.price_per_sqm)
    return {
      id: lot.id,
      lotNo: text(lot.lot_no),
      phaseNo: typeof lot.phase === 'number' ? lot.phase : null,
      identifier: text(lot.lot_no, '—'),
      phase: phaseLabel(lot.phase, terms) || '—',
      category: categoryLabel(lot.category) || '—',
      rawCategory: text(lot.category),
      /*
       * Only what the sheet or a portal edit actually recorded. `updated_at` is
       * deliberately not a fallback: it is when the row was last written by
       * anything at all — a bulk import, a reprice — so using it here reported
       * every lot as updated on the day of the last import.
       */
      lastUpdated: text(lot.last_updated),
      // 'month' when only the month is known (imported from a month/year sheet);
      // '' for the full dates the portal writes itself.
      lastUpdatedPrecision: text(lot.last_updated_precision),
      areaSqm,
      pricePerSqm,
      tcp: Math.round(areaSqm * pricePerSqm * 100) / 100,
      vatInclusive: null,
      status: uiStatus(lot.status),
      rawStatus: text(lot.status),
      soldBy: text(lot.sold_by),
      // Empty strings for a project without unit columns, or before the migration.
      ...Object.fromEntries(terms.unitFields.map((field) => [field.key, text(lot[field.column])])),
    }
  })

  /*
   * Search runs on what the table shows — lot ID, phase, category, area, price
   * per sqm, TCP, and status — since price and TCP are computed here. Every word
   * typed must appear somewhere in the row. "Phase 2" is read as one term, commas
   * are ignored, and a number-only word must start one of the row's numbers — so
   * "2" does not match every price that merely contains a 2.
   */
  const normalize = (value) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/(phase|tower)\s+(\d+)/g, '$1#$2')
      .replace(/,/g, '')
  const words = normalize(query.search).split(/\s+/).filter(Boolean)
  const matches = words.length
    ? lots.filter((lot) => {
        const haystack = normalize(
          [
            lot.identifier,
            lot.phase,
            lot.category,
            lot.soldBy,
            ...terms.unitFields.map((field) => lot[field.key]),
            LOT_STATUS_OPTIONS.find((option) => option.value === lot.rawStatus)?.label ?? lot.rawStatus,
          ].join(' '),
        )
        const numbers = [lot.areaSqm, lot.pricePerSqm, lot.tcp].map(String)
        return words.every((word) =>
          /^\d+(\.\d+)?$/.test(word)
            ? numbers.some((number) => number.startsWith(word)) || haystack.split(/\s+/).some((token) => token === word)
            : haystack.includes(word),
        )
      })
    : lots

  const primary = SORTERS[query.sortBy] ?? SORTERS[DEFAULT_SORT.by]
  const direction = query.sortDir === 'desc' ? -1 : 1
  matches.sort((a, b) => direction * primary(a, b) || SORTERS.phase(a, b) || byLotNo(a, b) || a.id - b.id)

  return {
    lots: matches.slice((page - 1) * pageSize, page * pageSize),
    total: matches.length,
    page,
    pageSize,
  }
}

/**
 * Fetch the project list, the selected project's summary, and one page of its
 * lots. `query.projectCode` picks the project (default MVLC).
 *
 * Never throws and never fabricates: when Supabase is unset or unreachable it
 * resolves to the zero state and reports why via `source`.
 */
export async function fetchProjectLots(query = {}) {
  if (!supabase) return emptyPayload(query, SOURCE.NOT_CONFIGURED)

  try {
    const projects = await fetchProjects()
    const selected =
      projects.find((project) => project.code === query.projectCode) ??
      projects.find((project) => project.code === DEFAULT_PROJECT_CODE) ??
      projects[0]

    const base = {
      ...emptyPayload(query, SOURCE.DATABASE),
      projects,
      terms: lotTermsFor(selected?.code),
      project: selected
        ? { ...EMPTY_PROJECT_LOTS.project, id: selected.id, name: selected.name, code: selected.code }
        : EMPTY_PROJECT_LOTS.project,
    }

    const table = selected && LOT_TABLES[selected.code]
    if (!table) return base

    const { categoryByLabel, ...summary } = await fetchSummary(table, lotTermsFor(selected.code))
    const lotsPage = await fetchLotsPage(selected.code, table, query, categoryByLabel)
    return { ...base, ...summary, ...lotsPage, hasLotTable: true }
  } catch (err) {
    // Log it so a broken connection is visible, but render an empty table rather
    // than a blank screen or invented rows.
    console.error('[projects] falling back to an empty table:', err)
    return emptyPayload(query, SOURCE.UNAVAILABLE)
  }
}

/** Every status the lot tables store, as offered by the status picker. */
export const LOT_STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'rsv-p', label: 'Reserved (Pending)' },
  { value: 'hold', label: 'Hold' },
  { value: 'sold', label: 'Sold' },
]

/**
 * Change one lot's status in the given project's lot table. Throws when Supabase
 * is unset, the write fails, or no row was updated (row-level security silently
 * filters writes it refuses).
 */
const SOLD_BY_MISSING =
  'The lots table has no sold_by column yet — run supabase/migrations/20260915_add_lots_sold_by.sql in the Supabase SQL Editor.'
const UNIT_COLUMNS_MISSING =
  'The MSCC unit table has no unit columns yet — run supabase/migrations/20260916_add_mscc_unit_columns.sql in the Supabase SQL Editor.'

/** Supabase's "unknown column" errors, rewritten as the migration to run. */
function explainMissingColumn(err) {
  if (/sold_by/.test(err.message)) return new Error(SOLD_BY_MISSING)
  if (UNIT_FIELDS.some((field) => err.message.includes(field.column))) return new Error(UNIT_COLUMNS_MISSING)
  return err
}

/**
 * Columns added by a later migration that only refine how a row is displayed.
 * A database that has not been given them yet is still perfectly usable.
 */
const OPTIONAL_COLUMNS = ['last_updated_precision']

/**
 * Run a write and, when the database lacks one of those optional columns, drop it
 * and try again. Without this, a portal deployed ahead of its migrations could not
 * change a lot's status at all — over a column that only affects a date's wording.
 */
async function writeTolerantly(row, run) {
  const result = await run(row)
  if (!result.error) return result

  const missing = OPTIONAL_COLUMNS.find((column) => column in row && result.error.message.includes(column))
  if (!missing) return result

  const rest = { ...row }
  delete rest[missing]
  return writeTolerantly(rest, run)
}

/**
 * The project's unit columns as a row patch, blanks stored as null. `{}` for a
 * project without unit columns, so land projects write exactly what they did before.
 */
function unitColumnsFor(projectCode, unit) {
  if (!unit) return {}
  return Object.fromEntries(
    lotTermsFor(projectCode).unitFields.map((field) => [field.column, text(unit[field.key]).trim() || null]),
  )
}

/**
 * `soldBy` is the agent's name and is required for 'sold'. Any other status
 * clears it, so an agent is never credited with a lot that is no longer sold.
 */
export async function updateLotStatus(id, status, projectCode = DEFAULT_PROJECT_CODE) {
  if (!supabase) throw new Error('No database connected.')
  const table = LOT_TABLES[projectCode]
  if (!table) throw new Error(`No lot table is set up for ${projectCode}.`)
  if (!LOT_STATUS_OPTIONS.some((option) => option.value === status)) {
    throw new Error(`Unknown status "${status}".`)
  }

  const now = new Date()
  // Editing in the portal always knows the day, so the month-only marker is cleared.
  const changes = {
    status,
    last_updated: now.toISOString().slice(0, 10),
    last_updated_precision: null,
    updated_at: now.toISOString(),
  }

  const updateRow = (body) => supabase.from(table).update(body).eq('id', id).select('id')

  /*
   * Who sold a lot is recorded on the lot itself (the edit dialog's Sold By), not
   * here — a status change only clears the name when the lot stops being sold.
   */
  let result =
    status === 'sold'
      ? await writeTolerantly(changes, updateRow)
      : await writeTolerantly({ ...changes, sold_by: null }, updateRow)
  // Before the migration, the column does not exist yet; the status still changes.
  if (result.error && /sold_by/.test(result.error.message)) {
    result = await writeTolerantly(changes, updateRow)
  }
  if (result.error) throw explainMissingColumn(new Error(result.error.message))
  if (!result.data?.length) throw new Error('The database did not accept the change — you may need to sign in.')
}

/** A lot identifier as written on a map or a sheet: case, spaces, and punctuation ignored. */
export const lotKey = (value) =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/**
 * The project's lots by identifier (lotKey → [{ id, lotNo, phase, category, status }]),
 * narrowed to one phase when `phase` is given. A key can hold several lots —
 * the same identifier in two phases — which callers must treat as ambiguous.
 */
export async function fetchLotsByIdentifier(projectCode, { phase = null } = {}) {
  const table = lotTableFor(projectCode)
  const rows = await fetchAllRows(table, 'id, lot_no, phase, category, status', (query) =>
    phase === null ? query : query.eq('phase', phase),
  )
  const byKey = new Map()
  rows.forEach((row) => {
    const key = lotKey(row.lot_no)
    if (!key) return
    const lot = {
      id: row.id,
      lotNo: text(row.lot_no),
      phase: row.phase ?? null,
      category: text(row.category),
      status: text(row.status),
    }
    byKey.set(key, [...(byKey.get(key) ?? []), lot])
  })
  return byKey
}

/**
 * Apply several status changes ([{ id, lotNo, status }]) one lot at a time.
 * Never stops at the first failure: returns { updated, failed: [{ lotNo, message }] }.
 */
export async function updateLotStatuses(changes, projectCode) {
  let updated = 0
  const failed = []
  for (const change of changes) {
    try {
      await updateLotStatus(change.id, change.status, projectCode)
      updated += 1
    } catch (err) {
      failed.push({ lotNo: change.lotNo, message: err.message })
    }
  }
  return { updated, failed }
}

function lotTableFor(projectCode) {
  if (!supabase) throw new Error('No database connected.')
  const table = LOT_TABLES[projectCode]
  if (!table) throw new Error(`No lot table is set up for ${projectCode}.`)
  return table
}

/**
 * The date a lot was last updated, as the database stores it (YYYY-MM-DD). An
 * edit may set it by hand — a lot's sheet date is often not the day it is typed
 * in — and anything unparseable falls back to `fallback`.
 */
function lastUpdatedDay(value, fallback) {
  const day = text(value).trim()
  if (!day) return fallback
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Last updated must be a date.')
  if (Number.isNaN(new Date(`${day}T00:00:00`).getTime())) throw new Error('Last updated is not a real date.')
  return day
}

/**
 * Update a lot's identifier, phase, category, and area. The stored price per sqm
 * and TCP are refreshed from the project's price table so they stay consistent
 * with what the lots page shows. `phase` may be null for projects without phases.
 */
export async function updateLot(id, projectCode, { lotNo, phase, category, areaSqm, soldBy, unit, lastUpdated }) {
  const table = lotTableFor(projectCode)
  // Projects whose lots are not grouped (ERHD) never store a phase.
  if (!lotTermsFor(projectCode).group) phase = null

  const lot_no = text(lotNo).trim()
  if (!lot_no) throw new Error(`${lotTermsFor(projectCode).item} identifier is required.`)
  if (!text(category).trim()) throw new Error('Category is required.')
  if (!Number.isFinite(areaSqm) || areaSqm <= 0) throw new Error('Lot area must be a number greater than 0.')
  if (phase !== null && !(Number.isInteger(phase) && phase > 0)) throw new Error(`${lotTermsFor(projectCode).group ?? 'Phase'} must be a whole number.`)

  const priceFor = await fetchPriceLookup(projectCode)
  const pricePerSqm = priceFor(phase, category)
  const now = new Date()
  const changes = {
    lot_no,
    phase,
    category,
    size_sqm: areaSqm,
    updated_at: now.toISOString(),
    last_updated: lastUpdatedDay(lastUpdated, now.toISOString().slice(0, 10)),
    // A portal edit knows the day, so any month-only marker from an import is cleared.
    last_updated_precision: null,
    // `total` is generated by the database from size_sqm * price_per_sqm and cannot be written.
    ...(pricePerSqm === null ? {} : { price_per_sqm: pricePerSqm }),
    // Only sent for sold lots, where the form shows the agent field.
    ...(soldBy === undefined ? {} : { sold_by: text(soldBy).trim() || null }),
    ...unitColumnsFor(projectCode, unit),
  }

  const result = await writeTolerantly(changes, (body) => supabase.from(table).update(body).eq('id', id).select('id'))
  if (result.error) throw explainMissingColumn(new Error(result.error.message))
  if (!result.data?.length) throw new Error('The database did not accept the change — you may need to sign in.')
}

/**
 * Add one lot to the project's lot table. Price per sqm and TCP come from the
 * project's price table, as for updates and imports; `soldBy` is required for
 * 'sold'. `phase` may be null for projects without phases. Resolves the new id.
 */
export async function createLot(projectCode, { lotNo, phase, category, areaSqm, status = 'available', soldBy = '', unit, lastUpdated }) {
  const table = lotTableFor(projectCode)
  // Projects whose lots are not grouped (ERHD) never store a phase.
  if (!lotTermsFor(projectCode).group) phase = null

  const lot_no = text(lotNo).trim()
  if (!lot_no) throw new Error(`${lotTermsFor(projectCode).item} identifier is required.`)
  if (!text(category).trim()) throw new Error('Category is required.')
  if (!Number.isFinite(areaSqm) || areaSqm <= 0) throw new Error('Lot area must be a number greater than 0.')
  if (phase !== null && !(Number.isInteger(phase) && phase > 0)) throw new Error(`${lotTermsFor(projectCode).group ?? 'Phase'} must be a whole number.`)
  if (!LOT_STATUS_OPTIONS.some((option) => option.value === status)) throw new Error(`Unknown status "${status}".`)
  const agent = text(soldBy).trim()
  if (status === 'sold' && !agent) throw new Error('Enter the sales agent who sold this lot.')

  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) throw new Error('Sign in to add lots.')

  // Imports match lots by lot number + phase, so that pair has to stay unique.
  let duplicate = supabase.from(table).select('id').ilike('lot_no', lot_no.replace(/[%_\\]/g, '\\$&')).limit(1)
  duplicate = phase === null ? duplicate.is('phase', null) : duplicate.eq('phase', phase)
  if (unwrap(await duplicate).data.length) {
    const terms = lotTermsFor(projectCode)
    throw new Error(`${terms.item} ${lot_no} already exists${phase === null ? '' : ` in ${terms.group} ${phase}`}.`)
  }

  const priceFor = await fetchPriceLookup(projectCode)
  const pricePerSqm = priceFor(phase, category)
  if (pricePerSqm === null) {
    throw new Error(
      `No price per sqm is set for ${phase === null ? '' : `${lotTermsFor(projectCode).group} ${phase} `}${categoryLabel(category)} — add it under Update category prices first.`,
    )
  }

  const now = new Date()
  const row = {
    lot_no,
    phase,
    category,
    size_sqm: areaSqm,
    price_per_sqm: pricePerSqm,
    // `total` is generated by the database from size_sqm * price_per_sqm.
    status,
    updated_at: now.toISOString(),
    last_updated: lastUpdatedDay(lastUpdated, now.toISOString().slice(0, 10)),
    last_updated_precision: null,
    user_id: auth.user.id,
    ...unitColumnsFor(projectCode, unit),
  }

  const insertRow = (body) => supabase.from(table).insert(body).select('id')

  let result = await writeTolerantly({ ...row, sold_by: status === 'sold' ? agent : null }, insertRow)
  // Before the sold_by migration, a lot that is not sold still goes in without it.
  if (result.error && /sold_by/.test(result.error.message) && status !== 'sold') {
    result = await writeTolerantly(row, insertRow)
  }
  if (result.error) throw explainMissingColumn(new Error(result.error.message))
  if (!result.data?.length) throw new Error('The database did not accept the new lot — you may need to sign in.')
  return result.data[0].id
}

/** Permanently delete one lot. */
export async function deleteLot(id, projectCode) {
  const table = lotTableFor(projectCode)
  const { data } = unwrap(await supabase.from(table).delete().eq('id', id).select('id'))
  if (!data.length) throw new Error('The database did not delete the lot — you may need to sign in.')
}

/**
 * Permanently delete several lots at once, in batches so a large selection stays
 * within one request's limits. Resolves how many rows the database actually
 * removed — fewer than asked for when row-level security refuses some — and
 * throws when it removed none at all.
 */
export async function deleteLots(ids, projectCode) {
  const table = lotTableFor(projectCode)
  if (!ids.length) return 0

  let deleted = 0
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const { data } = unwrap(await supabase.from(table).delete().in('id', batch).select('id'))
    deleted += data.length
  }

  if (!deleted) throw new Error('The database did not delete the lots — you may need to sign in.')
  return deleted
}

export default fetchProjectLots
