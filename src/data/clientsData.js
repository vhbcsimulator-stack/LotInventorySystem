/*
 * Clients, from the Supabase `clients` table. The portal does not fix its
 * columns: every column the table has is read (`select *`) and the page lays
 * the table out from them, so adding a column in Supabase shows it here without
 * a code change. Bookkeeping columns (ids, owner, updated_at) are left out.
 */
import { SOURCE } from '@/data/api'
import { fetchAllRows, supabase, unwrap } from '@/data/supabase'

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
