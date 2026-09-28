/*
 * ---------------------------------------------------------------------------
 * PAYMENT OPTION DISCOUNTS
 * ---------------------------------------------------------------------------
 * Every project sells under the same five payment options — Cash, and 50/30/20/0
 * percent down — and each option carries its own discount and interest rate.
 * They live in `project_discounts`, one row per project and option, created by
 * supabase/migrations/20260923_create_project_discounts.sql.
 *
 * An option with no row yet reads as 0% discount and 0% interest, so a project
 * that has never been edited still opens with a full set of fields.
 */
import { cached, queryClient } from './queryClient'
import { supabase, unwrap } from './supabase'

/**
 * The payment options, in the order they are shown. The percentage in each name
 * is the share paid up front, so "50% down" leaves half to carry interest and
 * "0% down" leaves all of it. Cash pays the whole discounted price at once.
 */
export const PAYMENT_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: '50', label: '50% down' },
  { value: '30', label: '30% down' },
  { value: '20', label: '20% down' },
  { value: '0', label: '0% down' },
]

const EMPTY = { discount: 0, interest: 0 }

/** The share paid up front under an option: Cash pays all of it. */
const downRate = (option) => (option === 'cash' ? 100 : Number(option) || 0)

/**
 * What one lot costs under a payment option, used for the dialog's preview.
 * The discount comes off the list price first; the down payment is that share
 * of the discounted price, and the interest is charged on the balance left.
 * Cash puts the whole discounted price down, so its balance is always zero.
 */
export function quote({ price, option, discount, interest }) {
  // Rounded to centavos, so the figures add up as money rather than as floats.
  const centavos = (value) => Math.round(value * 100) / 100
  const net = centavos(price * (1 - discount / 100))
  const downPayment = centavos(net * (downRate(option) / 100))
  const balance = centavos((net - downPayment) * (1 + interest / 100))
  return { net, downPayment, balance, total: centavos(downPayment + balance) }
}

/**
 * The `project_code` the shared rates are stored under — the set every project
 * falls back on. It is not a real project code, so nothing can collide with it.
 */
export const SHARED = '*'

const asRate = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0)

const blankRates = () => Object.fromEntries(PAYMENT_OPTIONS.map(({ value }) => [value, { ...EMPTY }]))

/** Rows for one project_code folded into { [option]: { discount, interest } }. */
function ratesFrom(rows) {
  const rates = blankRates()
  rows.forEach((row) => {
    if (rates[row.option]) rates[row.option] = { discount: asRate(row.discount), interest: asRate(row.interest) }
  })
  return rates
}

/**
 * The rates in play for one project:
 *
 *   shared     the rates every project uses unless it has its own
 *   own        this project's own rates, or null when it follows the shared set
 *   rates      the ones that actually apply — `own` when set, else `shared`
 *   separate   whether this project keeps its own rates
 *   hasShared  whether a shared set has ever been saved
 *
 * Resolves to zeroes, following the shared set, with no database.
 */
export async function fetchDiscounts(projectCode) {
  if (!supabase || !projectCode) {
    const rates = blankRates()
    return { shared: rates, own: null, rates, separate: false, hasShared: false }
  }

  const rows = await cached(['project_discounts', projectCode], async () =>
    unwrap(
      await supabase
        .from('project_discounts')
        .select('project_code, option, discount, interest')
        .in('project_code', [SHARED, projectCode]),
    ).data,
  )

  const ownRows = rows.filter((row) => row.project_code === projectCode)
  const sharedRows = rows.filter((row) => row.project_code === SHARED)
  const shared = ratesFrom(sharedRows)
  const own = ownRows.length ? ratesFrom(ownRows) : null
  return { shared, own, rates: own ?? shared, separate: Boolean(own), hasShared: sharedRows.length > 0 }
}

/** The codes of the projects keeping their own rates, for the dialog's note. */
export async function fetchSeparateProjects() {
  if (!supabase) return []
  const rows = await cached(['project_discounts', 'separate'], async () =>
    unwrap(await supabase.from('project_discounts').select('project_code').neq('project_code', SHARED)).data,
  )
  return [...new Set(rows.map((row) => row.project_code))].sort()
}

function rowsFor(code, values) {
  const stamp = new Date().toISOString()
  return PAYMENT_OPTIONS.map(({ value, label }) => {
    const { discount, interest } = values[value] ?? EMPTY
    const bad = [discount, interest].some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100)
    if (bad) throw new Error(`${label} needs a discount and interest between 0 and 100.`)
    return { project_code: code, option: value, discount, interest, updated_at: stamp }
  })
}

/**
 * Write one payment-option set. `values` is { [option]: { discount, interest } }
 * as percentages from 0 to 100, the range the table's CHECK constraints allow.
 *
 * `separate: false` writes the shared set every project falls back on, and drops
 * this project's own rows so it follows that set again. `separate: true` writes
 * rows for this project alone, leaving the shared set and every other project
 * untouched.
 */
export async function saveDiscounts(projectCode, values, { separate = false } = {}) {
  if (!supabase) throw new Error('No database connected.')
  if (!projectCode) throw new Error('No project selected.')

  const rows = rowsFor(separate ? projectCode : SHARED, values)
  const { data } = unwrap(
    await supabase.from('project_discounts').upsert(rows, { onConflict: 'project_code,option' }).select('option'),
  )
  if (!data.length) throw new Error('The database did not accept the discounts — you may need to sign in.')

  // Back on the shared set, this project's own rows would otherwise still win.
  if (!separate) unwrap(await supabase.from('project_discounts').delete().eq('project_code', projectCode).select('option'))

  queryClient.invalidateQueries({ queryKey: ['project_discounts'] })
  return { saved: data.length }
}
