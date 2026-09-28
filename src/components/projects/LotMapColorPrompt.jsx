import { useEffect, useState } from 'react'
import AnnotatedImagePreview from '@/components/projects/AnnotatedImagePreview'
import { annotationIdsForLot, fillForStatus } from '@/components/projects/lotStatusPlan'
import {
  fetchAnnotatedImages,
  fetchMapImageUrl,
  parseSlot,
  saveAnnotatedImage,
  uploadMapImage,
} from '@/data/annotatedImagesData'
import { usesFloors } from '@/data/projectMapsData'
import { LOT_STATUS_OPTIONS, fetchLotsByIdentifier, updateLotStatus, updateLotStatuses } from '@/data/projectsData'
import { notifyFailed, notifySaved, notifyWarning } from '@/lib/notify'
import { MAP_LOT_FILL } from '@/theme/colors'

const fillLabel = (fill) => MAP_LOT_FILL.find((option) => option.value === fill)?.label ?? fill
const statusLabel = (status) => LOT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status

function slotName(slot, projectCode) {
  if (slot === 'whole') return 'Whole Map'
  if (slot === 'commercial') return 'Commercial'
  const { phase } = parseSlot(slot)
  return phase === null ? slot : `${usesFloors(projectCode) ? 'Floor' : 'Phase'} ${phase}`
}

/**
 * The annotated maps that draw `lot`, each with the annotations that are it. A
 * phase map only counts for its own phase; the whole map and the commercial
 * strip hold every phase, so they count whenever the label matches.
 */
function mapsForLot(images, lot) {
  return images.flatMap((image) => {
    const { phase, section } = parseSlot(image.slot)
    if (phase !== null && lot.phaseNo !== null && phase !== lot.phaseNo) return []
    if (section && lot.mapSection && section !== lot.mapSection) return []
    const shapeIds = annotationIdsForLot(image.coco, lot)
    return shapeIds.length ? [{ image, shapeIds }] : []
  })
}

/**
 * A status picked in the lot table, held until the map agrees. Every annotated
 * map that shows the lot opens in the colouring preview with the lot already
 * painted in its new status and zoomed to; it can be adjusted, and approving it
 * uploads the map and only then writes the status. Closing cancels: the status
 * is not saved, and nothing is uploaded.
 *
 * `request` is { lot, status } — the table row as it is, and its new raw status
 * — or null. `onNoMaps()` is called when no map shows the lot, so the caller can
 * save the status directly; `onDone()` once the prompt is finished; outcomes are reported as toasts.
 */
export default function LotMapColorPrompt({ projectCode, projectId, projectName, request, onDone, onNoMaps, onSkipColoring }) {
  // null while looking; then { queue: [{ image, shapeIds, url }], index, saved }.
  const [state, setState] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const fill = request ? fillForStatus(request.status) : null

  useEffect(() => {
    if (!request || !fill) return undefined
    let live = true
    ;(async () => {
      const { images } = await fetchAnnotatedImages({ projectCode })
      const found = mapsForLot(images, request.lot)
      // Show the picture the map tab shows, as the annotated-images preview does.
      const queue = await Promise.all(
        found.map(async (entry) => ({ ...entry, url: (await fetchMapImageUrl({ projectCode, slot: entry.image.slot })) || entry.image.url })),
      )
      if (!live) return
      if (!queue.some((entry) => entry.url)) onNoMaps()
      else setState({ queue: queue.filter((entry) => entry.url), index: 0, saved: [] })
    })().catch((err) => {
      // The maps cannot be checked, so they cannot hold the status up either.
      console.error('[projects] could not look up the maps for this lot:', err)
      if (live) onNoMaps()
    })
    return () => {
      live = false
    }
    // A new request is a new object; onDone is not part of what to look up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, fill, projectCode])

  if (!request || !fill || !state) return null
  const current = state.queue[state.index]
  if (!current) return null

  const { lot, status } = request
  const newStatus = statusLabel(status)

  function next(savedName) {
    const saved = [...state.saved, savedName]
    setSaveError('')
    if (state.index + 1 < state.queue.length) {
      setState({ ...state, index: state.index + 1, saved })
      return
    }
    setState(null)
    onDone()
  }

  /*
   * Closing cancels. Before the first map is saved nothing has been written;
   * after it the status is already in, so only the maps still open are left.
   */
  function cancel() {
    setState(null)
    // Part-way through, the status is already saved: say which map was left unchanged.
    if (state.saved.length) {
      notifyWarning(
        `${lot.identifier} is now ${newStatus}`,
        `The ${state.saved.join(' and ')} map was recolored, but the ${slotName(current.image.slot, projectCode)} map was left as it was.`,
      )
    }
    onDone()
  }

  const name = slotName(current.image.slot, projectCode)

  /*
   * The same save as the annotated-images tab: the recoloured picture replaces
   * the slot's map in `uploads`, the annotations point at it, and any other lots
   * recoloured along the way get their statuses.
   */
  async function saveUpdate({ file, changes }) {
    setSaving(true)
    setSaveError('')
    try {
      // The map first: if it fails, the lot keeps its old status too.
      const url = await uploadMapImage({ projectCode, projectId, slot: current.image.slot, file })
      if (url) await saveAnnotatedImage({ projectCode, slot: current.image.slot, existing: current.image, imageUrl: url })
      // The reserve type chosen on the map (Client or Company) goes with a reserved status.
      const own = changes.find((change) => change.id === lot.id)
      if (!state.saved.length) await updateLotStatus(lot.id, status, projectCode, { reserveType: own?.reserveType })
      // Other lots recoloured along the way; the requested one is written above.
      const result = await updateLotStatuses(
        changes.filter((change) => change.id !== lot.id),
        projectCode,
      )
      if (result.failed.length) {
        notifyWarning(`${name} map saved, some lots not updated`, `${result.failed.length} other lot${result.failed.length === 1 ? '' : 's'} kept the old status.`)
      } else {
        notifySaved(`${lot.identifier} is now ${newStatus}`, `The ${name} map was recolored.`)
      }
      next(name)
      return result
    } catch (err) {
      setSaveError(err.message)
      notifyFailed(`Could not change ${lot.identifier} to ${newStatus}`, err)
      throw err
    } finally {
      setSaving(false)
    }
  }

  const position = state.queue.length > 1 ? ` (map ${state.index + 1} of ${state.queue.length})` : ''

  return (
    <AnnotatedImagePreview
      key={`${current.image.id}-${state.index}`}
      open
      title={`Update map color — ${projectName || projectCode} ${name}${position}`}
      url={current.url}
      coco={current.image.coco}
      loadLots={() => fetchLotsByIdentifier(projectCode, parseSlot(current.image.slot))}
      onSaveUpdate={saveUpdate}
      onSkipColoring={
        state.saved.length
          ? undefined
          : () => {
              setState(null)
              onSkipColoring()
            }
      }
      saving={saving}
      saveError={saveError}
      initialPaints={current.shapeIds.map((shapeId) =>
        fill === 'reserved' ? { shapeId, status: fill, reserveType: lot.reserveType ?? '' } : { shapeId, status: fill },
      )}
      startPainting
      focusShapeIds={current.shapeIds}
      notice={`${lot.identifier} will change to ${newStatus}, so it is painted ${fillLabel(
        fill,
      )} on the map below.${
        fill === 'reserved' ? ' Choose Default, Client Reserved, or Company Reserved under “Reserved for”.' : ''
      } Check it and recolor any lot if needed, then press Save update — the ${name} map and ${
        lot.identifier
      }'s status are saved together. Closing this window cancels the change.`}
      closeConfirm={
        state.saved.length
          ? `Leave the ${name} map as it is? ${lot.identifier} is already ${newStatus}.`
          : `Cancel changing ${lot.identifier} to ${newStatus}? Nothing will be saved.`
      }
      onClose={cancel}
    />
  )
}
