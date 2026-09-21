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

/**
 * `scopes[].match` finds the price row: a column + value, or `first` for a table
 * holding a single row. `scopes[].phase` is the lot phase re-priced on apply.
 */
export const PRICE_CONFIG = {
  MVLC: {
    table: 'mvlc_price',
    scopes: [1, 2, 3].map((phase) => ({ value: String(phase), label: `Phase ${phase}`, match: { column: 'phase', value: phase }, phase })),
    categories: [
      ...CORNER_CATEGORIES,
      { key: 'commercial', label: 'Commercial' },
      { key: 'commercial_corner', label: 'Commercial Corner' },
      { key: 'prime_commercial', label: 'Prime Commercial' },
      { key: 'prime_commercial_corner', label: 'Prime Commercial Corner' },
    ],
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

function scopeOf(config, scopeValue) {
  return config.scopes.find((scope) => scope.value === scopeValue) ?? config.scopes[0]
}

/** The existing price row for one scope, or null when none is stored yet. */
async function findRow(config, scope) {
  let request = supabase.from(config.table).select('*').order('id', { ascending: true }).limit(1)
  if (!scope.match.first) request = request.eq(scope.match.column, scope.match.value)
  return unwrap(await request).data[0] ?? null
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
  const rowFor = new Map()
  config.scopes.forEach((scope) => {
    const row = scope.match.first ? data[0] : data.find((candidate) => candidate[scope.match.column] === scope.match.value)
    if (row) rowFor.set(scope.phase ?? 'all', row)
  })

  return (phase, category) => {
    const row = rowFor.get(phase) ?? rowFor.get('all')
    // MSCC stores one price for every category.
    const price = row?.[category] ?? row?.price_per_sqm
    return typeof price === 'number' && Number.isFinite(price) ? price : null
  }
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

  const lots = await fetchAllRows(table, 'id, category, size_sqm', (query) => {
    let filtered = query.in('category', Object.keys(changes))
    if (scope.phase !== undefined) filtered = filtered.eq('phase', scope.phase)
    return filtered
  })

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
