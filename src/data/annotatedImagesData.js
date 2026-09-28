/*
 * ---------------------------------------------------------------------------
 * ANNOTATED IMAGES
 * ---------------------------------------------------------------------------
 * Site maps with their lot polygons, from the Supabase `annotated_images` table
 * and the `annotated-images` bucket (created by
 * supabase/migrations/20260917_create_annotated_images.sql).
 *
 * The uploaded file is the COCO JSON, stored as JSONB; an image may be attached
 * alongside it but is optional, since a COCO file names its own image.
 *
 * One row per project + phase — the table's unique index enforces it — so saving
 * a phase that already has one replaces it rather than stacking copies.
 */
import { SOURCE, num, text } from './api'
import { fetchProjectMaps, sameSlot, saveProjectMap } from './projectMapsData'
import { supabase, unwrap } from './supabase'
import { UPLOAD_RULES, checkUpload } from '@/lib/uploadRules'
import { fitSvg, isSvgFile, pictureSvg, prepareSvgFile } from '@/lib/svgMaps'

const BUCKET = 'annotated-images'

/** How many annotations the file describes, for the "3 annotations" line in the list. */
const countAnnotations = (coco) => (Array.isArray(coco?.annotations) ? coco.annotations.length : 0)

/**
 * A map tab's value as the slot it stands for: { phase, commercial }, which is
 * how `uploads` addresses the same picture. 'phase-2' covers a condominium's
 * floors too — the tab reads "Floor 2" but the column is still `phase`.
 */
export function parseSlot(slot) {
  if (slot === 'commercial') return { phase: null, section: null, commercial: true }
  const match = /^phase-(\d+)(?:-(a|b|c|east))?$/.exec(text(slot))
  return {
    phase: match ? Number(match[1]) : null,
    section: match?.[2] ? match[2].toUpperCase() === 'EAST' ? 'East' : match[2].toUpperCase() : null,
    commercial: false,
  }
}

/** The slot a row belongs to, for rows written before the slot column existed. */
const slotOf = (row) => {
  if (text(row.slot)) return text(row.slot)
  if (row.phase === null || row.phase === undefined) return 'whole'
  const section = text(row.map_section).toLowerCase()
  return `phase-${row.phase}${section ? `-${section}` : ''}`
}

function toImage(row) {
  const phase = typeof row.phase === 'number' ? row.phase : num(row.phase, NaN)
  return {
    id: row.id,
    slot: slotOf(row),
    url: text(row.image_link),
    storagePath: text(row.storage_path),
    phase: Number.isFinite(phase) ? phase : null,
    mapSection: text(row.map_section) || null,
    coco: row.coco_json ?? null,
    annotations: countAnnotations(row.coco_json),
    updatedAt: text(row.updated_at || row.created_at),
  }
}

/**
 * Every annotated image for one project, whole-site first and then by phase.
 * Never throws: failures resolve empty and report why via `source`.
 */
export async function fetchAnnotatedImages({ projectCode } = {}) {
  const empty = (source, message = '') => ({ images: [], source, message })
  if (!supabase) return empty(SOURCE.NOT_CONFIGURED)
  if (!projectCode) return empty(SOURCE.DATABASE)

  /*
   * `slot` and `storage_path` arrived after the first version of the migration,
   * so a database given only that version has the table but not the columns —
   * and asking for a column that is not there fails the whole query. Dropping
   * them and trying again keeps those rows visible (slotOf works out the slot
   * from `phase`) instead of showing an empty tab, which looked exactly like
   * having uploaded nothing.
   */
  const BASE = 'id, image_link, coco_json, project, phase, created_at, updated_at'
  const attempts = [
    { columns: `${BASE}, storage_path, slot, map_section`, order: 'slot' },
    { columns: BASE, order: 'phase' },
  ]

  let lastError = null
  for (const [index, attempt] of attempts.entries()) {
    try {
      const { data } = unwrap(
        await supabase
          .from('annotated_images')
          .select(attempt.columns)
          .eq('project', projectCode)
          .order(attempt.order, { ascending: true, nullsFirst: true }),
      )
      /*
       * The picture is the slot's current map in `uploads` — the one the map
       * tabs show — not the link the row happened to record. A map replaced or
       * removed there is replaced or gone here too; a slot with no map shows
       * none. A row may still hold annotations and no picture.
       */
      const { maps, source } = await fetchProjectMaps({ projectCode })
      const images = data.map(toImage).map((image) => ({
        ...image,
        url: source === SOURCE.DATABASE ? (findSlotMap(maps, image.slot)?.url ?? '') : image.url,
      }))
      return { images, source: SOURCE.DATABASE, message: '' }
    } catch (err) {
      lastError = err
      // Anything other than a missing newer column is a real failure.
      if (index === attempts.length - 1 || !/slot|storage_path|map_section/.test(err.message)) break
    }
  }

  /*
   * Before the migration is run the table does not exist at all, which reads as
   * an ordinary query failure. The tab then shows its empty state and says why,
   * rather than the page breaking or going quiet.
   */
  console.error('[annotated images] falling back to none:', lastError)
  return empty(SOURCE.UNAVAILABLE, explain(lastError?.message ?? ''))
}

/** A .json file's parsed contents, with a readable error for a file that is not COCO JSON. */
export async function readCocoJson(file) {
  if (!file) return null
  await checkUpload('coco', file)
  let parsed
  try {
    parsed = JSON.parse(await file.text())
  } catch (err) {
    throw new Error(`"${file.name}" is not valid JSON: ${err.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`"${file.name}" does not hold a COCO JSON object.`)
  }
  /*
   * COCO files carry these three lists. A file with none of them is almost
   * certainly the wrong one, and would be stored as annotations nothing can read.
   */
  if (!['annotations', 'images', 'categories'].some((key) => Array.isArray(parsed[key]))) {
    throw new Error(`"${file.name}" has no annotations, images, or categories — is it a COCO export?`)
  }
  return parsed
}

/** The pixel size a COCO file was annotated against, or null when it records none. */
export function cocoSize(coco) {
  const entry = Array.isArray(coco?.images) ? coco.images[0] : null
  const width = Number(entry?.width) || 0
  const height = Number(entry?.height) || 0
  return width > 0 && height > 0 ? { width, height } : null
}

/**
 * The same picture at the size the annotations were made against.
 *
 * A map exported at 16000 x 10000 and annotated on a 2048 x 1448 copy needs one
 * of the two moved before the polygons sit on the right lots. Fitting the image
 * is the half that can be done once and stored, leaving every later viewer — and
 * anything else that reads the row — with a picture whose pixels are the COCO
 * file's own coordinates.
 *
 * Returns the original file untouched when there is nothing to change, so it is
 * safe to call on every upload.
 */
export async function fitImageToAnnotations(file, size) {
  if (!file || !size) return file

  // An SVG is resized as a vector — its declared size changes, not its detail.
  if (isSvgFile(file)) {
    // fitSvg hands back the very same text when the size already matches.
    const text = await file.text()
    return fitSvg(text, size) === text ? file : prepareSvgFile(file, size)
  }

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch (err) {
    throw new Error(`"${file.name}" could not be read as an image: ${err.message}`)
  }
  const fits = bitmap.width === size.width && bitmap.height === size.height
  bitmap.close?.()
  if (fits) return file

  /*
   * Stored as SVG: the picture as uploaded — its own bytes, never redrawn or
   * re-compressed — laid over the annotations' size. The polygons land on the
   * right lots, and the map keeps every pixel of its original quality.
   */
  const type = /^image\/(png|jpeg|webp|gif)$/.test(file.type) ? file.type : 'image/png'
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error(`"${file.name}" could not be read.`))
    reader.readAsDataURL(new Blob([file], { type }))
  })
  const base = file.name.replace(/\.[^.]+$/, '')
  const svg = new File([pictureSvg(dataUrl, size.width, size.height)], `${base}-${size.width}x${size.height}.svg`, { type: 'image/svg+xml' })
  // Embedding adds a third to the picture's size.
  if (svg.size > UPLOAD_RULES.map.maxBytes) {
    throw new Error(`"${file.name}" comes to ${(svg.size / 1024 / 1024).toFixed(1)} MB as SVG, past the ${UPLOAD_RULES.map.maxBytes / 1024 / 1024} MB map limit.`)
  }
  return svg
}

/** One stored image re-fetched as a File, so it can be resized and written back. */
export async function fetchStoredImage(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The stored image could not be read back (${response.status}).`)
  const blob = await response.blob()
  const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'map.png')
  return new File([blob], name, { type: blob.type || 'image/png' })
}

/**
 * The map a slot stands for, out of the project's maps.
 *
 * The Commercial tab gathers every commercial map the project has, whatever
 * phase each belongs to — "Phase 1 East Gate Commercial" is stored with
 * phase = 1 — so matching that slot on phase as well found nothing, and a tab
 * plainly showing a map was reported as having none. Commercial therefore takes
 * the first commercial map, in the order the tab lists them; every other slot
 * still matches exactly.
 */
function findSlotMap(maps, slot) {
  const target = parseSlot(slot)
  if (target.commercial) {
    return maps.filter((map) => map.commercial).sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0))[0] ?? null
  }
  return maps.find((map) => sameSlot(map, target)) ?? null
}

/**
 * The project's current map for one slot, from the `uploads` table — the picture
 * the map tabs show. Empty when the slot has none, or when the table cannot be
 * read, so a caller can fall back to whatever the annotations row links to.
 */
export async function fetchMapImageUrl({ projectCode, slot = 'whole' }) {
  try {
    const { maps, source } = await fetchProjectMaps({ projectCode })
    if (source !== SOURCE.DATABASE) return ''
    return findSlotMap(maps, slot)?.url ?? ''
  } catch (err) {
    console.error('[annotated images] no map to preview against:', err)
    return ''
  }
}

/**
 * Bring the project's own map for one phase into line with its annotations.
 *
 * The picture belongs to the `uploads` table — it is what the map tabs show — so
 * the annotations do not keep a second copy of it. Where it was exported at a
 * different size than the annotations were drawn against, it is fetched, redrawn
 * at the annotations' size, and saved back through the ordinary map save: the
 * resized image becomes the current map and the one it replaces is deleted, so
 * the map tab and the annotations show the same picture from then on.
 *
 * Resolves { url, resized, size }. Throws when the phase has no map yet, since
 * there is then nothing to annotate against.
 */
export async function syncMapImage({ projectCode, projectId = null, slot = 'whole', slotName = '', coco = null }) {
  const size = cocoSize(coco)
  const { maps, source } = await fetchProjectMaps({ projectCode })
  if (source !== SOURCE.DATABASE) throw new Error('The uploads table could not be read.')

  const map = findSlotMap(maps, slot)
  /*
   * The slot a replacement is written back to is the map's own, not the tab's:
   * a Phase 1 commercial map must stay Phase 1 commercial, or saving it would
   * create a second, phase-less commercial map beside the one it replaced.
   */
  const target = map ? { phase: map.phase, section: map.section, commercial: map.commercial } : parseSlot(slot)
  if (!map) {
    throw new Error(
      `No map is uploaded for ${slotName || slot} yet — add one on its map tab first, or choose an image here.`,
    )
  }
  // Nothing to match against: the COCO file states no size of its own.
  if (!size) return { url: map.url, resized: false, size: null }

  const current = await fetchStoredImage(map.url)
  const fitted = await fitImageToAnnotations(current, size)
  // Same object back means it was already the right size.
  if (fitted === current) return { url: map.url, resized: false, size }

  await saveProjectMap({ projectCode, projectId, target, file: fitted, existing: maps, replaceId: map.id })
  // Re-read rather than guessing the new public URL, which the save builds itself.
  const after = await fetchProjectMaps({ projectCode })
  const updated = after.maps.find((existing) => sameSlot(existing, target))
  return { url: updated?.url ?? map.url, resized: true, size }
}

/**
 * Store `file` — the map with its lots recoloured — as the current map for one
 * slot, through the ordinary map save: it becomes what the map tab shows, and the
 * image it replaces is deleted. Resolves the new image's public URL.
 */
export async function uploadMapImage({ projectCode, projectId = null, slot = 'whole', file }) {
  const { maps, source } = await fetchProjectMaps({ projectCode })
  if (source !== SOURCE.DATABASE) throw new Error('The uploads table could not be read.')
  const map = findSlotMap(maps, slot)
  // The map's own slot, as in syncMapImage, so a Phase 1 commercial map stays one.
  const target = map ? { phase: map.phase, section: map.section, commercial: map.commercial } : parseSlot(slot)
  await saveProjectMap({ projectCode, projectId, target, file, existing: maps, replaceId: map?.id ?? null })
  const after = await fetchProjectMaps({ projectCode })
  return after.maps.find((existing) => sameSlot(existing, target))?.url ?? ''
}

/**
 * Add or replace the annotations for one project phase.
 *
 * `slot` is the map tab this belongs to — 'whole', 'phase-2', 'commercial'. `coco` is the parsed
 * COCO JSON (see readCocoJson) — required for a new row, and on an update it may
 * be null to keep what is stored. `file` is an optional image to show the
 * annotations against.
 *
 * The picture is always the slot's map in `uploads`. An image chosen here is
 * redrawn at the annotations' own size (unless `fit` is false) and saved as that
 * map; `imageUrl` instead links a map already there (see syncMapImage). Either
 * way the row only links to it, so the annotations and the map tab always show
 * the same picture, and deleting the annotations never deletes the map.
 */
export async function saveAnnotatedImage({
  projectCode,
  projectId = null,
  slot = 'whole',
  file = null,
  coco = null,
  existing = null,
  imageUrl = '',
  fit = true,
}) {
  if (!supabase) throw new Error('No database connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  if (!projectCode) throw new Error('Choose a project first.')
  if (!slot) throw new Error('Choose which map these annotations belong to.')
  const { phase, section } = parseSlot(slot)
  if (!coco && !existing) throw new Error('Choose a COCO JSON file.')
  if (file) await checkUpload('map', file)
  if (!file && !coco && !imageUrl) throw new Error('Choose a new COCO JSON file or a new image.')

  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) throw new Error('Sign in to upload annotated images.')

  /*
   * The picture lives in `uploads`, as the slot's map — the one the map tabs
   * show — never as a copy of the annotations' own. An image chosen here is
   * fitted to the annotations' size as an SVG, its picture untouched (unless `fit` is false), and saved as that
   * map; the row only records a link to it. The annotations being saved decide
   * the size; where only the image is being replaced, the ones stored do.
   */
  let link = imageUrl || existing?.url || ''
  if (file) {
    const fitted = fit ? await fitImageToAnnotations(file, cocoSize(coco ?? existing?.coco)) : file
    link = await uploadMapImage({ projectCode, projectId, slot, file: fitted })
    if (!link) throw new Error('The map was saved, but its link could not be read back — reload and try again.')
  }

  const row = {
    project: projectCode,
    slot,
    // Kept in step with the slot so anything reading by phase still works.
    phase,
    // Kept in step with uploads.map_section (A, B, C, or East) so section maps
    // can also be identified directly from the annotated_images table.
    map_section: section,
    // Null, not '', when no image is attached — the column is nullable and the
    // difference shows up in any query that looks for rows still missing one.
    image_link: link || null,
    // The picture is the map's, in `uploads`: the annotations own no file.
    storage_path: null,
    user_id: user.id,
    updated_at: new Date().toISOString(),
    // Left out when no new JSON was chosen, so the stored annotations survive an
    // image-only replacement.
    ...(coco ? { coco_json: coco } : {}),
  }

  const { data, error } = await supabase
    .from('annotated_images')
    .upsert(row, { onConflict: 'project,slot' })
    .select('id')
  if (error) throw new Error(explain(error.message))
  if (!data?.length) throw new Error('The database did not accept the annotations — you may need to sign in.')

  // A picture of the annotations' own from before, now replaced by the map's, is dropped.
  if (existing?.storagePath) await supabase.storage.from(BUCKET).remove([existing.storagePath])
  return data[0].id
}

/** Remove one set of annotations — its row and any image file it has. */
export async function deleteAnnotatedImage(image) {
  if (!supabase) throw new Error('No database connected.')
  if (!image?.id) throw new Error('No image to delete.')

  const { data, error } = await supabase.from('annotated_images').delete().eq('id', image.id).select('id')
  if (error) throw new Error(explain(error.message))
  if (!data?.length) throw new Error('The database did not delete it — you may need to sign in.')

  /*
   * A file left behind is harmless, so a failure here is not worth an error the
   * user cannot act on: the row — the only thing the portal reads — is gone.
   */
  if (image.storagePath) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([image.storagePath])
    if (removeError) console.error('[annotated images] row deleted, file kept:', removeError)
  }
}

/**
 * Supabase's "not in the schema cache" errors, rewritten as what to do.
 *
 * A missing table and a missing column read almost alike, and a database set up
 * from an earlier version of the migration has the table but not every column —
 * so the two are told apart and the column is named, rather than reporting a
 * table that is plainly there as missing.
 */
const MIGRATION = 'supabase/migrations/20260917_create_annotated_images.sql'

function explain(message) {
  const column = /Could not find the '([^']+)' column/i.exec(message) ?? /column [^ ]*\.?"?([a-z_]+)"? does not exist/i.exec(message)
  if (column) {
    return `The annotated_images table has no ${column[1]} column yet — run ${MIGRATION} again in the Supabase SQL Editor (it adds the columns a first run may have missed).`
  }
  if (/annotated_images/.test(message) && /(does not exist|schema cache)/i.test(message)) {
    return `The annotated_images table is not set up yet — run ${MIGRATION} in the Supabase SQL Editor.`
  }
  return message
}

/** The tables fetchAnnotatedImages reads (pictures come from the maps in `uploads`), for its Refresh button. */
fetchAnnotatedImages.tables = () => ['annotated_images', 'uploads']
