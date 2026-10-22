/*
 * The portal_controls table: what the Developer Controls page has shown, hidden,
 * or put under maintenance (see lib/portalControls.js and
 * supabase/migrations/20261022_create_portal_controls.sql).
 */
import { queryClient } from './queryClient'
import { supabase } from './supabase'

export const PORTAL_CONTROLS_MIGRATION = 'supabase/migrations/20261022_create_portal_controls.sql'

export const PORTAL_CONTROLS_KEY = ['portal-controls']

/** Re-read the controls now — after a save, or when realtime reports a change. */
export function reloadPortalControls() {
  return queryClient.invalidateQueries({ queryKey: PORTAL_CONTROLS_KEY })
}

/**
 * id -> { state, message, updated_by, updated_at }. Resolves to {} — everything
 * visible — when no database is connected or the table is not made yet, so a
 * missing migration never locks anyone out.
 */
export async function fetchPortalControls() {
  if (!supabase) return {}
  const { data, error } = await supabase.from('portal_controls').select('id, state, message, updated_by, updated_at')
  if (error) {
    console.warn('[portal controls] not loaded, showing everything:', error.message)
    return {}
  }
  return Object.fromEntries((data ?? []).map((row) => [row.id, row]))
}

/** Save one control. Only developer logins may; anyone else is refused by row-level security. */
export async function savePortalControl(id, { state, message = '' }, user) {
  if (!supabase) throw new Error('No database connected.')
  const { error } = await supabase.from('portal_controls').upsert({
    id,
    state,
    message: message.trim(),
    updated_by: user?.email ?? null,
    updated_at: new Date().toISOString(),
  })
  if (!error) return
  if (/portal_controls/.test(error.message) && /(does not exist|schema cache)/.test(error.message)) {
    throw new Error(`The portal_controls table is not set up yet — run ${PORTAL_CONTROLS_MIGRATION} in the Supabase SQL Editor.`)
  }
  if (/row-level security/i.test(error.message)) {
    throw new Error('Only developer accounts can change portal controls. Sign out and back in if your role was just granted.')
  }
  throw new Error(error.message)
}

/** Call `onChange` whenever any portal control changes; returns the unsubscribe. */
export function subscribePortalControls(onChange) {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('portal-controls')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_controls' }, onChange)
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
