/*
 * ---------------------------------------------------------------------------
 * CATEGORY PRICES
 * ---------------------------------------------------------------------------
 * Each project keeps its price per sqm in its own table with its own shape, so
 * PRICE_CONFIG describes, per project code: the table, the price scopes (MVLC has
 * one row per phase; the others have a single row), and the category columns.
 *
 * Saving writes the price row and then re-prices EVERY lot in that scope whose
 * category changed (any status), so stored lot prices match the price table.
 */
import { LOT_TABLES } from './projectsData'
import { cached } from './queryClient'
import { fetchAllRows, supabase, unwrap } from './supabase'

const CORNER_CATEGORIES = [
  { key: 'regular', label: 'Regular' },
  { key: 'regular_corner', label: 'Regular Corner' },
  { key: 'prime', label: 'Prime' },
  { key: 'prime_corner', label: 'Prime Corner' },
]

const COMMERCIAL_CATEGORIES = [
  { key: 'commercial', label: 'Commercial' },
  { key: 'commercial_corner', label: 'Commercial Corner' },
  { key: 'prime_commercial', label: 'Prime Commercial' },
  { key: 'prime_commercial_corner', label: 'Prime Commercial Corner' },
]

/**
 * `scopes[].match` finds the price row: a column + value, or `first` for a table
 * holding a single row. `scopes[].phase` is the lot phase re-priced on apply.
 *
 * A `phased` table instead keeps one row per phase in its `phase` column, for
 * any phase — so a phase added from the Map tab can be priced like the rest.
 * With `allPhases`, a row whose phase is null prices every phase (and every
 * category) that has no price of its own.
 */
export const PRICE_CONFIG = {
  MVLC: {
    table: 'mvlc_price',
    phased: true,
    categories: [...CORNER_CATEGORIES, ...COMMERCIAL_CATEGORIES],
  },
  EBLF: {
    table: 'eblf_price',
    scopes: [{ value: 'main', label: 'Main Phase', match: { column: 'phase', value: 'phase_main' } }],
    categories: CORNER_CATEGORIES,
  },
  ERHD: {
    table: 'erhd_price',
    scopes: [{ value: 'main', label: 'Main Phase', match: { first: true } }],
    // ERHD sells corner lots too — its sheets grade them ERHD-C — so erhd_price
    // has a regular_corner column and all four categories are offered.
    categories: CORNER_CATEGORIES,
  },
  // Created by supabase/migrations/20260915_create_gls_price.sql.
  GLS: {
    table: 'gls_price',
    scopes: [{ value: 'main', label: 'Main Phase', match: { first: true } }],
    categories: CORNER_CATEGORIES.filter((category) => category.key !== 'regular_corner'),
  },
  MSCC: {
    table: 'mscc_price',
    scopes: [{ value: 'main', label: 'Main Phase', match: { first: true } }],
    categories: [{ key: 'price_per_sqm', label: 'Price per sqm' }],
  },
}

/**
 * A project added from the portal (projectsData's createProject) has a phased
 * price table with an all-phases row and every land category.
 */
export function registerPriceTable(projectCode, table) {
  PRICE_CONFIG[projectCode] ??= {
    table,
    phased: true,
    allPhases: true,
    categories: [...CORNER_CATEGORIES, ...COMMERCIAL_CATEGORIES],
  }
}

/** Forget a deleted portal-added project's price table; built-in ones stay. */
export function unregisterPriceTable(projectCode) {
  if (PRICE_CONFIG[projectCode]?.allPhases) delete PRICE_CONFIG[projectCode]
}

/** The all-phases scope of a phased table with `allPhases`. */
export const ALL_PHASES = 'all'

/** The scope a price dialog opens on before the project's phases are known. */
export function defaultScopeValue(config) {
  if (!config) return ''
  if (config.phased) return config.allPhases ? ALL_PHASES : '1'
  return config.scopes[0].value
}

/** A phase number's scope value ('3'), or the all-phases scope for null. */
export const phaseScopeValue = (phase) => (phase === null || phase === undefined ? ALL_PHASES : String(phase))

function scopeOf(config, scopeValue) {
  if (!config.phased) return config.scopes.find((scope) => scope.value === scopeValue) ?? config.scopes[0]
  const phase = Number.parseInt(scopeValue ?? defaultScopeValue(config), 10)
  if (Number.isInteger(phase) && phase > 0) {
    return { value: String(phase), label: `Phase ${phase}`, match: { column: 'phase', value: phase }, phase }
  }
  return config.allPhases
    ? { value: ALL_PHASES, label: 'All phases', match: { column: 'phase', value: null }, all: true }
    : scopeOf(config, '1')
}

/** The existing price row for one scope, or null when none is stored yet. */
async function findRow(config, scope) {
  let request = supabase.from(config.table).select('*').order('id', { ascending: true }).limit(1)
  if (!scope.match.first) {
    request =
      scope.match.value === null ? request.is(scope.match.column, null) : request.eq(scope.match.column, scope.match.value)
  }
  return unwrap(await request).data[0] ?? null
}

const priceIn = (row, category) => {
  // MSCC stores one price for every category.
  const price = row?.[category] ?? row?.price_per_sqm
  return typeof price === 'number' && Number.isFinite(price) ? price : null
}

/**
 * A phased table's rows as `(phase, category) => price | null`: the phase's own
 * price, else (with `allPhases`) the all-phases row's.
 */
function phasedLookup(rows) {
  const byPhase = new Map()
  let all = null
  rows.forEach((row) => {
    if (row.phase === null || row.phase === undefined) all ??= row
    else if (!byPhase.has(Number(row.phase))) byPhase.set(Number(row.phase), row)
  })
  return (phase, category) => priceIn(byPhase.get(phase), category) ?? priceIn(all, category)
}

/**
 * A price lookup for a project's lots: `(phase, category) => price | null`.
 * Phased tables (MVLC) match the lot's phase; single-row tables price every lot.
 */
export async function fetchPriceLookup(projectCode) {
  const config = PRICE_CONFIG[projectCode]
  if (!supabase || !config) return () => null

  const data = await cached(['prices', config.table], async () =>
    unwrap(await supabase.from(config.table).select('*').order('id', { ascending: true })).data,
  )
  if (config.phased) return phasedLookup(data)
  const rowFor = new Map()
  config.scopes.forEach((scope) => {
    const row = scope.match.first ? data[0] : data.find((candidate) => candidate[scope.match.column] === scope.match.value)
    if (row) rowFor.set(scope.phase ?? 'all', row)
  })

  return (phase, category) => priceIn(rowFor.get(phase) ?? rowFor.get('all'), category)
}

/** Current prices for a scope as { categoryKey: number | null }. */
export async function fetchPrices(projectCode, scopeValue) {
  const config = PRICE_CONFIG[projectCode]
  if (!supabase || !config) return {}
  const row = await findRow(config, scopeOf(config, scopeValue))
  return Object.fromEntries(config.categories.map(({ key }) => [key, row?.[key] ?? null]))
}

/**
 * Save the non-blank prices for a scope, then apply them to all its lots.
 * `values` is { categoryKey: number }; keys left out keep their stored price.
 * Resolves to { repriced } — how many lots were updated.
 */
export async function savePrices(projectCode, scopeValue, values) {
  const config = PRICE_CONFIG[projectCode]
  if (!supabase) throw new Error('No database connected.')
  if (!config) throw new Error(`No price table is set up for ${projectCode}.`)
  const scope = scopeOf(config, scopeValue)

  const changes = Object.fromEntries(
    config.categories
      .filter(({ key }) => Number.isFinite(values[key]))
      .map(({ key }) => [key, values[key]]),
  )
  if (!Object.keys(changes).length) return { repriced: 0 }

  const existing = await findRow(config, scope)
  const write = existing
    ? supabase.from(config.table).update(changes).eq('id', existing.id)
    : supabase.from(config.table).insert({ ...changes, ...(scope.match.first ? {} : { [scope.match.column]: scope.match.value }) })
  const { data } = unwrap(await write.select('id'))
  if (!data.length) throw new Error('The database did not accept the new prices — you may need to sign in.')

  return { repriced: await applyToLots(projectCode, scope, changes) }
}

/** Re-price every lot (any status) whose category has a new price. */
async function applyToLots(projectCode, scope, changes) {
  const table = LOT_TABLES[projectCode]
  if (!table) return 0

  let lots = await fetchAllRows(table, 'id, phase, category, size_sqm', (query) => {
    let filtered = query.in('category', Object.keys(changes))
    if (scope.phase !== undefined) filtered = filtered.eq('phase', scope.phase)
    return filtered
  })

  /*
   * The all-phases row only prices a lot whose phase has no price of its own
   * for its category, so a phase priced separately keeps its price.
   */
  if (scope.all) {
    const config = PRICE_CONFIG[projectCode]
    const rows = unwrap(await supabase.from(config.table).select('*').not('phase', 'is', null)).data
    const own = phasedLookup(rows)
    lots = lots.filter((lot) => lot.phase === null || own(lot.phase, lot.category) === null)
  }

  const now = new Date()
  const stamp = { updated_at: now.toISOString(), last_updated: now.toISOString().slice(0, 10) }

  // `total` is generated by the database from size_sqm * price_per_sqm, so only the price is written.
  let repriced = 0
  for (let i = 0; i < lots.length; i += 20) {
    const batch = lots.slice(i, i + 20)
    const results = await Promise.all(
      batch.map((lot) => {
        const price = changes[lot.category]
        return supabase
          .from(table)
          .update({ price_per_sqm: price, ...stamp })
          .eq('id', lot.id)
          .select('id')
      }),
    )
    results.forEach((result) => {
      repriced += unwrap(result).data.length
    })
  }
  return repriced
}
