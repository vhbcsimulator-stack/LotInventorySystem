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
import { SOURCE, text } from '@/data/api'
import { supabase, unwrap } from '@/data/supabase'

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

/** Brokers, newest first. Never throws: failures resolve empty with a `source`. */
export async function fetchBrokers() {
  if (!supabase) return { brokers: [], source: SOURCE.NOT_CONFIGURED }

  try {
    const { data } = unwrap(
      await supabase
        .from('brokers')
        .select('id, first_name, last_name, mobile_number, email, created_at')
        .order('created_at', { ascending: false }),
    )
    return { brokers: data.map(normalize), source: SOURCE.DATABASE }
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
fetchBrokers.tables = () => ['brokers']
