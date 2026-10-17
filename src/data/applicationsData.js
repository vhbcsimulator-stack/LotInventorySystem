/*
 * Account applications sent from the mobile app's sign-up form: someone asking
 * for a broker, regular user, or sales agent account. Each is a row in
 * `account_applications` (see supabase/migrations/20261021_create_account_applications.sql):
 * id, first_name, last_name, mobile_number, email, account_type, message, id_picture,
 * status ('pending' | 'approved' | 'rejected'), approved_as, reviewed_by,
 * reviewed_at, created_at, updated_at.
 *
 * The portal never creates an account from an application directly: "Copy to
 * form" opens the chosen kind's create dialog with the details filled in, and
 * the application is marked approved once that account is made.
 */
import { SOURCE, text } from '@/data/api'
import { ACCOUNT_KINDS } from '@/data/brokersData'
import { fetchAllRows, supabase } from '@/data/supabase'

export const APPLICATIONS_TABLE = 'account_applications'

export const APPLICATION_STATUSES = ['pending', 'approved', 'rejected']

/** The page (Sidebar nav key) that creates each kind of account. */
export const ACCOUNT_PAGES = {
  broker: 'brokers',
  regular_user: 'regularUsers',
  sales_agent: 'salesAgents',
}

const MISSING =
  'The account_applications table is not set up yet — run supabase/migrations/20261021_create_account_applications.sql in the Supabase SQL Editor.'

const kindOrBlank = (value) => (ACCOUNT_KINDS[text(value)] ? text(value) : '')

/** An application row in the page's shape. An unknown account type reads as '' (not stated). */
export function normalizeApplication(row) {
  const status = text(row.status)
  return {
    id: row.id,
    firstName: text(row.first_name).trim(),
    lastName: text(row.last_name).trim(),
    mobileNumber: text(row.mobile_number).trim(),
    email: text(row.email).trim(),
    accountType: kindOrBlank(row.account_type),
    message: text(row.message).trim(),
    // A URL or "bucket/path" — see data/idPictures.js.
    idPicture: text(row.id_picture).trim(),
    status: APPLICATION_STATUSES.includes(status) ? status : 'pending',
    approvedAs: kindOrBlank(row.approved_as),
    reviewedAt: text(row.reviewed_at),
    createdAt: text(row.created_at),
  }
}

/** The account form's fields, filled from an application (the email lower-cased, as accounts store it). */
export function applicationForm(application) {
  return {
    firstName: application.firstName,
    lastName: application.lastName,
    mobileNumber: application.mobileNumber,
    email: application.email.toLowerCase(),
  }
}

/**
 * Every application, newest first. Resolves { applications, source }. Never
 * throws: failures resolve empty with a `source`.
 */
export async function fetchApplications() {
  if (!supabase) return { applications: [], source: SOURCE.NOT_CONFIGURED }
  try {
    const rows = await fetchAllRows(APPLICATIONS_TABLE, '*', (query) => query.order('created_at', { ascending: false }))
    return { applications: rows.map(normalizeApplication), source: SOURCE.DATABASE }
  } catch (err) {
    console.error(`[${APPLICATIONS_TABLE}] falling back to an empty list:`, err)
    return { applications: [], source: SOURCE.UNAVAILABLE }
  }
}

fetchApplications.tables = () => [APPLICATIONS_TABLE]

/**
 * Move an application to `status`. `approvedAs` records which kind of account
 * was made for it. Throws with a readable message on failure.
 */
export async function setApplicationStatus(id, status, approvedAs = null) {
  if (!supabase) throw new Error('No database connected.')
  const { data: auth } = await supabase.auth.getUser()
  const reviewed = status !== 'pending'
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(APPLICATIONS_TABLE)
    .update({
      status,
      approved_as: status === 'approved' ? approvedAs : null,
      reviewed_by: reviewed ? auth?.user?.id ?? null : null,
      reviewed_at: reviewed ? now : null,
      updated_at: now,
    })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(/account_applications/i.test(error.message) ? MISSING : error.message)
  // Row-level security filters an update it refuses, so nothing comes back.
  if (!data?.length) throw new Error('That application could not be changed — it may have been removed.')
}

/** Remove an application for good. Throws with a readable message on failure. */
export async function deleteApplication(id) {
  if (!supabase) throw new Error('No database connected.')
  const { data, error } = await supabase.from(APPLICATIONS_TABLE).delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('That application could not be removed — it may have been removed already.')
}
