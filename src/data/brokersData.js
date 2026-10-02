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
 * Every sold lot's seller across every project's lot table, as
 * [{ seller, total }]: `column` is `sold_by` (brokers) or `sales_agent` (sales
 * agents), holding the account's email (or, for older lots and "Other", a
 * name). `total` is the lot's TCP, the same figure Projects & Lots shows. A
 * table that cannot be read (or lacks the column) is skipped.
 */
async function fetchSoldLots(column) {
  const perTable = await Promise.all(
    Object.values(LOT_TABLES).map((table) =>
      fetchAllRows(table, `id, status, ${column}, total`, (query) => query.not(column, 'is', null)).catch((err) => {
        console.error(`[brokers] no sales from ${table}:`, err)
        return []
      }),
    ),
  )
  return perTable
    .flat()
    .filter((lot) => uiStatus(lot.status) === 'sold')
    .map((lot) => ({ seller: text(lot[column]).trim(), total: num(lot.total) }))
}

/**
 * Lots sold and TCP per account id. A lot goes to the account whose email it
 * stores; one storing a name (older lots) goes to the account of that name, but
 * only when exactly one account has it — two "Gerald Delima"s are different
 * people, so a name alone credits neither.
 */
export function creditSales(accounts, lots) {
  const byEmail = new Map(accounts.filter((account) => account.email).map((account) => [account.email.toLowerCase(), account]))
  const byName = new Map()
  accounts.forEach((account) => {
    const key = salesKey(`${account.firstName} ${account.lastName}`)
    byName.set(key, [...(byName.get(key) ?? []), account])
  })
  const stats = new Map()
  lots.forEach((lot) => {
    let account = byEmail.get(lot.seller.toLowerCase())
    if (!account) {
      const same = byName.get(salesKey(lot.seller)) ?? []
      if (same.length === 1) account = same[0]
    }
    if (!account) return
    const entry = stats.get(account.id) ?? { lotsSold: 0, totalTcp: 0 }
    entry.lotsSold += 1
    entry.totalTcp += lot.total
    stats.set(account.id, entry)
  })
  return stats
}

/**
 * The two kinds of seller the portal keeps, credited with sales the same way.
 * A broker is also a login for the mobile app (`hasLogin`), made and removed by
 * the create-broker / delete-broker Edge Functions; a sales agent is only a
 * record, added and removed here.
 */
export const ACCOUNT_KINDS = {
  broker: {
    kind: 'broker',
    table: 'brokers',
    hasLogin: true,
    singular: 'broker',
    plural: 'brokers',
    title: 'Broker',
    titlePlural: 'Brokers',
  },
  sales_agent: {
    kind: 'sales_agent',
    table: 'sales_agents',
    hasLogin: false,
    singular: 'sales agent',
    plural: 'sales agents',
    title: 'Sales Agent',
    titlePlural: 'Sales Agents',
  },
}

const SALES_AGENTS_MISSING =
  'The sales_agents table is not set up yet — run supabase/migrations/20261016_create_sales_agents.sql in the Supabase SQL Editor.'

/**
 * One table's accounts as { id, authUserId, email, name }, A–Z. `authUserId` is a
 * broker's app login (null for sales agents, who have none). A table that
 * cannot be read (not made yet) gives none.
 */
async function accountNames(table) {
  try {
    const { data } = unwrap(await supabase.from(table).select('*'))
    return data
      .map((row) => ({
        id: row.id,
        authUserId: row.auth_user_id ?? null,
        email: text(row.email),
        name: `${text(row.first_name).trim()} ${text(row.last_name).trim()}`.trim(),
      }))
      .filter((account) => account.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    console.error(`[${table}] no names:`, err)
    return []
  }
}

/**
 * Every broker's and sales agent's full name, A–Z, with their id: the choices
 * for who sold a lot. The name is stored in the lot's `sold_by` as written here,
 * so the sale is credited to the account. Resolves { brokers, salesAgents,
 * names }, the first two as [{ id, name }]. Never throws: failures resolve empty.
 */
export async function fetchBrokerNames() {
  if (!supabase) return { brokers: [], salesAgents: [], names: [] }
  const [brokers, salesAgents] = await Promise.all([accountNames('brokers'), accountNames('sales_agents')])
  return { brokers, salesAgents, names: [...new Set([...brokers, ...salesAgents].map((account) => account.name))] }
}

fetchBrokerNames.tables = () => ['brokers', 'sales_agents']

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
 * One kind's accounts (`query.kind`, 'broker' by default), newest first, each
 * with `lotsSold` and `totalTcp`: the sold lots whose `sold_by` names them.
 * Resolves { accounts, source }. Never throws: failures resolve empty with a `source`.
 */
export async function fetchAccounts({ kind = 'broker' } = {}) {
  if (!supabase) return { accounts: [], source: SOURCE.NOT_CONFIGURED }
  const { table } = ACCOUNT_KINDS[kind]

  try {
    const [{ data }, sales] = await Promise.all([
      supabase
        .from(table)
        .select('id, first_name, last_name, mobile_number, email, created_at')
        .order('created_at', { ascending: false })
        .then(unwrap),
      // Brokers are credited by a lot's Sold By; sales agents by its separate sales agent.
      fetchSoldLots(kind === 'sales_agent' ? 'sales_agent' : 'sold_by'),
    ])
    const people = data.map(normalize)
    const stats = creditSales(people, sales)
    const accounts = people.map((account) => ({
      ...account,
      lotsSold: stats.get(account.id)?.lotsSold ?? 0,
      totalTcp: stats.get(account.id)?.totalTcp ?? 0,
    }))
    return { accounts, source: SOURCE.DATABASE }
  } catch (err) {
    console.error(`[${table}] falling back to an empty list:`, err)
    return { accounts: [], source: SOURCE.UNAVAILABLE }
  }
}

/** The tables fetchAccounts reads, so its Refresh button knows what to check. */
fetchAccounts.tables = ({ kind = 'broker' } = {}) => [ACCOUNT_KINDS[kind].table, ...Object.values(LOT_TABLES)]

/** Brokers only, as { brokers, source }. */
export async function fetchBrokers() {
  const { accounts, source } = await fetchAccounts({ kind: 'broker' })
  return { brokers: accounts, source }
}

fetchBrokers.tables = () => fetchAccounts.tables({ kind: 'broker' })

/**
 * Add a broker or a sales agent. A broker gets their app login and row as one
 * step from the create-broker function, which emails the sign-in details and
 * resolves { id, authUserId, email, password } — `password` is returned only
 * here, so show it now. A sales agent is just a row, resolving { id, email }.
 * Throws with a readable message on failure.
 */
export async function createAccount(kind, form) {
  if (ACCOUNT_KINDS[kind].hasLogin) return invoke('create-broker', cleanBroker(form))
  if (!supabase) throw new Error('No database connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  const agent = cleanBroker(form)
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('sales_agents')
    .insert({
      first_name: agent.firstName,
      last_name: agent.lastName,
      mobile_number: agent.mobileNumber,
      email: agent.email,
      user_id: auth?.user?.id ?? null,
    })
    .select('id, email')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error(`A sales agent with the email ${agent.email} already exists.`)
    if (/sales_agents|row-level security/i.test(error.message)) throw new Error(SALES_AGENTS_MISSING)
    throw new Error(error.message)
  }
  return data
}

/**
 * Remove a broker or a sales agent for good. A broker's app login goes first
 * (the delete-broker function), then their row; a sales agent is just a row.
 * Throws with a readable message on failure.
 */
export async function deleteAccount(kind, id) {
  if (ACCOUNT_KINDS[kind].hasLogin) return invoke('delete-broker', { id })
  if (!supabase) throw new Error('No database connected.')
  const { data, error } = await supabase.from('sales_agents').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  // Row-level security filters a delete it refuses, so nothing comes back.
  if (!data?.length) throw new Error(SALES_AGENTS_MISSING)
}

export const createBroker = (form) => createAccount('broker', form)
export const deleteBroker = (id) => deleteAccount('broker', id)

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
