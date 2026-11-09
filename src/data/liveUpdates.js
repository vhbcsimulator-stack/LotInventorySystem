/*
 * Live updates: one Supabase Realtime subscription to every table in the
 * public schema. When a row is inserted, updated, or deleted — by this portal,
 * another staff member, the app, or the SQL editor — the cached results read
 * from that table are refetched, so open pages update without a reload.
 *
 * Only tables in the supabase_realtime publication send changes
 * (supabase/migrations/20261107_enable_realtime_all_tables.sql adds them all),
 * and row-level security still decides which changes a user is told about.
 */
import { invalidateAll, invalidateTables } from './queryClient'
import { supabase } from './supabase'

// Changes arriving this close together (a bulk import, a multi-row save) are refetched once.
const BATCH_MS = 400

let channelCount = 0

/** Start listening; returns the stop function. */
export function startLiveUpdates() {
  if (!supabase) return () => {}

  const pending = new Set()
  let timer = null
  let connectedBefore = false

  const flush = () => {
    timer = null
    const tables = [...pending]
    pending.clear()
    invalidateTables(tables)
  }

  const channel = supabase
    .channel(`live-updates-${++channelCount}`)
    .on('postgres_changes', { event: '*', schema: 'public' }, ({ table }) => {
      if (!table) return
      pending.add(table)
      timer ??= setTimeout(flush, BATCH_MS)
    })
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      // Back after a dropped connection (sleep, network loss): changes made
      // meanwhile were never sent, so refetch what is on screen.
      if (connectedBefore) invalidateAll()
      connectedBefore = true
    })

  return () => {
    clearTimeout(timer)
    supabase.removeChannel(channel)
  }
}
