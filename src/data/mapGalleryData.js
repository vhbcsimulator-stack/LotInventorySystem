/*
 * The public map gallery's maps, from the map-gallery Edge Function
 * (supabase/functions/map-gallery). The function checks the gallery password,
 * so nobody without it gets the list, and the password is not in this code.
 */
import { supabase } from './supabase'

/** Thrown for a wrong password, so the page can ask again rather than show an error. */
export class WrongPasswordError extends Error {}

/**
 * Every current map as [{ id, projectCode, projectName, label, url, updatedAt }],
 * sorted by project and then phase. Throws WrongPasswordError for a wrong password.
 */
export async function fetchGalleryMaps(password) {
  if (!supabase) throw new Error('No database connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  const { data, error } = await supabase.functions.invoke('map-gallery', { body: { password } })
  if (!error) return data?.maps ?? []

  const status = error.context?.status
  const message = await error.context?.json?.().then((reply) => reply?.error, () => '')
  if (status === 401) throw new WrongPasswordError(message || 'That password is not right.')
  if (message) throw new Error(message)
  if (error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError') {
    throw new Error('Could not reach the map gallery. Check your connection and try again.')
  }
  throw new Error(error.message)
}
