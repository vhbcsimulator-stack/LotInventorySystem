/*
 * Clients, from the Supabase `clients` table. The portal does not fix its
 * columns: every column the table has is read (`select *`) and the page lays
 * the table out from them, so adding a column in Supabase shows it here without
 * a code change. Bookkeeping columns (ids, owner, updated_at) are left out.
 */
import { SOURCE } from '@/data/api'
import { fetchAllRows, supabase, unwrap } from '@/data/supabase'
import { formatPeso } from '@/utils/format'

export const CLIENTS_TABLE = 'clients'

// Columns that identify or track a row rather than describe the client.
const HIDDEN = /^(id|uuid|user_id|auth_user_id|owner_id|created_by|updated_by|updated_at|deleted_at)$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A column name as a heading: "payment_type" -> "Payment Type", "cts_doas" -> "CTS/DOAS". */
export function columnLabel(key) {
  if (/^cts_?doas$/i.test(key)) return 'CTS/DOAS'
  if (/^created_at$/i.test(key)) return 'Date Added'
  return key
    .replace(/_/g, ' ')
    .replace(/\b(tcp|id|cts|doas|sqm)\b/gi, (word) => word.toUpperCase())
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

/**
 * The columns to show, in the table's own order (as the first rows list them),
 * with created_at moved to the end.
 */
function visibleColumns(rows) {
  const keys = []
  rows.slice(0, 50).forEach((row) => Object.keys(row).forEach((key) => !keys.includes(key) && keys.push(key)))
  // A link to another row (broker_id holding a UUID) means nothing to a reader;
  // the name beside it (broker_name) is what the table shows instead.
  const isUuidLink = (key) => /_id$/i.test(key) && rows.some((row) => UUID.test(String(row[key] ?? '')))
  const shown = keys.filter((key) => !HIDDEN.test(key) && !isUuidLink(key))
  const created = shown.filter((key) => /^created_at$/i.test(key))
  return [...shown.filter((key) => !created.includes(key)), ...created]
}

/**
 * Every client row, newest first when the table has created_at. Resolves
 * { clients, columns, source }, where `columns` is [{ key, label }]. Never
 * throws: failures resolve empty with a `source` and the database's message.
 */
export async function fetchClients() {
  if (!supabase) return { clients: [], columns: [], source: SOURCE.NOT_CONFIGURED }

  try {
    /*
     * Newest first, paged past the 1000-row cap. fetchAllRows also orders by
     * `id`, so a table without created_at or id falls back step by step; the
     * last step is one unordered read of up to 1000 rows.
     */
    const attempts = [
      () => fetchAllRows(CLIENTS_TABLE, '*', (query) => query.order('created_at', { ascending: false })),
      () => fetchAllRows(CLIENTS_TABLE, '*'),
      async () => unwrap(await supabase.from(CLIENTS_TABLE).select('*').limit(1000)).data,
    ]
    let rows
    for (const [index, attempt] of attempts.entries()) {
      try {
        rows = await attempt()
        break
      } catch (err) {
        if (index === attempts.length - 1 || !/created_at|\bid\b/.test(err.message)) throw err
      }
    }
    const clients = rows.map((row, index) => ({ ...row, _key: String(row.id ?? row.uuid ?? index) }))
    const columns = visibleColumns(rows).map((key) => ({ key, label: columnLabel(key) }))
    return { clients, columns, source: SOURCE.DATABASE }
  } catch (err) {
    console.error('[clients] falling back to an empty list:', err)
    return { clients: [], columns: [], source: SOURCE.UNAVAILABLE, error: err.message }
  }
}

/** The tables fetchClients reads, so its Refresh button knows what to check. */
fetchClients.tables = () => [CLIENTS_TABLE]

/**
 * Who a sold lot can be sold to: every client, A–Z, as { clients: [{ id, name,
 * phone, projectCode }] }. Never throws: failures resolve empty.
 */
export async function fetchClientChoices() {
  if (!supabase) return { clients: [] }
  try {
    const rows = await fetchAllRows(CLIENTS_TABLE, '*')
    const clients = rows
      .map((row) => ({ id: row.id, name: String(row.name ?? '').trim(), phone: String(row.phone ?? ''), projectCode: String(row.project_code ?? '') }))
      .filter((client) => client.name)
      .sort((a, b) => a.name.localeCompare(b.name))
    return { clients }
  } catch (err) {
    console.error('[clients] no client choices:', err)
    return { clients: [] }
  }
}

fetchClientChoices.tables = () => [CLIENTS_TABLE]

/** A client's stage, as stored (lower case, like the app's) and as shown. */
export const CLIENT_STAGE_OPTIONS = [
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'cold', label: 'Cold' },
  { value: 'closed', label: 'Closed' },
]

/**
 * The subtitle of a client added here. The app writes its own ("Registered
 * Lead • ERHD Inquirer"); this one marks the client as entered in the portal.
 */
export const portalSubtitle = (projectCode) => ['Portal Exclusive', String(projectCode ?? '').trim()].filter(Boolean).join(' • ')

/**
 * The fields a new client is entered with, in the order the form shows them,
 * as the `clients` table names them. `required` ones must be filled; the rest
 * may be left blank (stored as null). The subtitle, last activity, and TCP
 * (from the lot, when there is one) are set by createClient; the avatar, status note, tag note, and hold subtitle are left to the app.
 */
export const NEW_CLIENT_FIELDS = [
  { key: 'broker_name', label: 'Broker Name', required: true },
  { key: 'name', label: 'Name', required: true },
  { key: 'phone', label: 'Phone', required: true, type: 'tel' },
  { key: 'stage', label: 'Stage', required: true, options: CLIENT_STAGE_OPTIONS },
  { key: 'project_code', label: 'Project Code', required: true },
  { key: 'notes', label: 'Notes', multiline: true },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'is_vip', label: 'Is VIP', checkbox: true },
  { key: 'vip_tag', label: 'VIP Tag' },
  { key: 'unit_description', label: 'Unit Description', required: true, placeholder: 'ERHD Development Unit' },
]

/** Field-by-field problems with a new client form, keyed like it. Empty when it can be saved. */
export function validateClient(form) {
  const errors = {}
  NEW_CLIENT_FIELDS.forEach((field) => {
    if (field.required && !String(form[field.key] ?? '').trim()) errors[field.key] = `Enter the ${field.label.toLowerCase()}.`
  })
  const stage = String(form.stage ?? '')
  if (stage && !CLIENT_STAGE_OPTIONS.some((option) => option.value === stage)) errors.stage = 'Choose a stage.'
  const email = String(form.email ?? '').trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.'
  return errors
}

const CLIENT_UPDATE_MISSING =
  'The portal may not update clients yet — run supabase/migrations/20261014_portal_update_clients.sql in the Supabase SQL Editor.'

/** A client's Unit Description for a lot: its project and identifier, then its status — "MVLC B27 L1 · Reserved". */
export function unitDescription(projectCode, lotNo, statusLabel) {
  const unit = [projectCode, lotNo].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ')
  return [unit, String(statusLabel ?? '').trim()].filter(Boolean).join(' · ')
}

/**
 * Keep every client whose Unit Description names a lot ("MVLC B27 L1", or
 * "MVLC B27 L1 · <old status>") in step with the lot's new status. Run after
 * each status change; a lot no client names changes nothing.
 */
export async function relabelClientsForLot({ projectCode, lotNo, statusLabel }) {
  if (!supabase) return
  const unit = unitDescription(projectCode, lotNo, '')
  if (!unit) return
  const row = { unit_description: unitDescription(projectCode, lotNo, statusLabel) }
  // The identifier is matched literally: % and _ in it are not wildcards.
  const prefix = `${unit.replace(/[\\%_]/g, (char) => `\\${char}`)} · %`
  const [exact, labelled] = await Promise.all([
    supabase.from(CLIENTS_TABLE).update(row).eq('unit_description', unit),
    supabase.from(CLIENTS_TABLE).update(row).like('unit_description', prefix),
  ])
  const error = exact.error ?? labelled.error
  if (error) throw new Error(/row-level security/i.test(error.message) ? CLIENT_UPDATE_MISSING : error.message)
}

/**
 * Point a client's record at the lot they reserved or bought: its stage
 * ('reserved' or 'closed'), project, unit description ("MVLC B27 L1 · Sold"),
 * and TCP (when known). Throws with a readable message when the row is not updated.
 */
export async function updateClientForLot(id, { stage, projectCode, lotNo, total, statusLabel }) {
  if (!supabase) throw new Error('No database connected.')
  const row = {
    stage,
    project_code: projectCode,
    unit_description: unitDescription(projectCode, lotNo, statusLabel ?? (stage === 'closed' ? 'Sold' : 'Reserved')),
    ...(Number(total) > 0 ? { tcp_formatted: formatPeso(Number(total)) } : {}),
  }
  const { data, error } = await supabase.from(CLIENTS_TABLE).update(row).eq('id', id).select('id')
  if (error) throw new Error(/row-level security/i.test(error.message) ? CLIENT_UPDATE_MISSING : error.message)
  // Row-level security filters an update it refuses rather than failing it.
  if (!data?.length) throw new Error(CLIENT_UPDATE_MISSING)
}

/**
 * Save edits to a client: the fields of NEW_CLIENT_FIELDS (blanks stored as
 * null) and `broker_id`. Other columns — subtitle, status and tag notes, last
 * activity, avatar — are left as they are. Resolves the saved row; throws with a readable message.
 */
export async function updateClient(id, form) {
  if (!supabase) throw new Error('No database connected.')
  const row = { broker_id: form.broker_id ?? null }
  NEW_CLIENT_FIELDS.forEach((field) => {
    row[field.key] = field.checkbox ? Boolean(form[field.key]) : String(form[field.key] ?? '').trim() || null
  })
  const { data, error } = await supabase.from(CLIENTS_TABLE).update(row).eq('id', id).select()
  if (error) throw new Error(/row-level security/i.test(error.message) ? CLIENT_UPDATE_MISSING : error.message)
  // Row-level security filters an update it refuses, so no row comes back.
  if (!data?.length) throw new Error(CLIENT_UPDATE_MISSING)
  return data[0]
}

/** Permanently delete a client. Throws with a readable message on failure. */
export async function deleteClient(id) {
  if (!supabase) throw new Error('No database connected.')
  const { data, error } = await supabase.from(CLIENTS_TABLE).delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) {
    throw new Error('The portal may not delete clients yet — run supabase/migrations/20261015_portal_delete_clients.sql in the Supabase SQL Editor.')
  }
}

/**
 * Add a client. `form` is keyed like NEW_CLIENT_FIELDS, plus `broker_id` (the
 * broker account the client belongs to, or null for an agent without one).
 * Resolves the saved row; throws with a readable message on failure.
 */
export async function createClient(form) {
  if (!supabase) throw new Error('No database connected.')
  const row = { broker_id: form.broker_id ?? null, subtitle: portalSubtitle(form.project_code), last_activity_text: 'Created just now' }
  // Not on the form: the lot's TCP when the client is added from a lot, else left for the app.
  const tcp = String(form.tcp_formatted ?? '').trim()
  if (tcp) row.tcp_formatted = tcp
  NEW_CLIENT_FIELDS.forEach((field) => {
    row[field.key] = field.checkbox ? Boolean(form[field.key]) : String(form[field.key] ?? '').trim() || null
  })
  const { data, error } = await supabase.from(CLIENTS_TABLE).insert(row).select().single()
  if (error) {
    if (/row-level security/i.test(error.message)) {
      throw new Error('The portal may not add clients yet — run supabase/migrations/20261013_portal_insert_clients.sql in the Supabase SQL Editor.')
    }
    throw new Error(error.message)
  }
  return data
}
