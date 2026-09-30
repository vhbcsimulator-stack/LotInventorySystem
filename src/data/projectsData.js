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
import { PRICE_CONFIG, fetchPriceLookup } from './pricesData'
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
 * sells condominium units, so it is graded by bedrooms, not by corner.
 */
export const CATEGORIES_BY_PROJECT = {
  MSCC: ['1_bedroom', '2_bedroom', '2_bedroom_deluxe'],
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
 *   MV-2B C   Phase 2, block B   -> Regular Corner
 *   MV-C-1A   Phase 1, block A   -> Commercial
 *   MV 2E     Phase 2, East      -> Regular
 *   MV 1 E-C  Phase 1, East      -> Commercial
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
 * The category markers any project's sheet may put in its phase column when it
 * has no category column: P is Prime, PC Prime Corner, C (Regular) Corner, and
 * a cell with no marker at all (only the project name, say "ERHD") is Regular.
 * Projects with their own meanings are in PHASE_CODES.
 */
export const CATEGORY_CODES = { markers: { C: 'regular_corner', P: 'prime', PC: 'prime_corner' }, fallback: 'regular' }

/**
 * MVLC uses C in two different positions with two different meanings:
 *
 * - before the numbered phase (`MV-C-1A`), or after an East marker
 *   (`MV 1 E-C`): Commercial;
 * - after any other numbered phase (`MV-2B C`, `MV-3 C`): Regular Corner.
 *
 * The other markers are unambiguous. Keeping this positional rule separate
 * makes the generic parser below continue to work for the other projects.
 */
function parseMvlcPhaseCode(tokens, config) {
  const phaseIndex = tokens.findIndex((token) => /^(?:PH)?\d+/.test(token))
  if (phaseIndex === -1) return { phase: null, section: null, category: config.fallback }

  const phaseToken = tokens[phaseIndex]
  const phase = Number.parseInt(/^(?:PH)?(\d+)/.exec(phaseToken)[1], 10)
  const separateEast = tokens[phaseIndex + 1] === 'E'
  const east = /^(?:PH)?\d+E/.test(phaseToken) || separateEast
  const suffix = /^(?:PH)?\d+([ABCE])$/.exec(phaseToken)?.[1] ?? (separateEast ? 'E' : '')
  const allowedSections = phase === 1 ? ['A', 'B', 'C', 'E'] : phase === 2 ? ['A', 'B', 'E'] : []
  const section = allowedSections.includes(suffix) ? (suffix === 'E' ? 'East' : suffix) : null
  const markers = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token, index }) => index !== phaseIndex && !(separateEast && index === phaseIndex + 1) && token !== 'MV')

  // Longer/specific markers win before the overloaded single C.
  const exact = markers.find(({ token }) => ['CC', 'CP', 'PC', 'P'].includes(token))
  if (exact) return { phase, section, category: config.markers[exact.token] }

  const commercialWord = markers.find(({ token }) => Object.keys(config.prefixes ?? {}).some((start) => token.startsWith(start)))
  if (commercialWord) {
    const prefix = Object.keys(config.prefixes).find((start) => commercialWord.token.startsWith(start))
    return { phase, section, category: config.prefixes[prefix] }
  }

  const c = markers.find(({ token }) => token === 'C')
  if (c) return { phase, section, category: c.index < phaseIndex || east ? 'commercial' : 'regular_corner' }

  return { phase, section, category: config.fallback }
}

/**
 * The phase number and category encoded in a phase-column code, as
 * { phase, category }. MVLC also returns `section` (A, B, C, East, or null).
 * Both base fields are empty for a project that uses plain phase numbers and for
 * a blank cell, so the caller falls back to reading the cell as a number.
 * `config` overrides the project's own codes (see CATEGORY_CODES).
 */
export function parsePhaseCode(projectCode, value, config = PHASE_CODES[projectCode]) {
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

  if (/^MVLC$/i.test(projectCode) && config === PHASE_CODES.MVLC) return parseMvlcPhaseCode(tokens, config)

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
  // MVLC reads and writes its dedicated table; public.lots remains untouched.
  MVLC: 'mvlc_lots',
  // Created by supabase/migrations/20260915_create_project_lot_tables.sql (erhd_lots
  // already existed) and given the lots columns by 20260915_copy_lots_columns_to_project_lot_tables.sql.
  EBLF: 'eblf_lots',
  ERHD: 'erhd_lots',
  GLS: 'gls_lots',
  MSCC: 'mscc_lots',
  // Created by supabase/migrations/20261011_add_rhn_rhm_lcn_mcvc_projects.sql.
  RHN: 'rhn_lots',
  RHM: 'rhm_lots',
  LCN: 'lcn_lots',
  MCVC: 'mcvc_lots',
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

/**
 * The block and lot of a "B12 L5A" / "B23-B L1" / "C L1" identifier, as
 * { block: 'B12' | 'B23-B' | 'C', lot: '5A' }; nulls for any other form.
 */
export function parseBlockLot(lotNo) {
  const matched = /^(B\d+(?:-[A-Z])?|C)\s*L\s*(\d+[A-Z]?)$/i.exec(text(lotNo).trim())
  return matched ? { block: matched[1].toUpperCase(), lot: matched[2].toUpperCase() } : { block: null, lot: null }
}

/** The More filters Block / Lot choice — both picked from lists, so matched exactly. */
function matchesBlockLot(lotNo, block, lot) {
  if (!block && !lot) return true
  const parsed = parseBlockLot(lotNo)
  if (block && parsed.block !== block.toUpperCase()) return false
  return !lot || parsed.lot === lot.toUpperCase()
}

const naturally = (a, b) => a.localeCompare(b, undefined, { numeric: true })
// Blocks in natural order (B2 before B10), commercial C last.
const byBlock = (a, b) => (a === 'C' ? 1 : b === 'C' ? -1 : naturally(a, b))

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
    // Set with Project Actions → Pause project (20261012_add_project_paused.sql).
    paused: false,
  },
  // What the selected project calls its lots and their grouping — see LOT_TERMS_BY_PROJECT.
  terms: DEFAULT_LOT_TERMS,
  // Every project, for the project switcher: [{ code, name, hasLots }]
  projects: [],
  // False when the selected project has no lot table yet.
  hasLotTable: false,
  // Project-wide counts. Unlike `lots`/`total`, these ignore the table filters.
  stats: { totalLots: 0, available: 0, reserved: 0, sold: 0, byStatus: {}, byPhase: {} },
  // Filter options come from the database, never a hardcoded list.
  facets: { phases: [], phaseFilters: [], categories: [], blockLotsByPhase: {} },
  // [{ id, identifier, phase, category, areaSqm, pricePerSqm, tcp, vatInclusive, status, rawStatus }]
  lots: [],
  total: 0, // lots matching the current filters, across every page
  page: 1,
  pageSize: 10,
}

const phaseLabel = (phase, terms = DEFAULT_LOT_TERMS, section = null) =>
  phase === null || phase === undefined || !terms.group
    ? ''
    : `${terms.group} ${phase}${section ? (section === 'East' ? ' East' : section) : ''}`
/** A stored category as the table shows it: "2_bedroom_deluxe" -> "2 Bedroom Deluxe". */
export const categoryLabel = (category) =>
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
export function parsePhaseFilter(value) {
  const label = text(value).trim()
  if (!label) return { phase: null, section: null, category: '' }
  // The longest matching label wins: "Phase 1 Prime Commercial" ends with
  // "Commercial" too, and must not be read as the plain commercial filter.
  const category =
    PHASE_FILTER_CATEGORIES.filter((name) => label.toLowerCase().endsWith(categoryLabel(name).toLowerCase())).sort(
      (a, b) => b.length - a.length,
    )[0] ?? ''
  const withoutCategory = category ? label.slice(0, -categoryLabel(category).length).trim() : label
  const matched = /(\d+)\s*(East|[ABC])?$/i.exec(withoutCategory)
  const phase = matched ? num(matched[1], NaN) : NaN
  const section = matched?.[2] ? (matched[2].toLowerCase() === 'east' ? 'East' : matched[2].toUpperCase()) : null
  return { phase: Number.isFinite(phase) ? phase : null, section, category }
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
  const data = await cached(['projects'], async () => {
    const read = (columns) => supabase.from('projects').select(columns).order('id', { ascending: false })
    // `paused` needs 20261012_add_project_paused.sql; until then every project reads as active.
    const withPaused = await read('id, code, name, paused')
    if (withPaused.error && /paused/.test(withPaused.error.message)) return unwrap(await read('id, code, name')).data
    return unwrap(withPaused).data
  })
  const byCode = new Map()
  data.forEach((row) => {
    const code = text(row.code).trim()
    if (code && !byCode.has(code)) byCode.set(code, row)
  })
  return [...byCode.values()]
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: text(row.name, row.code),
      hasLots: Boolean(LOT_TABLES[row.code]),
      paused: row.paused === true,
    }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

/** Project-wide stats and filter facets for one lot table — independent of table state. */
async function fetchSummary(table, terms) {
  const tracksSections = table === LOT_TABLES.MVLC
  const rows = await cached(['lot-summary', table], () =>
    fetchAllRows(table, `lot_no, phase, category, status${tracksSections ? ', map_section' : ''}`),
  )

  /*
   * `available`/`reserved`/`sold` group statuses as the rest of the portal does
   * (pending counts as reserved); `byStatus` counts each stored status on its own
   * — 'available', 'reserved', 'rsv-p', 'hold', 'sold' — for the stat cards.
   */
  const countRows = (items) => {
    const result = { totalLots: items.length, available: 0, reserved: 0, sold: 0, byStatus: {} }
    items.forEach((row) => {
      const status = uiStatus(row.status)
      if (status) result[status] += 1
      const raw = String(row.status ?? '').trim().toLowerCase()
      result.byStatus[raw] = (result.byStatus[raw] ?? 0) + 1
    })
    return result
  }

  const phases = [
    ...new Map(
      rows
        .filter((row) => row.phase !== null)
        .map((row) => [`${row.phase}|${text(row.map_section)}`, { phase: row.phase, section: text(row.map_section) || null }]),
    ).values(),
  ].sort((a, b) => a.phase - b.phase || text(a.section).localeCompare(text(b.section)))
  const stored = [...new Set(rows.map((row) => row.category).filter(Boolean))]
  // "Commercial" (every commercial grade) is offered whenever any commercial lot
  // exists, even if none is graded plain commercial.
  const categories = [
    ...new Set([...stored, ...(stored.some((category) => category.includes('commercial')) ? ['commercial'] : [])]),
  ].sort()
  // Blocks for More filters, in natural order (B2 before B10) with commercial C last.
  /*
   * For More filters: each phase filter's blocks and each block's lots, as
   * { 'Phase 1': { B1: ['1', '2', '5A'], C: ['1'] } }, so the choices only ever
   * name lots that exist in the phase picked.
   */
  const blockLots = {}
  rows.forEach((row) => {
    const { block, lot } = parseBlockLot(row.lot_no)
    if (!block || row.phase === null) return
    const phase = phaseLabel(row.phase, terms, text(row.map_section) || null)
    const inPhase = (blockLots[phase] ??= {})
    ;(inPhase[block] ??= new Set()).add(lot)
  })
  const blockLotsByPhase = Object.fromEntries(
    Object.entries(blockLots).map(([phase, blocks]) => [
      phase,
      Object.fromEntries(
        Object.keys(blocks)
          .sort(byBlock)
          .map((block) => [block, [...blocks[block]].sort(naturally)]),
      ),
    ]),
  )
  const stats = countRows(rows)
  stats.byPhase = Object.fromEntries(
    phases.map(({ phase, section }) => [
      phaseLabel(phase, terms, section),
      countRows(rows.filter((row) => row.phase === phase && text(row.map_section) === text(section))),
    ]),
  )

  return {
    stats,
    // A project whose lots are not grouped (ERHD) offers no phase filter.
    facets: {
      phases: terms.group ? phases.map(({ phase, section }) => phaseLabel(phase, terms, section)) : [],
      // Keep this identical to the distinct values displayed in the Phase column.
      phaseFilters: terms.group ? phases.map(({ phase, section }) => phaseLabel(phase, terms, section)) : [],
      categories: categories.map(categoryLabel),
      // Empty for a project whose identifiers are not block-and-lot, which hides the filter.
      blockLotsByPhase: terms.group ? blockLotsByPhase : {},
    },
    categoryByLabel: Object.fromEntries(categories.map((category) => [categoryLabel(category), category])),
  }
}

/**
 * One filtered, sorted page of lots. Filters run in the database; price per sqm
 * comes from the project's price table (by phase + category) and TCP is area x
 * that price, so sorting and paging happen here, after those are computed.
 */
async function fetchLotsPage(projectCode, table, query, categoryByLabelPromise) {
  // Only a category filter needs the summary's labels, so without one the rows
  // are asked for alongside the summary instead of after it.
  const categoryByLabel = query.category ? await categoryByLabelPromise : {}
  const page = num(query.page, 1) || 1
  const pageSize = num(query.pageSize, 10) || 10
  const terms = lotTermsFor(projectCode)

  const tracksSections = table === LOT_TABLES.MVLC
  const columns = `id, lot_no, phase, category, size_sqm, price_per_sqm, status, last_updated, updated_at${tracksSections ? ', map_section' : ''}`
  const filter = (request) => {
    let filtered = request
    if (STATUS_ALIASES[query.status]) filtered = filtered.in('status', STATUS_ALIASES[query.status])
    // "Phase 1 Commercial" narrows by category as well as by phase.
    const { phase, section, category } = parsePhaseFilter(query.phase)
    if (phase !== null) filtered = filtered.eq('phase', phase)
    if (tracksSections && section) filtered = filtered.eq('map_section', section)
    if (tracksSections && phase !== null && !section) filtered = filtered.is('map_section', null)
    if (category) filtered = filtered.eq('category', category)
    // "Commercial" means every commercial grade — Corner and Prime too — as a
    // search for "commercial" finds; the other categories match exactly.
    const pickedCategory = categoryByLabel[query.category]
    if (pickedCategory === 'commercial') filtered = filtered.ilike('category', '%commercial%')
    else if (pickedCategory) filtered = filtered.eq('category', pickedCategory)
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
  const attempts = [
    [...unitColumns, 'last_updated_precision', 'sold_by', 'reserve_type', 'reserved_for', 'payment_type', 'contract_type'],
    [...unitColumns, 'last_updated_precision', 'sold_by', 'reserve_type', 'reserved_for', 'payment_type'],
    [...unitColumns, 'last_updated_precision', 'sold_by', 'reserve_type', 'reserved_for'],
    [...unitColumns, 'last_updated_precision', 'sold_by', 'reserve_type'],
    ['sold_by'],
    [],
  ]

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
      mapSection: text(lot.map_section) || null,
      identifier: text(lot.lot_no, '—'),
      phase: phaseLabel(lot.phase, terms, text(lot.map_section) || null) || '—',
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
      // 'client' or 'company' for a reserved lot; '' for a default reservation or any other status.
      reserveType: text(lot.reserve_type),
      reservedFor: text(lot.reserved_for),
      // 'cash', 'installment', or '' when unknown or before 20261008_add_lot_payment_type.sql.
      paymentType: text(lot.payment_type),
      // 'cts', 'doas', or '' when unknown or before 20261009_add_lot_contract_type.sql.
      contractType: text(lot.contract_type),
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
  // Floor Level (MSCC) is matched here too, since it is not one of the database filters above.
  const inBlockLot = lots.filter(
    (lot) => matchesBlockLot(lot.lotNo, query.block, query.lot) && (!query.floor || lot.floorLevel === query.floor),
  )
  const matches = words.length
    ? inBlockLot.filter((lot) => {
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
    : inBlockLot

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
/** A lot table's summary and the requested page of its lots, fetched side by side. */
async function fetchLotTable(projectCode, query) {
  const table = LOT_TABLES[projectCode]
  const summary = fetchSummary(table, lotTermsFor(projectCode))
  const labels = summary.then((result) => result.categoryByLabel)
  labels.catch(() => {}) // a failed summary is reported through `summary` below
  const [{ stats, facets }, lotsPage] = await Promise.all([summary, fetchLotsPage(projectCode, table, query, labels)])
  return { stats, facets, ...lotsPage }
}

export async function fetchProjectLots(query = {}) {
  if (!supabase) return emptyPayload(query, SOURCE.NOT_CONFIGURED)

  /*
   * The project asked for is almost always the one shown, so its lots start
   * loading alongside the project list rather than after it. Should the list
   * pick another project, this head start is dropped.
   */
  const guess = LOT_TABLES[query.projectCode] ? query.projectCode : DEFAULT_PROJECT_CODE
  const early = fetchLotTable(guess, query)
  early.catch(() => {}) // awaited below when used; an unused failure is not an error

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
        ? { ...EMPTY_PROJECT_LOTS.project, id: selected.id, name: selected.name, code: selected.code, paused: selected.paused }
        : EMPTY_PROJECT_LOTS.project,
    }

    const table = selected && LOT_TABLES[selected.code]
    if (!table) return base

    const lotTable = await (selected.code === guess ? early : fetchLotTable(selected.code, query))
    return { ...base, ...lotTable, hasLotTable: true }
  } catch (err) {
    // Log it so a broken connection is visible, but render an empty table rather
    // than a blank screen or invented rows.
    console.error('[projects] falling back to an empty table:', err)
    return emptyPayload(query, SOURCE.UNAVAILABLE)
  }
}

/**
 * Pause or resume a project. Only a flag: the portal shows it as a Paused badge
 * (and the broker app can read the same column); lots stay fully editable.
 * Every row with the code is updated, since the projects table repeats codes.
 * Throws when Supabase is unset, the column is missing, or no row was changed.
 */
export async function setProjectPaused(code, paused) {
  if (!supabase) throw new Error('No database connected.')
  const { data, error } = await supabase.from('projects').update({ paused }).eq('code', code).select('id')
  if (error) {
    if (/paused/.test(error.message)) {
      throw new Error('The projects table has no paused column yet — run supabase/migrations/20261012_add_project_paused.sql in the Supabase SQL Editor.')
    }
    throw error
  }
  if (!data?.length) throw new Error(`The database did not accept the change to ${code} — you may need to sign in.`)
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
const OPTIONAL_COLUMNS = ['last_updated_precision', 'reserve_type']

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
 *
 * `reserveType` ('client', 'company', or '' for the default) is recorded with a
 * reserved status; left undefined, a reserved lot keeps the type it had.
 */
export async function updateLotStatus(id, status, projectCode = DEFAULT_PROJECT_CODE, { reserveType } = {}) {
  if (!supabase) throw new Error('No database connected.')
  const table = LOT_TABLES[projectCode]
  if (!table) throw new Error(`No lot table is set up for ${projectCode}.`)
  if (!LOT_STATUS_OPTIONS.some((option) => option.value === status)) {
    throw new Error(`Unknown status "${status}".`)
  }
  if (reserveType !== undefined && !RESERVE_TYPE_OPTIONS.some((option) => option.value === reserveType)) {
    throw new Error(`Unknown reserve type "${reserveType}".`)
  }
  const reserved = uiStatus(status) === 'reserved'

  const now = new Date()
  // Editing in the portal always knows the day, so the month-only marker is cleared.
  const changes = {
    status,
    last_updated: now.toISOString().slice(0, 10),
    last_updated_precision: null,
    updated_at: now.toISOString(),
    // The reserve type only means something while the lot is reserved.
    ...(!reserved ? { reserve_type: null } : reserveType !== undefined ? { reserve_type: reserveType || null } : {}),
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

/** Who a reserved lot is held for. '' is the default reservation and is stored as null. */
export const RESERVE_TYPE_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'client', label: 'Client Reserved' },
  { value: 'company', label: 'Company Reserved' },
]

const RESERVE_TYPE_MISSING =
  'The lot table has no reserve_type column yet — run supabase/migrations/20260921_add_lot_reserve_type.sql in the Supabase SQL Editor.'

/** Record a reserved lot's reserve type. The status itself stays reserved. */
export async function updateReserveType(id, projectCode, reserveType) {
  const table = lotTableFor(projectCode)
  if (!RESERVE_TYPE_OPTIONS.some((option) => option.value === reserveType)) {
    throw new Error(`Unknown reserve type "${reserveType}".`)
  }

  const result = await supabase
    .from(table)
    .update({
      reserve_type: reserveType || null,
      // A client name must not remain attached after switching to Company/Default.
      ...(reserveType === 'client' ? {} : { reserved_for: null }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id')
  if (result.error) {
    throw new Error(/reserve_type/.test(result.error.message) ? RESERVE_TYPE_MISSING : result.error.message)
  }
  if (!result.data?.length) throw new Error('The database did not accept the change — you may need to sign in.')
}

/** A lot identifier as written on a map or a sheet: case, spaces, and punctuation ignored. */
export const lotKey = (value) =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** MVLC lot identifiers are stored consistently as "B1 L1" or "C L1". */
export function formatLotIdentifier(projectCode, value) {
  let raw = text(value).trim()
  if (!/^MVLC$/i.test(projectCode)) return raw

  // Excel turns 21-1 through 21-12 into 21-Jan through 21-Dec.
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const dated = /^(\d+)-([a-z]{3,9})(?:-\d{2,4})?$/i.exec(raw)
  if (dated) {
    const month = months.indexOf(dated[2].slice(0, 3).toLowerCase())
    if (month !== -1) raw = `${dated[1]}-${month + 1}`
  }

  const canonical = /^B\s*(\d+)(?:-([A-Z]))?\s*[- ]*\s*L\s*(\d+)([A-Z]?)$/i.exec(raw)
  if (canonical) {
    return `B${Number(canonical[1])}${canonical[2] ? `-${canonical[2].toUpperCase()}` : ''} L${Number(canonical[3])}${canonical[4].toUpperCase()}`
  }

  // 21-32A is Block 21, Lot 32A; 23-B-1 is Block 23-B, Lot 1.
  const legacy = /^(\d+)(?:-([A-Z]))?-(\d+)([A-Z]?)$/i.exec(raw)
  if (legacy) {
    return `B${Number(legacy[1])}${legacy[2] ? `-${legacy[2].toUpperCase()}` : ''} L${Number(legacy[3])}${legacy[4].toUpperCase()}`
  }

  // MVLC's block-less identifiers are commercial lots, labelled "C L1" on the map.
  const commercial = /^(?:C\s*[- ]*\s*)?(?:LOT|L)\s*[- ]*\s*(\d+)([A-Z]?)$/i.exec(raw)
  if (commercial) return `C L${Number(commercial[1])}${commercial[2].toUpperCase()}`
  return raw
}

export function isLotIdentifierValid(projectCode, value) {
  if (!/^MVLC$/i.test(projectCode)) return Boolean(text(value).trim())
  return /^(?:B[1-9]\d*(?:-[A-Z])?|C) L[1-9]\d*[A-Z]?$/.test(formatLotIdentifier(projectCode, value))
}

/**
 * The project's lots by identifier (lotKey → [{ id, lotNo, phase, category, status, areaSqm }]),
 * narrowed to one phase when `phase` is given. A key can hold several lots —
 * the same identifier in two phases — which callers must treat as ambiguous.
 */
export async function fetchLotsByIdentifier(projectCode, { phase = null, section = null } = {}) {
  const table = lotTableFor(projectCode)
  const tracksSections = table === LOT_TABLES.MVLC
  const narrow = (query) => {
    let filtered = phase === null ? query : query.eq('phase', phase)
    if (tracksSections && section) filtered = filtered.eq('map_section', section)
    else if (tracksSections && phase !== null) filtered = filtered.is('map_section', null)
    return filtered
  }
  const columns = `id, lot_no, phase, category, status, size_sqm${tracksSections ? ', map_section' : ''}`
  // reserve_type comes from a later migration; without it every lot reads as the default reservation.
  const rows = await fetchAllRows(table, `${columns}, reserve_type`, narrow).catch((err) => {
    if (!/reserve_type/.test(err.message)) throw err
    return fetchAllRows(table, columns, narrow)
  })
  const byKey = new Map()
  rows.forEach((row) => {
    const key = lotKey(row.lot_no)
    if (!key) return
    const lot = {
      id: row.id,
      lotNo: text(row.lot_no),
      phase: row.phase ?? null,
      mapSection: text(row.map_section) || null,
      category: text(row.category),
      status: text(row.status),
      reserveType: text(row.reserve_type),
      areaSqm: num(row.size_sqm),
    }
    byKey.set(key, [...(byKey.get(key) ?? []), lot])
  })
  return byKey
}

/**
 * Apply several status changes ([{ id, lotNo, status, reserveType? }]) one lot at a time.
 * Never stops at the first failure: returns { updated, failed: [{ lotNo, message }] }.
 */
export async function updateLotStatuses(changes, projectCode) {
  let updated = 0
  const failed = []
  for (const change of changes) {
    try {
      await updateLotStatus(change.id, change.status, projectCode, { reserveType: change.reserveType })
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
 * new lot may set it by hand — a lot's sheet date is often not the day it is typed
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

  const lot_no = formatLotIdentifier(projectCode, lotNo)
  if (!lot_no) throw new Error(`${lotTermsFor(projectCode).item} identifier is required.`)
  if (!isLotIdentifierValid(projectCode, lot_no)) throw new Error('MVLC lot identifier must use a format such as B21 L1, B23-B L1, or C L1.')
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
    // Preserve the lot's source date when this form only edits its other fields.
    ...(lastUpdated === undefined ? {} : {
      last_updated: lastUpdatedDay(lastUpdated, now.toISOString().slice(0, 10)),
      last_updated_precision: null,
    }),
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

  const lot_no = formatLotIdentifier(projectCode, lotNo)
  if (!lot_no) throw new Error(`${lotTermsFor(projectCode).item} identifier is required.`)
  if (!isLotIdentifierValid(projectCode, lot_no)) throw new Error('MVLC lot identifier must use a format such as B21 L1, B23-B L1, or C L1.')
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

/** The tables fetchProjectLots reads for `query`, so its Refresh button knows what to check. */
fetchProjectLots.tables = (query = {}) => {
  const code = LOT_TABLES[query.projectCode] ? query.projectCode : DEFAULT_PROJECT_CODE
  return ['projects', LOT_TABLES[code], PRICE_CONFIG[code]?.table].filter(Boolean)
}
