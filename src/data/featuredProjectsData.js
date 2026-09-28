import { SOURCE, text } from './api'
import { supabase, unwrap } from './supabase'
import { checkUpload } from '@/lib/uploadRules'

const BUCKET = 'featured-projects'

const toFeature = (row) => ({
  projectCode: text(row.project_code),
  location: text(row.location),
  imageUrl: text(row.image_url),
  storagePath: text(row.storage_path),
  updatedAt: text(row.updated_at),
})

export async function fetchFeaturedProjects() {
  const empty = (source) => ({ feature: null, source })
  if (!supabase) return empty(SOURCE.NOT_CONFIGURED)

  try {
    const { data } = unwrap(await supabase
      .from('featured_projects')
      .select('project_code, location, image_url, storage_path, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1))
    return { feature: data[0] ? toFeature(data[0]) : null, source: SOURCE.DATABASE }
  } catch (err) {
    console.error('[featured projects] could not load featured projects:', err)
    return empty(SOURCE.UNAVAILABLE)
  }
}

async function requireUser() {
  if (!supabase) throw new Error('No database connected.')
  const { data } = await supabase.auth.getUser()
  if (!data?.user) throw new Error('Sign in to change featured projects.')
  return data.user
}

/** Save the sole featured project. Changing projects requires a new image. */
export async function saveFeaturedProject({ projectCode, location, file, existing = null }) {
  const code = text(projectCode).trim()
  const place = text(location).trim()
  if (!code) throw new Error('Choose a project to feature.')
  if (!place) throw new Error('Enter the project location.')
  if ((!existing || existing.projectCode !== code) && !file) throw new Error('Choose an image for this project.')
  if (file) await checkUpload('photo', file)

  const user = await requireUser()
  const bucket = supabase.storage.from(BUCKET)
  let storagePath = existing?.storagePath ?? ''
  let imageUrl = existing?.imageUrl ?? ''
  let newPath = ''

  if (file) {
    const safeName = file.name.replace(/[^\w.-]+/g, '_')
    newPath = `${user.id}/${code}/${Date.now()}_${Math.random().toString(36).slice(2, 13)}_${safeName}`
    const { error } = await bucket.upload(newPath, file, { contentType: file.type })
    if (error) throw new Error(`Image upload failed: ${error.message}`)
    storagePath = newPath
    imageUrl = bucket.getPublicUrl(newPath).data.publicUrl
  }

  const fields = { project_code: code, location: place, image_url: imageUrl, storage_path: storagePath, user_id: user.id, updated_at: new Date().toISOString() }
  const result = existing
    ? await supabase.from('featured_projects').update(fields).eq('project_code', existing.projectCode).select('project_code')
    : await supabase.from('featured_projects').insert(fields).select('project_code')

  if (result.error || !result.data?.length) {
    if (newPath) await bucket.remove([newPath])
    throw new Error(result.error?.message ?? 'The database did not save this featured project.')
  }

  if (newPath && existing?.storagePath && existing.storagePath !== newPath) {
    const { error } = await bucket.remove([existing.storagePath])
    if (error) throw new Error(`The feature was saved, but its old image could not be removed: ${error.message}`)
  }
}

/** Remove the feature row, then its image. A failed file cleanup never leaves a broken row. */
export async function deleteFeaturedProject(feature) {
  await requireUser()
  const { data, error } = await supabase.from('featured_projects')
    .delete().eq('project_code', feature.projectCode).select('project_code')
  if (error || !data?.length) throw new Error(error?.message ?? 'The database did not remove this featured project.')
  if (feature.storagePath) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([feature.storagePath])
    if (removeError) throw new Error(`The feature was removed, but its image could not be deleted: ${removeError.message}`)
  }
}

/** The tables fetchFeaturedProjects reads, so its Refresh button knows what to check. */
fetchFeaturedProjects.tables = () => ['featured_projects']
