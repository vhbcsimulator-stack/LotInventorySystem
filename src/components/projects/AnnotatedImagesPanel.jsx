import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Menu, NativeSelect, Portal, Text } from '@chakra-ui/react'
import { LuChevronDown, LuMousePointerClick, LuPaintbrush, LuScanEye, LuShapes, LuTrash2, LuTriangleAlert, LuUpload, LuX } from 'react-icons/lu'
import AnnotatedImagePreview from '@/components/projects/AnnotatedImagePreview'
import useApiQuery from '@/hooks/useApiQuery'
import {
  deleteAnnotatedImage,
  fetchAnnotatedImages,
  fetchMapImageUrl,
  parseSlot,
  readCocoJson,
  saveAnnotatedImage,
  syncMapImage,
  uploadMapImage,
} from '@/data/annotatedImagesData'
import { SOURCE } from '@/data/api'
import { fetchLotsByIdentifier, updateLotStatuses } from '@/data/projectsData'
import { COLORS } from '@/theme/colors'
import { notifyFailed, notifySaved, notifyWarning } from '@/lib/notify'
import { acceptFor, describeUpload, uploadProblem } from '@/lib/uploadRules'

const FONT = 'Inter, system-ui, sans-serif'

/**
 * What the map tabs call one slot — "Whole Map", "Phase 2", "Floor 3",
 * "Commercial". The tabs are the source of the wording, so the two never drift;
 * a slot whose tab has since gone (its map was removed) still reads sensibly.
 */
function slotLabel(slot, slots) {
  const known = slots.find((option) => option.value === slot)
  if (known) return known.label
  const phase = /^phase-(\d+)$/.exec(slot ?? '')?.[1]
  return phase ? `Phase ${phase}` : slot === 'commercial' ? 'Commercial' : 'Whole Map'
}

/** Stands in for an annotations row when coloring a map that has none. */
const FREEHAND = 'freehand'

/** Shown before and while coloring without a COCO JSON. */
const FREEHAND_WARNING =
  'Coloring without a COCO JSON is less accurate: each lot is found only by its color where you click, so a lot with faded or uneven fill, ' +
  'lettering across its border, or a gap in its outline may be colored only partly or spill into its neighbor. Check every lot before saving. '

/**
 * The lot-outline actions of the map tab in view: Color lots, which opens the
 * annotated preview ready to paint, and a menu to upload, preview or delete the
 * COCO JSON describing that map's lot polygons.
 *
 * The annotations belong to a slot — the tab's value — so each map tab carries
 * its own. Color lots on a map with none offers a choice: upload the COCO JSON
 * first (coloring opens once it is saved), or color by clicking alone, with a
 * warning that it is less accurate and that each colored lot must be linked.
 *
 * `ActionButton` comes from ProjectMapView, so these sit beside its own buttons.
 */
export default function AnnotatedImagesPanel({
  projectCode,
  projectName,
  projectId,
  // The map tab in view, and every map tab as [{ value, label }].
  slot,
  slots = [],
  // Whether the tab in view has a map picture to color at all.
  hasMap = true,
  ActionButton,
  // Asked to move to another tab — when coloring starts on a map other than this one.
  onSelectSlot,
  startColoring = false,
}) {
  const query = useMemo(() => ({ projectCode }), [projectCode])
  const { data, loading, reload } = useApiQuery(fetchAnnotatedImages, query)
  const [editing, setEditing] = useState(null) // null | { image, slot } — image null when adding
  const [confirming, setConfirming] = useState(null)
  // { image, url } — the url is the project's own map, resolved when it opens.
  const [previewing, setPreviewing] = useState(null)
  const [fitError, setFitError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [busy, setBusy] = useState('') // '' | 'save' | 'delete'
  const [error, setError] = useState('')
  // Asking how to color a map that has no lot outlines.
  const [choosing, setChoosing] = useState(false)
  const autoColorRun = useRef(false)
  // A slot whose coloring opens as soon as its just-uploaded annotations load.
  const colorAfterUpload = useRef(null)

  const images = useMemo(() => data?.images ?? [], [data])
  const current = images.find((image) => image.slot === slot) ?? null
  /*
   * Uploading is offered whenever there is a database to upload to. The table
   * itself may still be missing — the migration not yet run — which reads as
   * UNAVAILABLE; hiding the button then would leave no way forward, whereas
   * saving says exactly which migration to run.
   */
  const canEdit = data?.source !== SOURCE.NOT_CONFIGURED && Boolean(projectCode)

  /*
   * The preview draws the map that `uploads` holds for this slot, not a copy —
   * so it shows what the map tab shows, and the fitting it does is against the
   * picture that is actually in use. The row's own link stands in for a slot with
   * no map of its own, or while the lookup is in flight.
   */
  async function openPreview(image, startPainting = false, showAnnotations = false) {
    setFitError('')
    setPreviewing({ image, url: image.url, startPainting, showAnnotations })
    const url = await fetchMapImageUrl({ projectCode, slot: image.slot })
    if (url) setPreviewing((open) => (open?.image.id === image.id ? { ...open, url } : open))
  }

  /** For effects: the preview opens once its map is resolved, not before. */
  function openColoringWhenReady(image) {
    fetchMapImageUrl({ projectCode, slot: image.slot }).then((url) => {
      setFitError('')
      setPreviewing({ image, url: url || image.url, startPainting: true })
    })
  }

  // Opened from the command palette: this tab's map if it has outlines, else the first that does.
  useEffect(() => {
    if (!startColoring || autoColorRun.current || loading || !data) return
    autoColorRun.current = true
    const image = images.find((entry) => entry.slot === slot) ?? images.find((entry) => entry.slot === 'whole') ?? images[0]
    if (!image) return
    if (image.slot !== slot) onSelectSlot?.(image.slot)
    openColoringWhenReady(image)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, images, loading, projectCode, slot, startColoring])

  useEffect(() => {
    if (!colorAfterUpload.current) return
    const image = images.find((entry) => entry.slot === colorAfterUpload.current)
    if (!image?.coco) return
    colorAfterUpload.current = null
    openColoringWhenReady(image)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images])

  if (loading && !data) return null

  function colorLots() {
    if (current?.coco) {
      openPreview(current, true)
      return
    }
    // No outlines for this map yet: upload them first, or color without them.
    setError('')
    setChoosing(true)
  }

  function uploadThenColor() {
    setChoosing(false)
    setEditing({ image: null, slot, thenColor: true })
  }

  /*
   * Coloring with no COCO JSON: the slot's own map, painted lot by lot where it
   * is clicked and linked to its lot by hand. There is no annotations row to update.
   */
  async function colorFreehand() {
    setChoosing(false)
    const url = await fetchMapImageUrl({ projectCode, slot })
    if (!url) {
      setError(`The ${label} tab has no map to color yet — use Add map first.`)
      return
    }
    setFitError('')
    setPreviewing({ image: { id: FREEHAND, slot, coco: null, url }, url, startPainting: true, freehand: true })
  }

  async function save({ slot, file, cocoFile }) {
    setBusy('save')
    setError('')
    try {
      const existing = editing?.image ?? images.find((image) => image.slot === slot) ?? null
      const coco = await readCocoJson(cocoFile)
      /*
       * With no image chosen, the project's own map for this slot is the picture:
       * it is read from `uploads`, resized to the annotations, and saved back
       * there, so the map tab and the annotations show the same thing.
       */
      const name = slotLabel(slot, slots)
      const synced = file
        ? null
        : await syncMapImage({ projectCode, projectId, slot, slotName: name, coco: coco ?? existing?.coco })
      await saveAnnotatedImage({ projectCode, projectId, slot, file, coco, existing, imageUrl: synced?.url ?? '' })
      if (editing?.thenColor) colorAfterUpload.current = slot
      setEditing(null)
      const message = synced?.resized
        ? `Annotations saved, and the ${name} map was resized to ${synced.size.width} × ${synced.size.height} to match.`
        : existing
          ? 'Annotations updated.'
          : 'Annotations uploaded.'
      notifySaved(existing ? 'Annotations updated' : 'Annotations uploaded', message)
      reload()
    } catch (err) {
      setError(err.message)
      notifyFailed('Could not save the annotations', err)
    } finally {
      setBusy('')
    }
  }

  /*
   * Resize the project's map for this slot — in `uploads` itself — to the size its
   * annotations were drawn against, and point the row at the result. Uploading
   * does this already; this is for rows saved before it did, or whose map has
   * since been replaced with a differently sized one.
   */
  /*
   * The lots a slot's annotations can be matched to: one phase's for a phase
   * map, every lot for the whole map or the commercial strip.
   */
  const loadLots = (image) => fetchLotsByIdentifier(projectCode, parseSlot(image.slot))

  /*
   * Save a reviewed colouring: store the recoloured map as this slot's map in
   * `uploads` (the image it replaces is deleted), point the annotations at it,
   * then give the lots their new statuses. The map goes first — if it fails,
   * nothing in the lot table has changed. The preview then shows the new map, so
   * the next round of colouring starts from what was just saved.
   *
   * Throws when the map could not be stored; resolves { failed } for lots whose
   * status did not take.
   */
  async function saveColoredUpdate(image, { file, changes }) {
    setBusy('upload')
    setUploadError('')
    try {
      const url = await uploadMapImage({ projectCode, projectId, slot: image.slot, file })
      // Freehand coloring has no annotations row to point at the new map.
      if (url && image.id !== FREEHAND) await saveAnnotatedImage({ projectCode, slot: image.slot, existing: image, imageUrl: url })
      const { updated, failed } = await updateLotStatuses(changes, projectCode)
      const name = slotLabel(image.slot, slots)
      const message =
        `The colored map was saved — the ${name} map tab now shows it` +
        (updated ? `, and ${updated} lot status${updated === 1 ? ' was' : 'es were'} updated in the table.` : '.')
      if (failed.length) notifyWarning('Map saved, some lots not updated', `${failed.length} lot${failed.length === 1 ? '' : 's'} kept the old status.`)
      else notifySaved('Map colors saved', message)
      if (url) setPreviewing((open) => (open?.image.id === image.id ? { ...open, image: { ...open.image, url }, url, startPainting: false } : open))
      reload()
      return { failed }
    } catch (err) {
      setUploadError(err.message)
      notifyFailed('Could not save the colored map', err)
      throw err
    } finally {
      setBusy('')
    }
  }

  async function refit(image, size) {
    setBusy('fit')
    setFitError('')
    try {
      const synced = await syncMapImage({
        projectCode,
        projectId,
        slot: image.slot,
        slotName: slotLabel(image.slot, slots),
        coco: image.coco,
      })
      await saveAnnotatedImage({ projectCode, slot: image.slot, existing: image, imageUrl: synced.url })
      notifySaved('Map resized', `Now ${size.width} × ${size.height}, matching the annotations.`)
      setPreviewing(null)
      reload()
    } catch (err) {
      setFitError(err.message)
      notifyFailed('Could not resize the map', err)
    } finally {
      setBusy('')
    }
  }

  async function remove(image) {
    setBusy('delete')
    setError('')
    try {
      await deleteAnnotatedImage(image)
      notifySaved('Annotated image deleted')
      reload()
    } catch (err) {
      setError(err.message)
      notifyFailed('Could not delete the annotated image', err)
    } finally {
      setConfirming(null)
      setBusy('')
    }
  }

  const label = slotLabel(slot, slots)
  const hasOutlines = Boolean(current?.coco)
  // Someone who cannot upload has nothing to do on a map without outlines.
  if (!canEdit && !hasOutlines) return null

  const menuItem = { gap: '8px', fontSize: '13px' }

  return (
    <>
      <ActionButton
        icon={LuPaintbrush}
        disabled={Boolean(busy)}
        title={hasOutlines ? `Color the lots on the ${label} map` : `The ${label} map has no lot outlines yet — upload them, or color without them`}
        onClick={colorLots}
      >
        Color lots
      </ActionButton>

      <Menu.Root
        positioning={{ placement: 'bottom-end' }}
        onSelect={({ value }) => {
          setError('')
          if (value === 'upload') setEditing({ image: current, slot })
          // Previewing outlines is for looking at them, so they show from the start.
          else if (value === 'preview') openPreview(current, false, true)
          else if (value === 'delete') setConfirming(current)
        }}
      >
        {/* Styled as ActionButton, which cannot take the trigger's ref. */}
        <Menu.Trigger
          display="flex"
          alignItems="center"
          gap="6px"
          h="34px"
          px="12px"
          borderRadius="8px"
          border="1px solid"
          borderColor={COLORS.border}
          bg={COLORS.surface}
          color={COLORS.heading}
          fontFamily={FONT}
          fontWeight="600"
          fontSize="13px"
          cursor="pointer"
          flexShrink={0}
          disabled={Boolean(busy)}
          _hover={{ bg: COLORS.hoverBg }}
          _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
          _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
        >
          <Icon as={LuShapes} boxSize="14px" />
          {hasOutlines ? `Lot outlines (${current.annotations})` : 'Lot outlines'}
          <Icon as={LuChevronDown} boxSize="14px" />
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content minW="200px">
              {hasOutlines ? (
                <Menu.Item value="preview" {...menuItem}>
                  <Icon as={LuScanEye} boxSize="14px" />
                  Preview outlines
                </Menu.Item>
              ) : null}
              {canEdit ? (
                <Menu.Item value="upload" {...menuItem}>
                  <Icon as={LuUpload} boxSize="14px" />
                  {current ? 'Replace COCO JSON' : 'Upload COCO JSON'}
                </Menu.Item>
              ) : null}
              {canEdit && current ? (
                <Menu.Item value="delete" {...menuItem} color="#DC2626" _hover={{ bg: '#FDECEC', color: '#B91C1C' }}>
                  <Icon as={LuTrash2} boxSize="14px" />
                  Delete outlines
                </Menu.Item>
              ) : null}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      {error && !editing ? (
        <Text role="alert" w="100%" fontFamily={FONT} fontSize="13px" color="#B91C1C">
          {error}
        </Text>
      ) : null}

      {previewing ? (
        <AnnotatedImagePreview
          open
          title={`${projectName || projectCode} — ${slotLabel(previewing.image.slot, slots)}${previewing.freehand ? ' (no outlines)' : ''}`}
          warning={previewing.freehand ? FREEHAND_WARNING : ''}
          url={previewing.url}
          coco={previewing.image.coco}
          fitting={busy === 'fit'}
          fitError={fitError}
          onFitImage={(size) => refit(previewing.image, size)}
          loadLots={canEdit ? () => loadLots(previewing.image) : undefined}
          lookupLots={() => loadLots(previewing.image)}
          onSaveUpdate={canEdit ? (update) => saveColoredUpdate(previewing.image, update) : undefined}
          allowMapOnlySave={canEdit}
          saving={busy === 'upload'}
          saveError={uploadError}
          startPainting={Boolean(previewing.startPainting)}
          showAnnotations={Boolean(previewing.showAnnotations)}
          onClose={() => {
            setPreviewing(null)
            setFitError('')
            setUploadError('')
          }}
        />
      ) : null}

      {choosing ? (
        <ColorChoiceDialog
          label={label}
          hasMap={hasMap}
          ActionButton={ActionButton}
          onUpload={uploadThenColor}
          onFreehand={colorFreehand}
          onClose={() => setChoosing(false)}
        />
      ) : null}

      {editing ? (
        <AnnotatedImageDialog
          image={editing.image}
          initialSlot={editing.slot}
          thenColor={Boolean(editing.thenColor)}
          slots={slots}
          busy={busy === 'save'}
          error={error}
          ActionButton={ActionButton}
          onClose={() => {
            setEditing(null)
            setError('')
          }}
          onSave={save}
        />
      ) : null}

      {confirming ? (
        <ConfirmDeleteDialog
          label={slotLabel(confirming.slot, slots)}
          busy={busy === 'delete'}
          ActionButton={ActionButton}
          onClose={() => setConfirming(null)}
          onConfirm={() => remove(confirming)}
        />
      ) : null}
    </>
  )
}

/**
 * A file field a file can be dropped on, or clicked to browse.
 *
 * `kind` is an upload rule (lib/uploadRules) that sets the picker's filter and
 * decides what a drop is allowed to be — a drop is not filtered by the browser
 * the way the picker is, so a .png dragged onto the JSON field has to be turned
 * away here, with a reason, rather than silently taken.
 */
function FileDropZone({ label, hint, kind, file, disabled, onChange }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)
  const [rejected, setRejected] = useState('')
  const accept = acceptFor(kind)

  function take(chosen) {
    if (!chosen) return
    const problem = uploadProblem(kind, chosen)
    if (problem) {
      setRejected(problem)
      return
    }
    setRejected('')
    onChange(chosen)
  }

  return (
    <Box>
      <Text mb="6px" fontFamily={FONT} fontWeight="500" fontSize="13px" color={COLORS.heading}>
        {label}
      </Text>
      <Flex
        as="button"
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          if (!disabled) take(event.dataTransfer.files?.[0])
        }}
        direction="column"
        align="center"
        justify="center"
        gap="4px"
        w="100%"
        py="14px"
        px="12px"
        textAlign="center"
        borderRadius="10px"
        border="1px dashed"
        borderColor={over ? COLORS.brandGreen : COLORS.border}
        bg={over ? COLORS.hoverBg : COLORS.surface}
        cursor={disabled ? 'not-allowed' : 'pointer'}
        transition="background 120ms ease, border-color 120ms ease"
        _disabled={{ opacity: 0.55 }}
        _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      >
        <Icon as={LuUpload} boxSize="16px" color={over ? COLORS.brandGreen : COLORS.subtle} />
        <Text fontFamily={FONT} fontSize="13px" fontWeight={file ? '600' : '500'} color={COLORS.heading} truncate maxW="100%">
          {file ? file.name : 'Drop the file here, or click to browse'}
        </Text>
        <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
          {hint}
        </Text>
      </Flex>
      {file ? (
        <Flex
          as="button"
          type="button"
          mt="6px"
          align="center"
          gap="4px"
          fontFamily={FONT}
          fontSize="12px"
          color={COLORS.subtle}
          cursor="pointer"
          _hover={{ textDecoration: 'underline' }}
          onClick={() => {
            onChange(null)
            // The input keeps its old value otherwise, so re-picking the same
            // file after clearing would fire no change event.
            if (input.current) input.current.value = ''
          }}
        >
          <Icon as={LuX} boxSize="12px" />
          Remove
        </Flex>
      ) : null}
      {rejected ? (
        <Text role="alert" mt="6px" fontFamily={FONT} fontSize="12px" color="#B91C1C">
          {rejected}
        </Text>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          take(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </Box>
  )
}

/**
 * Upload or update the COCO JSON for a map slot. The map tab supplies its image.
 *
 * The slot cannot be changed while updating: it is what identifies the row, and
 * moving annotations to another map is an upload onto that map.
 */
function AnnotatedImageDialog({ image, initialSlot, thenColor, slots, busy, error, ActionButton, onClose, onSave }) {
  // The map tabs are the choice — the same list, in the same words, as the tabs
  // across the top, so the annotations land on a map that actually exists.
  const options = slots.length ? slots : [{ value: 'whole', label: 'Whole Map' }]
  const updating = Boolean(image)
  const [slot, setSlot] = useState(image?.slot ?? initialSlot ?? options[0].value)
  const [cocoFile, setCocoFile] = useState(null)
  const canSave = !busy && Boolean(slot) && Boolean(cocoFile)

  const label = (children) => (
    <Text mb="6px" fontFamily={FONT} fontWeight="500" fontSize="13px" color={COLORS.heading}>
      {children}
    </Text>
  )

  return (
    <Dialog.Root
      open
      onOpenChange={({ open: next }) => {
        if (!next && !busy) onClose()
      }}
      placement="center"
      size="sm"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px" maxH="calc(100dvh - 32px)">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px">
              <Dialog.Title
                fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
                fontSize="18px"
                color={COLORS.heading}
              >
                {updating ? 'Update annotations' : 'Upload annotations'}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Flex direction="column" gap="14px">
                {thenColor ? (
                  <Text fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>
                    This map has no lot outlines yet. Upload its COCO JSON and coloring opens once it is saved.
                  </Text>
                ) : null}
                <Box>
                  {label('Map')}
                  <NativeSelect.Root>
                    <NativeSelect.Field value={slot} disabled={updating} onChange={(event) => setSlot(event.target.value)}>
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Box>
                <FileDropZone
                  label={updating ? 'New COCO JSON (optional)' : 'COCO JSON'}
                  hint={`${describeUpload('coco')}, exported from the annotation tool`}
                  kind="coco"
                  file={cocoFile}
                  disabled={busy}
                  onChange={setCocoFile}
                />
                {error ? (
                  <Text role="alert" fontFamily={FONT} fontSize="13px" color="#B91C1C">
                    {error}
                  </Text>
                ) : null}
              </Flex>
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px" flexWrap="wrap">
              <ActionButton onClick={onClose} disabled={busy}>
                Cancel
              </ActionButton>
              <ActionButton
                tone="primary"
                loading={busy}
                disabled={!canSave}
                onClick={() => onSave({ slot, file: null, cocoFile })}
              >
                {updating ? 'Save changes' : 'Upload'}
              </ActionButton>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" disabled={busy} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

/**
 * Color lots on a map with no COCO JSON: upload the outlines first (the
 * accurate way, and the only one that updates lot statuses), or color by
 * clicking alone, after a plain warning about what that gives up.
 */
function ColorChoiceDialog({ label, hasMap, ActionButton, onUpload, onFreehand, onClose }) {
  const option = { direction: 'column', gap: '4px', p: '12px', borderRadius: '10px', border: '1px solid', borderColor: COLORS.border }
  return (
    // No focus hand-back on close: the dialog it opens next would take that as focus leaving it, and close.
    <Dialog.Root open onOpenChange={({ open: next }) => (next ? null : onClose())} placement="center" size="sm" restoreFocus={false}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px">
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="18px" color={COLORS.heading}>
                Color lots
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Text mb="12px" fontFamily={FONT} fontSize="13px" color={COLORS.heading}>
                The <b>{label}</b> map has no lot outlines (COCO JSON) yet. How do you want to color it?
              </Text>
              <Flex direction="column" gap="10px">
                <Flex {...option}>
                  <Flex align="center" justify="space-between" gap="8px" flexWrap="wrap">
                    <Text fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>
                      Upload COCO JSON first · Recommended
                    </Text>
                    <ActionButton tone="primary" icon={LuUpload} onClick={onUpload}>
                      Upload
                    </ActionButton>
                  </Flex>
                  <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
                    Each lot is colored exactly inside its outline, and saving also updates the lot statuses in the table.
                  </Text>
                </Flex>
                <Flex {...option} borderColor="#F5C77E" bg="#FFF7E6">
                  <Flex align="center" justify="space-between" gap="8px" flexWrap="wrap">
                    <Text fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>
                      Color without COCO JSON
                    </Text>
                    <ActionButton icon={LuMousePointerClick} disabled={!hasMap} onClick={onFreehand}>
                      Color anyway
                    </ActionButton>
                  </Flex>
                  <Flex gap="6px" align="flex-start">
                    <Icon as={LuTriangleAlert} boxSize="14px" color="#B45309" mt="2px" flexShrink={0} />
                    <Text fontFamily={FONT} fontSize="12px" color="#7C2D12">
                      {hasMap ? FREEHAND_WARNING : 'This tab has no map image yet — add one first.'}
                    </Text>
                  </Flex>
                </Flex>
              </Flex>
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px">
              <ActionButton onClick={onClose}>Cancel</ActionButton>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

/** Deleting removes the row and its stored file, so it is confirmed first. */
function ConfirmDeleteDialog({ label, busy, ActionButton, onClose, onConfirm }) {
  return (
    <Dialog.Root
      open
      onOpenChange={({ open: next }) => {
        if (!next && !busy) onClose()
      }}
      placement="center"
      size="sm"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px">
              <Dialog.Title
                fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
                fontSize="18px"
                color={COLORS.heading}
              >
                Delete annotations
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Text fontFamily={FONT} fontSize="13px" color={COLORS.heading}>
                The COCO JSON for <b>{label}</b> and any image attached to it will be removed. This cannot be undone.
              </Text>
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px">
              <ActionButton onClick={onClose} disabled={busy}>
                Cancel
              </ActionButton>
              <ActionButton tone="primary" icon={LuTrash2} loading={busy} disabled={busy} onClick={onConfirm}>
                Delete
              </ActionButton>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" disabled={busy} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
