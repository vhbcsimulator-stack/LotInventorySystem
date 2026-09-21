/*
 * Development photo galleries from the Supabase `project_dev` (Project
 * Development) and `future_dev` (Future Development Updates) tables. Both have
 * the same columns: id, created_at, image_link (public Storage URL), user_id,
 * and project_name (e.g. "MVLC" or "MSCC - paused").
 *
 * Files live in each gallery's bucket at <user_id>/<PROJECT_CODE>/<timestamp>_<random>_<filename>.
 */
import { SOURCE, text } from './api'
import { fetchAllRows, supabase } from './supabase'

export const DEV_GALLERIES = {
  'project-dev': { table: 'project_dev', bucket: 'project_deve_updates', title: 'Project Development' },
  'future-dev': { table: 'future_dev', bucket: 'future_dev', title: 'Future Development Updates' },
  // Created by supabase/migrations/20260915_create_flyers.sql.
  flyers: { table: 'flyers', bucket: 'flyers', title: 'Flyers Pictures' },
}

/**
 * Every image for one project in one gallery, newest first, as
 * [{ id, url, createdAt }], plus the stored `projectLabel` (e.g. "MSCC - paused")
 * so new rows match existing ones. Never throws: failures resolve empty with a `source`.
 */
export async function fetchDevImages({ gallery, projectCode } = {}) {
  const config = DEV_GALLERIES[gallery]
  const empty = (source) => ({ images: [], projectLabel: '', source })
  if (!supabase) return empty(SOURCE.NOT_CONFIGURED)
  if (!config || !projectCode) return empty(SOURCE.DATABASE)

  try {
    const rows = await fetchAllRows(config.table, 'id, created_at, image_link, project_name', (query) =>
      query.ilike('project_name', `${projectCode}%`).order('created_at', { ascending: false }),
    )
    const images = rows
      .map((row) => ({ id: row.id, url: text(row.image_link), createdAt: text(row.created_at) }))
      .filter((image) => image.url)
    return { images, projectLabel: text(rows[0]?.project_name), source: SOURCE.DATABASE }
  } catch (err) {
    console.error(`[${config.table}] falling back to no images:`, err)
    return empty(SOURCE.UNAVAILABLE)
  }
}

function configFor(gallery) {
  if (!supabase) throw new Error('No database connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  const config = DEV_GALLERIES[gallery]
  if (!config) throw new Error(`Unknown gallery "${gallery}".`)
  return config
}

async function requireUser() {
  const { data } = await supabase.auth.getUser()
  if (!data?.user) throw new Error('Sign in to change images.')
  return data.user
}

function requireImageFile(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Choose an image file (PNG, JPG or WebP).')
}

/** Bucket and object path from a public Storage URL, or null if it is not one. */
function storageObjectOf(url) {
  const match = /\/storage\/v1\/object\/public\/([^/]+)\/([^?#]+)/.exec(text(url))
  return match ? { bucket: match[1], path: decodeURIComponent(match[2]) } : null
}

/**
 * Upload one image to the gallery's bucket and add its table row. If the row
 * cannot be added, the uploaded file is removed so no orphan is left behind.
 */
export async function uploadDevImage({ gallery, projectCode, projectLabel, file }) {
  const config = configFor(gallery)
  if (!projectCode) throw new Error('Choose a project first.')
  requireImageFile(file)
  const user = await requireUser()

  const bucket = supabase.storage.from(config.bucket)
  const safeName = file.name.replace(/[^\w.-]+/g, '_')
  const random = Math.random().toString(36).slice(2, 13)
  const path = `${user.id}/${projectCode}/${Date.now()}_${random}_${safeName}`

  const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type })
  if (uploadError) throw new Error(`Upload to the "${config.bucket}" bucket failed: ${uploadError.message}`)

  const { data, error } = await supabase
    .from(config.table)
    .insert({ image_link: bucket.getPublicUrl(path).data.publicUrl, user_id: user.id, project_name: projectLabel || projectCode })
    .select('id')
  if (error || !data?.length) {
    await bucket.remove([path])
    throw new Error(error?.message ?? 'The database did not accept the new image — you may need to sign in.')
  }
}

/**
 * Delete an image from both the bucket and the table. The file is removed
 * first; the row is only deleted once that succeeds, so a failure never leaves
 * a row pointing at a missing file.
 */
export async function deleteDevImage({ gallery, image }) {
  const config = configFor(gallery)
  await requireUser()

  const object = storageObjectOf(image.url)
  if (object) {
    const { data: removed, error } = await supabase.storage.from(object.bucket).remove([object.path])
    if (error) throw new Error(`Could not delete the file from the "${object.bucket}" bucket: ${error.message}`)
    // Storage reports success with an empty list when policies block the delete;
    // only treat that as fine if the file is really gone.
    if (!removed?.length) {
      const folder = object.path.split('/').slice(0, -1).join('/')
      const name = object.path.split('/').pop()
      const { data: still } = await supabase.storage.from(object.bucket).list(folder, { search: name })
      if (still?.some((item) => item.name === name)) {
        throw new Error(`The "${object.bucket}" bucket refused to delete the file — check its storage policies.`)
      }
    }
  }

  const { data, error } = await supabase.from(config.table).delete().eq('id', image.id).select('id')
  if (error) throw new Error(`The file was deleted, but its row could not be removed: ${error.message}`)
  if (!data?.length) throw new Error('The file was deleted, but the database did not remove its row — check the table policies.')
}

/**
 * Replace an image: the previous image is deleted from the bucket and the table
 * first, then the new one is uploaded and added. The new file and sign-in are
 * checked up front so an invalid choice never deletes the old image.
 */
export async function replaceDevImage({ gallery, projectCode, projectLabel, image, file }) {
  configFor(gallery)
  requireImageFile(file)
  await requireUser()

  await deleteDevImage({ gallery, image })
  try {
    await uploadDevImage({ gallery, projectCode, projectLabel, file })
  } catch (err) {
    throw new Error(`The previous image was deleted, but the new one could not be saved: ${err.message}`, { cause: err })
  }
}
