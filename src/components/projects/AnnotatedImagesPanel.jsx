import { useMemo, useRef, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, NativeSelect, Portal, Text } from '@chakra-ui/react'
import { LuExpand, LuImagePlus, LuPencil, LuScanEye, LuShapes, LuTrash2, LuUpload, LuX } from 'react-icons/lu'
import EmptyState from '@/components/EmptyState'
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

/**
 * Upload, update, and delete the annotations of one project — a COCO JSON per
 * phase describing its lot polygons, with an optional image to show them on.
 *
 * `ActionButton` and `onOpenFullscreen` come from ProjectMapView, so this tab
 * looks and behaves like the map tabs beside it.
 */
/**
 * The row's picture, falling back to the project's own map for the slot when the
 * stored link no longer loads — a row can outlive the image it points at, and a
 * map that is still there reads better than a broken thumbnail. This is the same
 * picture Preview resolves, so the two agree.
 */
function Thumbnail({ url, projectCode, slot, alt }) {
  const [src, setSrc] = useState(url)
  const [failed, setFailed] = useState(false)
  // A new link (after a replace) is worth trying again.
  const [lastUrl, setLastUrl] = useState(url)
  if (lastUrl !== url) {
    setLastUrl(url)
    setSrc(url)
    setFailed(false)
  }

  async function onError() {
    if (failed) return
    setFailed(true)
    const fallback = await fetchMapImageUrl({ projectCode, slot })
    if (fallback && fallback !== src) setSrc(fallback)
  }

  const box = { w: '88px', h: '60px', borderRadius: '8px', bg: COLORS.canvas, flexShrink: 0 }
  if (failed && src === url) {
    // Nothing to show it with: the map tab has no picture for this slot either.
    return (
      <Flex align="center" justify="center" {...box}>
        <Icon as={LuShapes} boxSize="18px" color={COLORS.subtle} />
      </Flex>
    )
  }
  return <Box as="img" src={src} alt={alt} objectFit="cover" onError={onError} {...box} />
}

export default function AnnotatedImagesPanel({
  projectCode,
  projectName,
  projectId,
  // The map tabs, as [{ value, label }] — what a slot can be and what it is called.
  slots = [],
  ActionButton,
  onOpenFullscreen,
}) {
  const query = useMemo(() => ({ projectCode }), [projectCode])
  const { data, loading, reload } = useApiQuery(fetchAnnotatedImages, query)
  const [editing, setEditing] = useState(null) // null | { image } — image null when adding
  const [confirming, setConfirming] = useState(null)
  // { image, url } — the url is the project's own map, resolved when it opens.
  const [previewing, setPreviewing] = useState(null)
  const [fitError, setFitError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [busy, setBusy] = useState('') // '' | 'save' | 'delete'
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const images = data?.images ?? []
  /*
   * Uploading is offered whenever there is a database to upload to. The table
   * itself may still be missing — the migration not yet run — which reads as
   * UNAVAILABLE; hiding the button then would leave the tab with no way forward,
   * whereas saving says exactly which migration to run.
   */
  const canEdit = data?.source !== SOURCE.NOT_CONFIGURED && Boolean(projectCode)

  const openUpload = () => {
    setError('')
    setEditing({ image: null })
  }

  /*
   * The preview draws the map that `uploads` holds for this slot, not a copy —
   * so it shows what the map tab shows, and the fitting it does is against the
   * picture that is actually in use. The row's own link stands in for a slot with
   * no map of its own, or while the lookup is in flight.
   */
  async function openPreview(image) {
    setFitError('')
    setPreviewing({ image, url: image.url })
    const url = await fetchMapImageUrl({ projectCode, slot: image.slot })
    if (url) setPreviewing((current) => (current?.image.id === image.id ? { image, url } : current))
  }

  async function save({ slot, file, cocoFile }) {
    setBusy('save')
    setError('')
    setNotice('')
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
      await saveAnnotatedImage({ projectCode, slot, file, coco, existing, imageUrl: synced?.url ?? '' })
      setEditing(null)
      setNotice(
        synced?.resized
          ? `Annotations saved, and the ${name} map was resized to ${synced.size.width} × ${synced.size.height} to match.`
          : existing
            ? 'Annotations updated.'
            : 'Annotations uploaded.',
      )
      reload()
    } catch (err) {
      setError(err.message)
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
  const loadLots = (image) => fetchLotsByIdentifier(projectCode, { phase: parseSlot(image.slot).phase })

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
    setNotice('')
    try {
      const url = await uploadMapImage({ projectCode, projectId, slot: image.slot, file })
      if (url) await saveAnnotatedImage({ projectCode, slot: image.slot, existing: image, imageUrl: url })
      const { updated, failed } = await updateLotStatuses(changes, projectCode)
      const name = slotLabel(image.slot, slots)
      setNotice(
        `The colored map was saved — the ${name} map tab now shows it` +
          (updated ? `, and ${updated} lot status${updated === 1 ? ' was' : 'es were'} updated in the table.` : '.'),
      )
      if (url) setPreviewing((current) => (current?.image.id === image.id ? { image: { ...current.image, url }, url } : current))
      reload()
      return { failed }
    } catch (err) {
      setUploadError(err.message)
      throw err
    } finally {
      setBusy('')
    }
  }

  async function refit(image, size) {
    setBusy('fit')
    setFitError('')
    setNotice('')
    try {
      const synced = await syncMapImage({
        projectCode,
        projectId,
        slot: image.slot,
        slotName: slotLabel(image.slot, slots),
        coco: image.coco,
      })
      await saveAnnotatedImage({ projectCode, slot: image.slot, existing: image, imageUrl: synced.url })
      setNotice(`The map was resized to ${size.width} × ${size.height} in the uploads table and now matches.`)
      setPreviewing(null)
      reload()
    } catch (err) {
      setFitError(err.message)
    } finally {
      setBusy('')
    }
  }

  async function remove(image) {
    setBusy('delete')
    setError('')
    setNotice('')
    try {
      await deleteAnnotatedImage(image)
      setNotice('Annotated image deleted.')
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setConfirming(null)
      setBusy('')
    }
  }

  return (
    <Box>
      <Flex align="center" justify="space-between" gap="12px" mb="12px" flexWrap="wrap">
        {/*
          * While images exist the button lives up here; with none it moves into
          * the empty state below, where there is nothing else to look at.
          */}
        {canEdit && images.length ? (
          <ActionButton tone="primary" icon={LuImagePlus} disabled={Boolean(busy)} onClick={openUpload}>
            Upload COCO JSON
          </ActionButton>
        ) : null}
      </Flex>

      {notice ? (
        <Text role="status" mb="12px" fontFamily={FONT} fontSize="13px" color={COLORS.brandGreen}>
          {notice}
        </Text>
      ) : null}
      {error && !editing ? (
        <Text role="alert" mb="12px" fontFamily={FONT} fontSize="13px" color="#B91C1C">
          {error}
        </Text>
      ) : null}

      {images.length ? (
        <Flex direction="column" gap="12px" opacity={loading ? 0.6 : 1} transition="opacity 120ms ease">
          {images.map((image) => (
            <Flex
              key={image.id}
              align="center"
              gap="12px"
              p="10px"
              flexWrap="wrap"
              border="1px solid"
              borderColor={COLORS.border}
              borderRadius="10px"
            >
              {image.url ? (
                <Thumbnail
                  url={image.url}
                  projectCode={projectCode}
                  slot={image.slot}
                  alt={`${projectName || projectCode} — ${slotLabel(image.slot, slots)} annotated map`}
                />
              ) : (
                // Annotations with no picture attached yet.
                <Flex
                  align="center"
                  justify="center"
                  w="88px"
                  h="60px"
                  borderRadius="8px"
                  bg={COLORS.canvas}
                  flexShrink={0}
                >
                  <Icon as={LuShapes} boxSize="18px" color={COLORS.subtle} />
                </Flex>
              )}
              <Box flex="1" minW="160px">
                <Text fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>
                  {slotLabel(image.slot, slots)}
                </Text>
                <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
                  {`${image.annotations} annotation${image.annotations === 1 ? '' : 's'}`}
                  {image.url ? '' : ' · no image'}
                  {image.updatedAt ? ` · updated ${image.updatedAt.slice(0, 10)}` : ''}
                </Text>
              </Box>
              <Flex align="center" gap="8px" flexWrap="wrap">
                {image.coco ? (
                  <ActionButton icon={LuScanEye} onClick={() => openPreview(image)}>
                    Preview
                  </ActionButton>
                ) : null}
                {image.url ? (
                  <ActionButton icon={LuExpand} onClick={() => onOpenFullscreen?.(image, slotLabel(image.slot, slots))}>
                    Open full size
                  </ActionButton>
                ) : null}
                {canEdit ? (
                  <>
                    <ActionButton
                      icon={LuPencil}
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setError('')
                        setEditing({ image })
                      }}
                    >
                      Update
                    </ActionButton>
                    <ActionButton icon={LuTrash2} disabled={Boolean(busy)} onClick={() => setConfirming(image)}>
                      Delete
                    </ActionButton>
                  </>
                ) : null}
              </Flex>
            </Flex>
          ))}
        </Flex>
      ) : (
        <EmptyState
          icon={LuShapes}
          title="No annotated images yet"
          hint={
            // A database that cannot be read says why, rather than looking like
            // nothing has been uploaded.
            data?.message
              ? data.message
              : canEdit
                ? `Upload the COCO JSON of ${projectName || projectCode}'s lot polygons — the map on its tab is used as the picture.`
                : 'Annotated images load once the database is connected.'
          }
        >
          {canEdit ? (
            <Box mt="6px">
              <ActionButton tone="primary" icon={LuImagePlus} disabled={Boolean(busy)} onClick={openUpload}>
                Upload COCO JSON
              </ActionButton>
            </Box>
          ) : null}
        </EmptyState>
      )}

      {previewing ? (
        <AnnotatedImagePreview
          open
          title={`${projectName || projectCode} — ${slotLabel(previewing.image.slot, slots)}`}
          url={previewing.url}
          coco={previewing.image.coco}
          fitting={busy === 'fit'}
          fitError={fitError}
          onFitImage={(size) => refit(previewing.image, size)}
          loadLots={canEdit ? () => loadLots(previewing.image) : undefined}
          onSaveUpdate={canEdit ? (update) => saveColoredUpdate(previewing.image, update) : undefined}
          saving={busy === 'upload'}
          saveError={uploadError}
          onClose={() => {
            setPreviewing(null)
            setFitError('')
            setUploadError('')
          }}
        />
      ) : null}

      {editing ? (
        <AnnotatedImageDialog
          image={editing.image}
          slots={slots}
          taken={images.map((image) => image.slot)}
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
    </Box>
  )
}

/**
 * A file field a file can be dropped on, or clicked to browse.
 *
 * `accept` is passed to the file input, and `matches` decides what a drop is
 * allowed to be — a drop is not filtered by the browser the way the picker is,
 * so a .png dragged onto the JSON field has to be turned away here, with a
 * reason, rather than silently taken.
 */
function FileDropZone({ label, hint, accept, matches, file, disabled, onChange }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)
  const [rejected, setRejected] = useState('')

  function take(chosen) {
    if (!chosen) return
    if (matches && !matches(chosen)) {
      setRejected(`"${chosen.name}" is not the right kind of file here.`)
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

const isJson = (file) => file.type === 'application/json' || /\.json$/i.test(file.name)
const isImage = (file) => file.type.startsWith('image/')

/**
 * Upload or update one annotated image. Adding needs the image itself; updating
 * can change the image, the COCO JSON, or both, so either file may be left empty
 * and whatever is stored survives.
 *
 * The slot cannot be changed while updating: it is what identifies the row, and
 * moving annotations to another map is an upload onto that map.
 */
function AnnotatedImageDialog({ image, slots, taken, busy, error, ActionButton, onClose, onSave }) {
  // The map tabs are the choice — the same list, in the same words, as the tabs
  // across the top, so the annotations land on a map that actually exists.
  const options = slots.length ? slots : [{ value: 'whole', label: 'Whole Map' }]
  const updating = Boolean(image)
  const [slot, setSlot] = useState(image?.slot ?? options[0].value)
  const [file, setFile] = useState(null)
  const [cocoFile, setCocoFile] = useState(null)

  // Uploading onto a slot that already has annotations replaces them — worth
  // saying so beforehand rather than after.
  const replaces = !updating && taken.includes(slot)
  const canSave = !busy && Boolean(slot) && (updating ? Boolean(file || cocoFile) : Boolean(cocoFile))
  const slotName = options.find((option) => option.value === slot)?.label ?? slot

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
                {updating ? 'Update annotations' : 'Upload annotations'}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Flex direction="column" gap="14px">
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
                  hint=".json exported from the annotation tool"
                  accept="application/json,.json"
                  matches={isJson}
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
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px">
              <ActionButton onClick={onClose} disabled={busy}>
                Cancel
              </ActionButton>
              <ActionButton
                tone="primary"
                loading={busy}
                disabled={!canSave}
                onClick={() => onSave({ slot, file, cocoFile })}
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
