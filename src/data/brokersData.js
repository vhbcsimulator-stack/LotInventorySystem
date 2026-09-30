/*
 * Broker accounts. Each is a login for the mobile app (Supabase Authentication,
 * shared with this portal) plus a row in the `brokers` table:
 * id, first_name, last_name, mobile_number, email, auth_user_id, user_id,
 * created_at, updated_at. See supabase/migrations/20261006_create_brokers.sql.
 *
 * Accounts are created by the `create-broker` Edge Function
 * (supabase/functions/create-broker): making a login from the browser would sign
 * the admin out, and the key that can make one must stay on the server.
 */
import { SOURCE, num, text } from '@/data/api'
import { LOT_TABLES } from '@/data/projectsData'
import { fetchAllRows, supabase, uiStatus, unwrap } from '@/data/supabase'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalize(row) {
  return {
    id: row.id,
    firstName: text(row.first_name),
    lastName: text(row.last_name),
    mobileNumber: text(row.mobile_number),
    email: text(row.email),
    createdAt: text(row.created_at),
  }
}

/**
 * A person's name reduced for matching: no accents, case, punctuation, or extra
 * spaces, so "juan  DELA-cruz" matches "Juan Dela Cruz".
 */
export function salesKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Sold lots per agent name across every project's lot table, keyed by
 * salesKey(sold_by). Lots record their agent only as the free-text `sold_by`,
 * so this is how a broker account is credited with a sale. `total` is the lot's
 * TCP at the price table's current rate, the same figure Projects & Lots shows.
 * A table that cannot be read (or has no sold_by column yet) is skipped.
 */
async function fetchSalesByAgent() {
  const perTable = await Promise.all(
    Object.values(LOT_TABLES).map((table) =>
      fetchAllRows(table, 'id, status, sold_by, total', (query) => query.not('sold_by', 'is', null)).catch((err) => {
        console.error(`[brokers] no sales from ${table}:`, err)
        return []
      }),
    ),
  )

  const byAgent = new Map()
  perTable.flat().forEach((lot) => {
    if (uiStatus(lot.status) !== 'sold') return
    const key = salesKey(lot.sold_by)
    if (!key) return
    const entry = byAgent.get(key) ?? { lotsSold: 0, totalTcp: 0 }
    entry.lotsSold += 1
    entry.totalTcp += num(lot.total)
    byAgent.set(key, entry)
  })
  return byAgent
}

/** Trim every field and lower-case the email, as it is stored. */
export function cleanBroker({ firstName = '', lastName = '', mobileNumber = '', email = '' }) {
  return {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    mobileNumber: mobileNumber.trim(),
    email: email.trim().toLowerCase(),
  }
}

/**
 * Field-by-field problems with a broker form, keyed like the form. Empty when
 * it can be saved. A mobile number may carry +, spaces, dashes, and
 * parentheses, but needs 10 to 13 digits (09171234567, +63 917 123 4567).
 */
export function validateBroker(form) {
  const broker = cleanBroker(form)
  const errors = {}
  if (!broker.firstName) errors.firstName = 'Enter a first name.'
  if (!broker.lastName) errors.lastName = 'Enter a last name.'
  const digits = broker.mobileNumber.replace(/\D/g, '')
  if (!broker.mobileNumber) errors.mobileNumber = 'Enter a mobile number.'
  else if (/[^\d+\s()-]/.test(broker.mobileNumber) || digits.length < 10 || digits.length > 13) {
    errors.mobileNumber = 'Enter a valid mobile number, e.g. 0917 123 4567.'
  }
  if (!broker.email) errors.email = 'Enter an email address.'
  else if (!EMAIL_PATTERN.test(broker.email)) errors.email = 'Enter a valid email address.'
  return errors
}

/**
 * Brokers, newest first, each with `lotsSold` and `totalTcp`: the sold lots
 * whose `sold_by` names them. Never throws: failures resolve empty with a `source`.
 */
export async function fetchBrokers() {
  if (!supabase) return { brokers: [], source: SOURCE.NOT_CONFIGURED }

  try {
    const [{ data }, sales] = await Promise.all([
      supabase
        .from('brokers')
        .select('id, first_name, last_name, mobile_number, email, created_at')
        .order('created_at', { ascending: false })
        .then(unwrap),
      fetchSalesByAgent(),
    ])
    const brokers = data.map((row) => {
      const broker = normalize(row)
      const stats = sales.get(salesKey(`${broker.firstName} ${broker.lastName}`))
      return { ...broker, lotsSold: stats?.lotsSold ?? 0, totalTcp: stats?.totalTcp ?? 0 }
    })
    return { brokers, source: SOURCE.DATABASE }
  } catch (err) {
    console.error('[brokers] falling back to an empty list:', err)
    return { brokers: [], source: SOURCE.UNAVAILABLE }
  }
}

/**
 * Create the broker's app login and their `brokers` row as one step: the
 * function removes the login again if the row cannot be saved. Resolves to
 * { id, authUserId, email, password }, where `password` is the temporary one
 * the function generated. It is returned only here, so show it now. Throws with
 * a readable message on failure.
 */
export function createBroker(form) {
  return invoke('create-broker', cleanBroker(form))
}

/**
 * Remove a broker account for good: their app login first, then their
 * `brokers` row. Throws with a readable message on failure.
 */
export function deleteBroker(id) {
  return invoke('delete-broker', { id })
}

/** Call one of the broker Edge Functions, turning its { error } reply into a thrown Error. */
async function invoke(name, body) {
  if (!supabase) throw new Error('No database connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (!error) return data

  // The function answers failures with { error }; it arrives on the response.
  const message = await error.context?.json?.().then((reply) => reply?.error, () => '')
  if (message) throw new Error(message)
  if (error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError') {
    throw new Error(`Could not reach the ${name} function — has it been deployed?`)
  }
  throw new Error(error.message)
}

/** The tables fetchBrokers reads, so its Refresh button knows what to check. */
fetchBrokers.tables = () => ['brokers', ...Object.values(LOT_TABLES)]
