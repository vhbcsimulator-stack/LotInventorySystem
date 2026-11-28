/*
 * Project maps from the Supabase `uploads` table. A map row has kind = 'map'
 * and current = true; `project` starts with the project code (e.g.
 * "MSCC - paused"), `Phase` is null for a whole-site map, and `type` is
 * 'commercial' for commercial maps. `image_URL` is a public Storage link into
 * the project's bucket (the lowercase code, e.g. `mvlc`).
 */
import { SOURCE, num, text } from './api'
import { supabase, unwrap } from './supabase'
import { lotTermsFor, normalizeSection, sectionSuffix } from './projectsData'
import { checkUpload } from '@/lib/uploadRules'
import { isSvgFile, prepareSvgFile } from '@/lib/svgMaps'

const isMvlc = (projectCode) => /^mvlc$/i.test(projectCode ?? '')
// MVLC's older Phase 1 and 2 maps were stored without a section: they are the East maps.
const sectionFor = (phase, section, projectCode) =>
  normalizeSection(section) || (isMvlc(projectCode) && (phase === 1 || phase === 2) ? 'East' : null)

export const mapTabValue = ({ phase, section, commercial }) =>
  commercial ? 'commercial' : phase === null ? 'whole' : `phase-${phase}${section ? `-${section.toLowerCase()}` : ''}`

/**
 * A map tab's value as the slot it stands for — 'phase-1-d' is
 * { phase: 1, section: 'D' }, 'phase-2-east' is Phase 2 East — the reverse of
 * mapTabValue. 'whole' (or anything unknown) has a null phase.
 */
export function parseSlotValue(value) {
  if (value === 'commercial') return { phase: null, section: null, commercial: true }
  const match = /^phase-(\d+)(?:-([a-z]+))?$/.exec(text(value))
  return {
    phase: match ? Number(match[1]) : null,
    section: normalizeSection(match?.[2]) || null,
    commercial: false,
  }
}

/** What a project's map slots are called: Floor (MSCC), else its lots' grouping — Phase by default. */
export const slotUnitFor = (projectCode) => (usesFloors(projectCode) ? 'Floor' : lotTermsFor(projectCode).group || 'Phase')

/** A slot's name, as its tab shows it: "Phase 1D", "Phase 2 East", "Floor 3". */
export const slotName = (projectCode, { phase, section = null }) => `${slotUnitFor(projectCode)} ${phase}${sectionSuffix(section)}`

function toMap(row, projectCode) {
  const phase = typeof row.Phase === 'number' ? row.Phase : num(row.Phase, NaN)
  return {
    id: row.id,
    url: text(row.image_URL),
    name: text(row.name),
    current: row.current !== false,
    phase: Number.isFinite(phase) ? phase : null,
    section: text(row.type).toLowerCase() === 'commercial' ? null : sectionFor(phase, text(row.map_section) || null, projectCode),
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
export const sameSlot = (map, target) =>
  map.commercial === target.commercial && map.phase === target.phase &&
  (map.commercial || (map.section ?? null) === (target.section ?? null))

/**
 * MSCC is a condominium: its maps are floor plans, so its tabs read "Floor N"
 * and it has no whole-site map. Every other project is a subdivision laid out
 * in phases, with a Whole Map tab.
 */
export const usesFloors = (projectCode) => /^mscc/i.test(projectCode ?? '')

/**
 * The project's maps grouped into tabs: Whole Map (once one is uploaded), one
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
        .select('id, name, project, project_id, phase_id, Phase, map_section, type, image_URL, storage_path, uploaded_at')
        .eq('kind', 'map')
        .eq('current', true)
        .ilike('project', `${projectCode}%`)
        .order('uploaded_at', { ascending: false }),
    )
    /*
     * Every current row is a slot — a phase, a section of one, a floor, or a
     * commercial map — including one added with "Add phase" that has no
     * picture yet. Only rows with a picture are maps to show.
     */
    const slots = data.map((row) => toMap(row, projectCode))
    const maps = slots.filter((map) => map.url)
    return { tabs: buildTabs(slots, projectCode), maps, source: SOURCE.DATABASE }
  } catch (err) {
    console.error('[project maps] falling back to no maps:', err)
    return empty(SOURCE.UNAVAILABLE)
  }
}

// Phases in order, then sections: none first, letters (A, B, D) before words (East).
const bySlot = (a, b) =>
  a.phase - b.phase ||
  Number(Boolean(a.section)) - Number(Boolean(b.section)) ||
  text(a.section).length - text(b.section).length ||
  text(a.section).localeCompare(text(b.section))

/**
 * The tabs, from the project's rows in `uploads`: Whole Map, one tab per
 * phase (or floor) and section, and Commercial. Nothing is hard-coded, so a
 * phase added from the portal — or straight in the table — gets its tab.
 */
function buildTabs(slots, projectCode) {
  const unit = slotUnitFor(projectCode)
  const withCaption = (map) => ({ ...map, caption: map.phase === null ? '' : slotName(projectCode, map) })
  const shown = (list) => list.filter((map) => map.url).map(withCaption)

  const phased = slots.filter((map) => !map.commercial && map.phase !== null)
  const phaseSlots = [...new Map(phased.map((map) => [mapTabValue(map), { phase: map.phase, section: map.section }])).values()].sort(bySlot)
  const commercial = slots.filter((map) => map.commercial).sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0))
  const whole = slots.filter((map) => !map.commercial && map.phase === null)

  return [
    /*
     * Only once a whole-site map is uploaded — a condominium never has one.
     * "Add map" still offers Whole Map, and uploading one brings the tab in.
     */
    ...(unit !== 'Floor' && whole.length ? [{ value: 'whole', label: 'Whole Map', maps: shown(whole) }] : []),
    ...phaseSlots.map((slot) => ({
      value: mapTabValue({ ...slot, commercial: false }),
      label: slotName(projectCode, slot),
      phase: slot.phase,
      section: slot.section,
      maps: shown(phased.filter((map) => map.phase === slot.phase && map.section === slot.section)),
    })),
    /*
     * Only where commercial maps exist, exactly as the phase tabs above work.
     * A project that sells no commercial lots (ERHD) then has no empty tab to
     * click into, and uploading one through "Add map" brings the tab back.
     */
    ...(commercial.length ? [{ value: 'commercial', label: 'Commercial', maps: shown(commercial) }] : []),
  ]
}

/**
 * Add a phase to a project: a map row in `uploads` with no picture yet, so its
 * tab appears straight away and "Add map" fills it in (saveProjectMap reuses
 * the row rather than adding a second one).
 *
 * Not limited to plain phases: `section` makes a section of one (a letter such
 * as D, or a word such as East — "Phase 1D", "Phase 2 East"), and `commercial`
 * a commercial map for the phase. A condominium's phases are its floors.
 * Resolves the new slot's tab value.
 */
export async function addPhase({ projectCode, projectId = null, phase, section = '', commercial = false }) {
  if (!supabase) throw new Error('No database connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  if (!projectCode) throw new Error('Choose a project first.')
  const unit = slotUnitFor(projectCode)
  if (!(Number.isInteger(phase) && phase > 0)) throw new Error(`${unit} must be a whole number above 0.`)
  const name = commercial ? '' : normalizeSection(section)
  if (name && !/^[A-Za-z]{1,12}$/.test(name)) {
    throw new Error('A section is one letter (such as D) or one word (such as East), up to 12 letters.')
  }

  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) throw new Error('Sign in to add phases.')

  const target = { phase, section: commercial ? null : sectionFor(phase, name || null, projectCode), commercial }
  const label = commercial ? `Commercial ${unit} ${phase}` : slotName(projectCode, target)

  const { data } = unwrap(
    await supabase
      .from('uploads')
      .select('id, name, project, project_id, phase_id, Phase, map_section, type, image_URL, storage_path, current, uploaded_at')
      .eq('kind', 'map')
      .ilike('project', `${projectCode}%`)
      .order('uploaded_at', { ascending: false }),
  )
  const rows = data.map((row) => toMap(row, projectCode)).filter((map) => map.current)
  if (rows.some((map) => sameSlot(map, target))) throw new Error(`${label} already exists for ${projectCode}.`)

  // The project's other maps say how it is labelled in `uploads` ("MSCC - paused") and its id.
  const reference = rows.find((map) => map.projectId) ?? rows[0]
  const { data: saved, error } = await supabase
    .from('uploads')
    .insert({
      project_id: reference?.projectId ?? projectId ?? null,
      kind: 'map',
      name: label,
      mime_type: '',
      storage_path: '',
      current: true,
      user_id: auth.user.id,
      project: reference?.projectLabel || projectCode,
      image_URL: '',
      Phase: phase,
      map_section: target.section,
      type: commercial ? 'commercial' : 'residential',
      uploaded_at: new Date().toISOString(),
    })
    .select('id')
  if (error) throw new Error(error.message)
  if (!saved?.length) throw new Error('The database did not accept the new phase — you may need to sign in.')
  return mapTabValue(target)
}

/**
 * Every map row the project has, read from the database rather than taken from
 * the caller's list — the list a page is holding can be out of date, or miss a
 * row whose `current` flag or `Phase` does not line up with the tab it was shown
 * under, and a save that went by the list alone then added a second row for a
 * map that was already there. Newest first; [] when it cannot be read.
 */
async function projectRows(projectCode) {
  try {
    const { data } = unwrap(
      await supabase
        .from('uploads')
        .select('id, name, project, project_id, phase_id, Phase, map_section, type, image_URL, storage_path, uploaded_at')
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
    return data.map((row) => toMap(row, projectCode))
  } catch (err) {
    console.error('[project maps] could not look up the slot before saving:', err)
    return []
  }
}

/** A file's extension, lower-cased, with .jpeg read as .jpg. */
const extensionOf = (name) => (/\.([a-z0-9]+)$/i.exec(name ?? '')?.[1] ?? '').toLowerCase().replace(/^jpeg$/, 'jpg')

/**
 * `path` for a new picture of `file`'s type: the same path when the type
 * matches, else the same folder and name with the new extension.
 */
export function withExtensionOf(path, file) {
  const next = extensionOf(file.name)
  if (!next || extensionOf(path) === next) return path
  return `${path.replace(/\.[^./]+$/, '')}.${next}`
}

/**
 * The project's top folder in its bucket — "<owner>/<CODE>". Maps saved from
 * different accounts can sit under different owners; the project's folder is
 * the one most of its maps use, and on a tie the oldest map's. Every save
 * writes there, so no account opens a folder of its own. Null when the project
 * has no stored map to go by.
 */
function projectFolder(maps, bucketName) {
  const folders = new Map() // folder → { count, oldest id }
  for (const map of maps) {
    const parts = pathInBucket(map, bucketName).split('/')
    if (parts.length < 4) continue
    const folder = parts.slice(0, 2).join('/')
    const seen = folders.get(folder) ?? { count: 0, oldest: Infinity }
    folders.set(folder, { count: seen.count + 1, oldest: Math.min(seen.oldest, Number(map.id) || Infinity) })
  }
  let best = null
  for (const [folder, { count, oldest }] of folders) {
    if (!best || count > best.count || (count === best.count && oldest < best.oldest)) best = { folder, count, oldest }
  }
  return best?.folder ?? null
}

/**
 * Where a replacement goes: the path it replaces, moved into the project's
 * folder when it sat under another one — same sub-folder and name, with the
 * extension following the new picture's type.
 */
function replacementPath(previousPath, folder, file) {
  const parts = previousPath.split('/')
  const moved = folder && parts.length >= 4 ? `${folder}/${parts.slice(2).join('/')}` : previousPath
  return withExtensionOf(moved, file)
}

/** Storage folder for a slot, matching how existing uploads are laid out. */
function folderFor({ phase, section, commercial }) {
  if (commercial) return phase === null ? 'commercial' : `phase-${phase}-commercial`
  return phase === null ? 'default' : `phase-${phase}${section ? `-${section.toLowerCase()}` : ''}`
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
  await checkUpload('map', file)
  // An SVG stays a vector; it is stored only once scripts and outside links are stripped.
  if (isSvgFile(file)) file = await prepareSvgFile(file)
  if (target.phase !== null && !(Number.isInteger(target.phase) && target.phase > 0)) {
    throw new Error('Phase must be a whole number.')
  }
  const section = target.commercial ? null : sectionFor(target.phase, target.section ?? null, projectCode)
  target = { ...target, section }

  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) throw new Error('Sign in to add or change maps.')

  const bucketName = projectCode.toLowerCase()
  const bucket = supabase.storage.from(bucketName)

  /*
   * What the slot really holds, asked of the database itself — see projectRows.
   * The caller's `existing` only fills in gaps, so that a row the page knows
   * about is still reused if the lookup could not run.
   */
  const everyMap = await projectRows(projectCode)
  const stored = everyMap.filter((map) => sameSlot(map, target))
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

  /*
   * Where the picture goes. A replacement takes the place of the file it
   * replaces — same folder, same name — so updating a map adds no folder or
   * file to the bucket. Only a change of type (a JPG replaced by an SVG) changes
   * the name's extension, still in the same folder: the extension is how a map
   * is known to be an SVG. A map for an empty slot follows the folders the
   * project's other maps already use.
   */
  const folder = projectFolder(everyMap.length ? everyMap : [...inSlot, ...existing], bucketName) ?? `${user.id}/${projectCode}`
  const previousPath = replacing ? pathInBucket(replacing, bucketName) : ''
  const overwrite = Boolean(previousPath)
  // A map left under another account's folder moves into the project's; the old file is dropped below.
  let storagePath = previousPath ? replacementPath(previousPath, folder, file) : ''
  if (!storagePath) {
    const safeName = file.name.replace(/[^\w.-]+/g, '_')
    const random = Math.random().toString(36).slice(2, 13)
    storagePath = `${folder}/${folderFor(target)}/${Date.now()}_${random}_${safeName}`
  }
  // The path can stay the same, so the link carries a version: browsers and the
  // storage CDN then load the new picture rather than a cached copy of the old.
  const imageUrl = `${bucket.getPublicUrl(storagePath).data.publicUrl}?v=${Date.now()}`

  const upload = async () => {
    const { error } = await bucket.upload(storagePath, file, { contentType: file.type, upsert: overwrite, cacheControl: '60' })
    if (!error) return
    // A request the browser could not complete: most often a file over the bucket's size limit, or the connection.
    const hint = /failed to fetch/i.test(error.message)
      ? ` — the ${(file.size / 1048576).toFixed(1)} MB file may be over the bucket's size limit, or the connection dropped.`
      : ''
    throw new Error(`Image upload to the "${bucketName}" bucket failed: ${error.message}${hint}`)
  }

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
    map_section: target.section,
    type: target.commercial ? 'commercial' : target.phase === null ? null : 'residential',
    uploaded_at: new Date().toISOString(),
  }

  // Naming the row makes a policy that forbids the update readable from the UI.
  const refused = () =>
    new Error(
      replacing
        ? `The database did not accept the change to map #${replacing.id} — you may not be allowed to edit this row.`
        : 'The database did not accept the new map — you may need to sign in.',
    )

  let saved
  if (replacing) {
    /*
     * Overwriting a file cannot be undone, so the row goes first: if the
     * database refuses the change, the old picture is never touched. Should the
     * upload then fail, the row is put back as it was.
     */
    const { data: before } = await supabase.from('uploads').select(Object.keys(fields).join(', ')).eq('id', replacing.id).maybeSingle()
    /*
     * The new link is written only once the new file is in the bucket. Every
     * write to `uploads` is broadcast live, and open pages refetch at once — a
     * link written before the upload finished would be loaded while the bucket
     * still held the old picture, and the browser would then keep showing that
     * old picture under the new link until the page was reloaded.
     */
    const first = { ...fields }
    delete first.image_URL
    const { data, error } = await supabase.from('uploads').update(first).eq('id', replacing.id).select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) throw refused()
    try {
      await upload()
    } catch (err) {
      if (before) await supabase.from('uploads').update(before).eq('id', replacing.id)
      throw err
    }
    const { error: linkError } = await supabase.from('uploads').update({ image_URL: imageUrl }).eq('id', replacing.id)
    if (linkError) throw new Error(`The new map was uploaded, but its link could not be saved: ${linkError.message}`)
    saved = data
  } else {
    await upload()
    const { data, error } = await supabase.from('uploads').insert(fields).select('id')
    // Nothing points at the new file, so it does not stay in the bucket.
    if (error || !data?.length) {
      await bucket.remove([storagePath])
      throw error ? new Error(error.message) : refused()
    }
    saved = data
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

/** Every map row (current or not) in one phase tab's slot, read from the database. */
async function rowsInSlot(projectCode, slotValue) {
  const slot = parseSlotValue(slotValue)
  if (slot.phase === null || slot.commercial) throw new Error('Choose a phase tab first.')
  const target = { ...slot, section: sectionFor(slot.phase, slot.section, projectCode) }
  const { data } = unwrap(
    await supabase
      .from('uploads')
      .select('id, name, project, project_id, phase_id, Phase, map_section, type, image_URL, storage_path, current, uploaded_at')
      .eq('kind', 'map')
      .ilike('project', `${projectCode}%`),
  )
  const all = data.map((row) => toMap(row, projectCode))
  return { target, all, rows: all.filter((map) => sameSlot(map, target)) }
}

/**
 * Move one slot's rows in a table keyed by project + slot (lot outlines, map
 * colours) along with its phase. A table that does not exist yet has nothing to move.
 */
async function moveSlotRows(table, projectCode, from, to, fields) {
  const { error } = await supabase.from(table).update({ slot: to, ...fields }).eq('project', projectCode).eq('slot', from)
  if (error && !/does not exist|schema cache/i.test(error.message)) {
    throw new Error(`The phase was renamed, but its ${table === 'annotated_images' ? 'lot outlines' : 'map colours'} were not moved: ${error.message}`)
  }
}

/**
 * Rename a phase tab — its number and/or section ("Phase 4" to "Phase 5", or
 * "Phase 1D" to "Phase 1 North"). Its maps, lot outlines and map colours move
 * with it. Lots are not changed: they keep the phase number they were saved
 * with. Resolves the tab's new value.
 */
export async function editPhase({ projectCode, slot, phase, section = '' }) {
  if (!supabase) throw new Error('No database connected.')
  const unit = slotUnitFor(projectCode)
  if (!(Number.isInteger(phase) && phase > 0)) throw new Error(`${unit} must be a whole number above 0.`)
  const name = normalizeSection(section)
  if (name && !/^[A-Za-z]{1,12}$/.test(name)) {
    throw new Error('A section is one letter (such as D) or one word (such as East), up to 12 letters.')
  }

  const { target: from, all, rows } = await rowsInSlot(projectCode, slot)
  if (!rows.length) throw new Error('That phase is no longer in the table — refresh the maps.')
  const to = { phase, section: sectionFor(phase, name || null, projectCode), commercial: false }
  const next = mapTabValue(to)
  if (next === mapTabValue(from)) return next
  if (all.some((map) => map.current && sameSlot(map, to))) throw new Error(`${slotName(projectCode, to)} already exists.`)

  const { data, error } = await supabase
    .from('uploads')
    .update({ Phase: to.phase, map_section: to.section })
    .in('id', rows.map((map) => map.id))
    .select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('The database did not accept the change — you may need to sign in.')

  const moved = { phase: to.phase, map_section: to.section }
  await moveSlotRows('annotated_images', projectCode, slot, next, moved)
  await moveSlotRows('map_legend_colors', projectCode, slot, next, moved)
  return next
}

/**
 * Delete a phase tab: its map rows and pictures, lot outlines and map colours.
 * The project's lots are not touched — lots in that phase stay, and keep their
 * phase number.
 */
export async function deletePhase({ projectCode, slot }) {
  if (!supabase) throw new Error('No database connected.')
  const { rows } = await rowsInSlot(projectCode, slot)
  if (!rows.length) return

  for (const table of ['annotated_images', 'map_legend_colors']) {
    const { error } = await supabase.from(table).delete().eq('project', projectCode).eq('slot', slot)
    if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(error.message)
  }

  const { data, error } = await supabase
    .from('uploads')
    .delete()
    .in('id', rows.map((map) => map.id))
    .select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('The database did not delete the phase — you may need to sign in.')

  // Only once nothing points at them are the pictures removed.
  const bucketName = projectCode.toLowerCase()
  const paths = rows.map((map) => pathInBucket(map, bucketName)).filter(Boolean)
  if (paths.length) {
    const { error: removeError } = await supabase.storage.from(bucketName).remove(paths)
    if (removeError) throw new Error(`The phase was deleted, but its pictures are still in the "${bucketName}" bucket: ${removeError.message}`)
  }
}

/** The tables fetchProjectMaps reads, so its Refresh button knows what to check. */
fetchProjectMaps.tables = () => ['uploads']
