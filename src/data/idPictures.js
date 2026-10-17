/*
 * ID pictures: the photo of a government ID an applicant sends from the app
 * (`account_applications.id_picture`), kept on the broker made from it
 * (`brokers.id_picture`). The column holds either a full image URL or a
 * Storage location written as "bucket/path/to/file.jpg".
 */
import { supabase } from '@/data/supabase'

// Long enough to look at the picture; a reopened profile asks for a fresh link.
const SIGNED_URL_SECONDS = 60 * 60

/**
 * A URL the browser can show for a stored ID picture, or null when there is
 * none or it cannot be reached. A URL is used as is; a "bucket/path" gets a
 * signed link, so it works for private buckets too.
 */
export async function idPictureUrl(value) {
  const stored = String(value ?? '').trim()
  if (!stored) return null
  if (/^(https?:|data:image\/)/i.test(stored)) return stored
  if (!supabase) return null

  const [bucket, ...rest] = stored.replace(/^\/+/, '').split('/')
  const path = rest.join('/')
  if (!bucket || !path) return null
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS)
  if (error) {
    console.error(`[id picture] no link for ${stored}:`, error)
    return null
  }
  return data.signedUrl
}
