import { SOURCE, text } from './api'
import { supabase, unwrap } from './supabase'
import { checkUpload } from '@/lib/uploadRules'

const BUCKET = 'future-projects'

const toProject = (row) => ({
  id: row.id,
  projectCode: text(row.project_code),
  name: text(row.name),
  location: text(row.location),
  description: text(row.description),
  imageUrl: text(row.image_url),
  storagePath: text(row.storage_path),
  updatedAt: text(row.updated_at),
})

export async function fetchFutureProjects() {
  const empty = (source, message = '') => ({ projects: [], source, message })
  if (!supabase) return empty(SOURCE.NOT_CONFIGURED)
  try {
    const { data } = unwrap(await supabase
      .from('future_projects')
      .select('id, project_code, name, location, description, image_url, storage_path, updated_at')
      .order('updated_at', { ascending: false }))
    return { projects: data.map(toProject), source: SOURCE.DATABASE }
  } catch (err) {
    console.error('[future projects] could not load:', err)
    return empty(SOURCE.UNAVAILABLE, err.message)
  }
}

async function requireUser() {
  if (!supabase) throw new Error('No database connected.')
  const { data } = await supabase.auth.getUser()
  if (!data?.user) throw new Error('Sign in to manage future projects.')
  return data.user
}

export async function saveFutureProject({ id, projectCode, name, location, description, file, existing }) {
  const code = text(projectCode).trim()
  const projectName = text(name).trim()
  const place = text(location).trim()
  const details = text(description).trim()
  if (!code || !projectName) throw new Error('Choose a project.')
  if (!place) throw new Error('Enter the project location.')
  if (!existing && !file) throw new Error('Choose a project image.')
  if (file) await checkUpload('photo', file)

  const user = await requireUser()
  const bucket = supabase.storage.from(BUCKET)
  let imageUrl = existing?.imageUrl ?? ''
  let storagePath = existing?.storagePath ?? ''
  let newPath = ''

  if (file) {
    const safeName = file.name.replace(/[^\w.-]+/g, '_')
    newPath = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 13)}_${safeName}`
    const { error } = await bucket.upload(newPath, file, { contentType: file.type })
    if (error) throw new Error(`Image upload failed: ${error.message}`)
    imageUrl = bucket.getPublicUrl(newPath).data.publicUrl
    storagePath = newPath
  }

  const fields = {
    project_code: code,
    name: projectName,
    location: place,
    description: details || null,
    image_url: imageUrl,
    storage_path: storagePath,
    user_id: user.id,
    updated_at: new Date().toISOString(),
  }
  const result = existing
    ? await supabase.from('future_projects').update(fields).eq('id', id).select('id')
    : await supabase.from('future_projects').insert(fields).select('id')

  if (result.error || !result.data?.length) {
    if (newPath) await bucket.remove([newPath])
    throw new Error(result.error?.message ?? 'The future project could not be saved.')
  }
  if (newPath && existing?.storagePath && existing.storagePath !== newPath) {
    const { error } = await bucket.remove([existing.storagePath])
    if (error) throw new Error(`The project was saved, but its old image could not be removed: ${error.message}`)
  }
}

export async function deleteFutureProject(project) {
  await requireUser()
  const { data, error } = await supabase.from('future_projects').delete().eq('id', project.id).select('id')
  if (error || !data?.length) throw new Error(error?.message ?? 'The future project could not be removed.')
  if (project.storagePath) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([project.storagePath])
    if (removeError) throw new Error(`The project was removed, but its image could not be deleted: ${removeError.message}`)
  }
}

/** The tables fetchFutureProjects reads, so its Refresh button knows what to check. */
fetchFutureProjects.tables = () => ['future_projects']
