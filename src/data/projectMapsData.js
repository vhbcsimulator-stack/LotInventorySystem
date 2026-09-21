/*
 * Project maps from the Supabase `uploads` table. A map row has kind = 'map'
 * and current = true; `project` starts with the project code (e.g.
 * "MSCC - paused"), `Phase` is null for a whole-site map, and `type` is
 * 'commercial' for commercial maps. `image_URL` is a public Storage link into
 * the project's bucket (the lowercase code, e.g. `mvlc`).
 */
import { SOURCE, num, text } from './api'
import { supabase, unwrap } from './supabase'

function toMap(row) {
  const phase = typeof row.Phase === 'number' ? row.Phase : num(row.Phase, NaN)
  return {
    id: row.id,
    url: text(row.image_URL),
    name: text(row.name),
    phase: Number.isFinite(phase) ? phase : null,
    commercial: text(row.type).toLowerCase() === 'commercial',
    projectId: row.project_id ?? null,
    phaseId: row.phase_id ?? null,
    projectLabel: text(row.project),
    storagePath: text(row.storage_path),
  }
}

/**
 * The path inside the project bucket for a map, from its `storage_path` or,
 * for older rows that have none, from the public URL it was given:
 * `.../object/public/<bucket>/<path>`.
 */
function pathInBucket(map, bucketName) {
  if (map.storagePath) return map.storagePath
  const marker = `/object/public/${bucketName}/`
  const at = (map.url || '').indexOf(marker)
  if (at === -1) return ''
  return decodeURIComponent(map.url.slice(at + marker.length).split('?')[0])
}

/** Maps occupying the same slot (whole / phase N / commercial phase N) as `target`. */
export const sameSlot = (map, target) => map.commercial === target.commercial && map.phase === target.phase

/**
 * MSCC is a condominium: its maps are floor plans, so its tabs read "Floor N"
 * and it has no whole-site map. Every other project is a subdivision laid out
 * in phases, with a Whole Map tab.
 */
export const usesFloors = (projectCode) => /^mscc/i.test(projectCode ?? '')

/**
 * The project's maps grouped into tabs: Whole Map (phase projects only), one
 * tab per phase or floor, and Commercial where the project has commercial maps
 * — as [{ value, label, maps }] — plus the flat `maps` list.
 * Never throws: failures resolve empty and report why via `source`.
 */
export async function fetchProjectMaps({ projectCode } = {}) {
  const empty = (source) => ({ tabs: buildTabs([], projectCode), maps: [], source })
  if (!supabase) return empty(SOURCE.NOT_CONFIGURED)
  if (!projectCode) return empty(SOURCE.DATABASE)

  try {
    const { data } = unwrap(
      await supabase
        .from('uploads')
        .select('id, name, project, project_id, phase_id, Phase, type, image_URL, storage_path, uploaded_at')
        .eq('kind', 'map')
        .eq('current', true)
        .ilike('project', `${projectCode}%`)
        .order('uploaded_at', { ascending: false }),
    )
    const maps = data.map(toMap).filter((map) => map.url)
    return { tabs: buildTabs(maps, projectCode), maps, source: SOURCE.DATABASE }
  } catch (err) {
    console.error('[project maps] falling back to no maps:', err)
    return empty(SOURCE.UNAVAILABLE)
  }
}

function buildTabs(maps, projectCode) {
  const unit = usesFloors(projectCode) ? 'Floor' : 'Phase'
  const withCaption = (map) => ({ ...map, caption: map.phase === null ? '' : `${unit} ${map.phase}` })
  const phases = [...new Set(maps.filter((map) => !map.commercial && map.phase !== null).map((map) => map.phase))].sort(
    (a, b) => a - b,
  )

  const commercial = maps.filter((map) => map.commercial).sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0))

  return [
    // A condominium has no whole-site map; a phased subdivision always shows the tab.
    ...(unit === 'Phase'
      ? [
          {
            value: 'whole',
            label: 'Whole Map',
            maps: maps.filter((map) => !map.commercial && map.phase === null).map(withCaption),
          },
        ]
      : []),
    ...phases.map((phase) => ({
      value: `phase-${phase}`,
      label: `${unit} ${phase}`,
      maps: maps.filter((map) => !map.commercial && map.phase === phase).map(withCaption),
    })),
    /*
     * Only where commercial maps exist, exactly as the phase tabs above work.
     * A project that sells no commercial lots (ERHD) then has no empty tab to
     * click into, and uploading one through "Add map" brings the tab back.
     */
    ...(commercial.length ? [{ value: 'commercial', label: 'Commercial', maps: commercial.map(withCaption) }] : []),
  ]
}

/**
 * The map rows the project already has for one slot, read from the database
 * rather than taken from the caller's list — the list a page is holding can be
 * out of date, or miss a row whose `current` flag or `Phase` does not line up
 * with the tab it was shown under, and a save that went by the list alone then
 * added a second row for a map that was already there. Newest first.
 */
async function slotRows({ projectCode, target }) {
  try {
    const { data } = unwrap(
      await supabase
        .from('uploads')
        .select('id, name, project, project_id, phase_id, Phase, type, image_URL, storage_path, uploaded_at')
        .eq('kind', 'map')
        .ilike('project', `${projectCode}%`)
        .order('uploaded_at', { ascending: false }),
    )
    /*
     * The slot is matched here rather than in the query: `Phase` is numeric, so
     * it can arrive as a string, and a residential map's `type` is 'residential'
     * on newer rows and null on older ones. toMap settles both, and sameSlot
     * then compares the same values the map tabs themselves are built from.
     */
    return data.map(toMap).filter((map) => sameSlot(map, target))
  } catch (err) {
    console.error('[project maps] could not look up the slot before saving:', err)
    return []
  }
}

/** Storage folder for a slot, matching how existing uploads are laid out. */
function folderFor({ phase, commercial }) {
  if (commercial) return phase === null ? 'commercial' : `phase-${phase}-commercial`
  return phase === null ? 'default' : `phase-${phase}`
}

/**
 * Add a map, or replace the map in its slot.
 *
 * Adding inserts a new current `uploads` row. Replacing keeps the slot's own
 * row and points it at the new image instead — no second row is ever created
 * for a map that already exists — and only once that row is saved is the
 * picture it used to hold deleted from the bucket. A failed save therefore
 * leaves the slot exactly as it was, and a replaced map leaves nothing behind.
 *
 * `target` is { phase: number|null, commercial: boolean }; `existing` is the
 * project's current maps (from fetchProjectMaps), used to reuse project_id,
 * phase_id and the project label. `replaceId` is the map being replaced, given
 * by "Replace image": that row is updated whatever the slot lookup makes of it,
 * so replacing never inserts.
 */
export async function saveProjectMap({ projectCode, projectId, target, file, existing = [], replaceId = null }) {
  if (!supabase) throw new Error('No database connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  if (!projectCode) throw new Error('Choose a project first.')
  if (!file?.type?.startsWith('image/')) throw new Error('Choose an image file (PNG, JPG or WebP).')
  if (target.phase !== null && !(Number.isInteger(target.phase) && target.phase > 0)) {
    throw new Error('Phase must be a whole number.')
  }

  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) throw new Error('Sign in to add or change maps.')

  const bucketName = projectCode.toLowerCase()
  const bucket = supabase.storage.from(bucketName)
  const safeName = file.name.replace(/[^\w.-]+/g, '_')
  const random = Math.random().toString(36).slice(2, 13)
  const storagePath = `${user.id}/${projectCode}/${folderFor(target)}/${Date.now()}_${random}_${safeName}`

  const { error: uploadError } = await bucket.upload(storagePath, file, { contentType: file.type })
  if (uploadError) throw new Error(`Image upload to the "${bucketName}" bucket failed: ${uploadError.message}`)
  const imageUrl = bucket.getPublicUrl(storagePath).data.publicUrl

  /*
   * What the slot really holds, asked of the database itself — see slotRows.
   * The caller's `existing` only fills in gaps, so that a row the page knows
   * about is still reused if the lookup could not run.
   */
  const stored = await slotRows({ projectCode, target })
  const fromCaller = existing.filter((map) => sameSlot(map, target))
  const inSlot = [...stored, ...fromCaller.filter((map) => !stored.some((row) => row.id === map.id))]

  /*
   * The row this save writes to: the one "Replace image" names, or failing that
   * the slot's own map. Only a slot with no map at all inserts — a replacement
   * always updates, even where the slot lookup would not have found the row.
   */
  const named = replaceId ? (inSlot.find((map) => map.id === replaceId) ?? existing.find((map) => map.id === replaceId) ?? { id: replaceId }) : null
  const replacing = named ?? inSlot[0] ?? null
  // Everything in the slot that is not the row being written to, for cleanup.
  const superseded = [...inSlot, ...(replacing && !inSlot.some((map) => map.id === replacing.id) ? [replacing] : [])]
  const reference = replacing?.projectId ? replacing : (inSlot[0] ?? existing[0])

  const fields = {
    project_id: reference?.projectId ?? projectId ?? null,
    phase_id: replacing?.phaseId ?? inSlot[0]?.phaseId ?? null,
    kind: 'map',
    name: file.name,
    mime_type: file.type,
    storage_path: storagePath,
    current: true,
    user_id: user.id,
    project: reference?.projectLabel || projectCode,
    image_URL: imageUrl,
    Phase: target.phase,
    type: target.commercial ? 'commercial' : target.phase === null ? null : 'residential',
    uploaded_at: new Date().toISOString(),
  }

  const { data: saved, error: saveError } = replacing
    ? await supabase.from('uploads').update(fields).eq('id', replacing.id).select('id')
    : await supabase.from('uploads').insert(fields).select('id')
  if (saveError) {
    // Nothing points at the new file, so it does not stay in the bucket.
    await bucket.remove([storagePath])
    throw new Error(saveError.message)
  }
  if (!saved?.length) {
    await bucket.remove([storagePath])
    // Naming the row makes a policy that forbids the update readable from the UI.
    throw new Error(
      replacing
        ? `The database did not accept the change to map #${replacing.id} — you may not be allowed to edit this row.`
        : 'The database did not accept the new map — you may need to sign in.',
    )
  }

  const result = { id: saved[0].id, url: imageUrl, storagePath }
  if (!superseded.length) return result

  const obsolete = superseded.filter((map) => map.id !== replacing?.id)

  /*
   * An annotated image may point at the map being replaced (see
   * annotatedImagesData's syncMapImage), and that picture is about to be
   * deleted — so those rows are moved onto the new one first, leaving the
   * annotations showing the map rather than a broken link. The table is
   * optional: a project without the annotated_images migration simply has none.
   */
  const oldUrls = superseded.map((map) => map.url).filter(Boolean)
  if (oldUrls.length) {
    const { error } = await supabase
      .from('annotated_images')
      .update({ image_link: imageUrl })
      .eq('project', projectCode)
      .in('image_link', oldUrls)
    if (error) console.error('[project maps] annotated images still point at the replaced map:', error)
  }

  /*
   * A slot should hold one row, but older data can have several for the same
   * one. The row just updated is the survivor; any others in the slot are
   * dropped, so the table ends up with exactly one map per slot.
   */
  if (obsolete.length) {
    const { error } = await supabase
      .from('uploads')
      .delete()
      .in(
        'id',
        obsolete.map((map) => map.id),
      )
    if (error) throw new Error(`The map was saved, but an older copy is still in the table: ${error.message}`)
  }

  /*
   * Only now, with the row pointing at the new picture, are the old files
   * deleted — a file removed before that could leave the row showing a broken
   * image. The new map is already saved, so a failure here is reported without
   * losing it.
   */
  const oldPaths = superseded.map((map) => pathInBucket(map, bucketName)).filter((path) => path && path !== storagePath)
  if (oldPaths.length) {
    const { error: removeError } = await bucket.remove(oldPaths)
    if (removeError) {
      throw new Error(
        `The new map was saved, but the old image is still in the "${bucketName}" bucket: ${removeError.message}`,
      )
    }
  }

  return result
}
