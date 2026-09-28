import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Portal, SimpleGrid, Spinner, Text } from '@chakra-ui/react'
import {
  LuCheck,
  LuListChecks,
  LuChevronLeft,
  LuChevronRight,
  LuExpand,
  LuImagePlus,
  LuImages,
  LuRefreshCw,
  LuTrash2,
  LuX,
} from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import RefreshButton from '@/components/ui-kit/RefreshButton'
import { GallerySkeleton } from '@/components/skeletons/ProjectViewSkeletons'
import EmptyState from '@/components/EmptyState'
import { FullscreenImageDialog, ZoomableImage } from '@/components/projects/ProjectMapView'
import useApiQuery from '@/hooks/useApiQuery'
import { DEV_GALLERIES, deleteDevImage, fetchDevImages, replaceDevImage, uploadDevImage } from '@/data/devImagesData'
import { COLORS } from '@/theme/colors'
import { formatDate } from '@/utils/format'
import { notifyFailed, notifySaved } from '@/lib/notify'
import { acceptFor, describeUpload, uploadProblem } from '@/lib/uploadRules'

const FONT = 'Inter, system-ui, sans-serif'

export function DevGalleryDialog({ open, onClose, gallery, projectCode, projectName }) {
  const title = DEV_GALLERIES[gallery]?.title ?? 'Project images'

  return (
    <Dialog.Root open={open} onOpenChange={({ open: nextOpen }) => { if (!nextOpen) onClose?.() }} placement="center" size="xl">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner p={{ base: '12px', md: '24px' }}>
          <Dialog.Content maxH="calc(100dvh - 48px)" borderRadius="16px" overflow="hidden">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} pr="56px">
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="19px" color={COLORS.heading}>
                {title}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body p={{ base: '14px', md: '20px' }} overflowY="auto">
              {open ? (
                <DevGalleryView
                  key={`${gallery}:${projectCode}`}
                  gallery={gallery}
                  projectCode={projectCode}
                  projectName={projectName}
                />
              ) : null}
            </Dialog.Body>
            <Dialog.CloseTrigger asChild top="12px" right="12px">
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

function Button({ icon, children, tone = 'neutral', loading, ...rest }) {
  const tones = {
    neutral: { bg: COLORS.surface, color: COLORS.heading, borderColor: COLORS.border, hover: COLORS.hoverBg },
    primary: { bg: COLORS.brandGreen, color: '#FFFFFF', borderColor: COLORS.brandGreen, hover: '#00541F' },
    danger: { bg: '#DC2626', color: '#FFFFFF', borderColor: '#DC2626', hover: '#B91C1C' },
    dangerGhost: { bg: COLORS.surface, color: '#B91C1C', borderColor: COLORS.border, hover: '#FDECEC' },
  }
  const { hover, ...style } = tones[tone]
  return (
    <Flex
      as="button"
      type="button"
      align="center"
      justify="center"
      gap="6px"
      h="34px"
      px={children ? '12px' : '0'}
      minW="34px"
      borderRadius="8px"
      border="1px solid"
      fontFamily={FONT}
      fontWeight="600"
      fontSize="13px"
      cursor="pointer"
      flexShrink={0}
      _hover={{ bg: hover }}
      _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      {...style}
      {...rest}
    >
      {loading ? <Spinner size="xs" /> : icon ? <Icon as={icon} boxSize="15px" /> : null}
      {children}
    </Flex>
  )
}

const fileKey = (file) => `${file.name}:${file.size}:${file.lastModified}`

/** Thumbnail for a not-yet-uploaded file; the object URL is released on unmount. */
function FilePreview({ file, onRemove, disabled }) {
  // A data URL rather than an object URL: StrictMode's mount/unmount/mount would
  // revoke a memoised object URL before the <img> could load it.
  const [preview, setPreview] = useState({ file: null, url: '' })
  useEffect(() => {
    const reader = new FileReader()
    reader.onload = () => setPreview({ file, url: String(reader.result) })
    reader.readAsDataURL(file)
    return () => reader.abort()
  }, [file])
  const url = preview.file === file ? preview.url : ''

  return (
    <Box position="relative" borderRadius="8px" overflow="hidden" border="1px solid" borderColor={COLORS.border} bg={COLORS.canvas}>
      {url ? <Box as="img" src={url} alt="" display="block" w="100%" aspectRatio="1" objectFit="cover" /> : <Box aspectRatio="1" />}
      <Text px="6px" py="4px" fontFamily={FONT} fontSize="11px" color={COLORS.muted} truncate title={file.name} bg={COLORS.surface}>
        {file.name}
      </Text>
      <Flex
        as="button"
        type="button"
        aria-label={`Remove ${file.name}`}
        position="absolute"
        top="4px"
        right="4px"
        boxSize="22px"
        align="center"
        justify="center"
        borderRadius="full"
        bg="rgba(11,28,48,0.7)"
        color="#FFFFFF"
        cursor="pointer"
        disabled={disabled}
        _hover={{ bg: 'rgba(11,28,48,0.9)' }}
        _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
        onClick={onRemove}
      >
        <Icon as={LuX} boxSize="13px" />
      </Flex>
    </Box>
  )
}

/**
 * Bulk upload: drag and drop or browse for images, review them, then upload.
 * `onUpload(files)` resolves the files that failed, which stay listed for a retry.
 */
function UploadImagesDialog({ open, title, busy, progress, error, onClose, onUpload }) {
  const [files, setFiles] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [rejected, setRejected] = useState(0)
  const input = useRef(null)

  function addFiles(list) {
    const incoming = [...(list ?? [])]
    const images = incoming.filter((file) => !uploadProblem('photo', file))
    setRejected(incoming.length - images.length)
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey))
      return [...prev, ...images.filter((file) => !seen.has(fileKey(file)))]
    })
  }

  function reset() {
    setFiles([])
    setRejected(0)
    setDragOver(false)
  }

  async function handleUpload() {
    const failed = await onUpload(files)
    setFiles(failed)
    if (!failed.length) reset()
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next && !busy) {
          reset()
          onClose()
        }
      }}
      placement="center"
      size="lg"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px" maxH="calc(100dvh - 32px)">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px" pr="56px">
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="18px" color={COLORS.heading}>
                Upload {title} Images
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Flex
                as="button"
                type="button"
                direction="column"
                align="center"
                justify="center"
                gap="6px"
                w="100%"
                minH={files.length ? '150px' : '240px'}
                px="16px"
                borderRadius="12px"
                border="2px dashed"
                borderColor={dragOver ? COLORS.activeBg : '#9AA3AF'}
                bg={dragOver ? COLORS.statusBg : COLORS.surface}
                cursor={busy ? 'not-allowed' : 'pointer'}
                transition="background-color 120ms ease, border-color 120ms ease, min-height 160ms ease"
                disabled={busy}
                onClick={() => input.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  if (!busy) setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragOver(false)
                  if (!busy) addFiles(event.dataTransfer.files)
                }}
                _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
              >
                <Icon as={LuImages} boxSize="40px" color={COLORS.subtle} mb="6px" />
                <Text fontFamily={FONT} fontSize="16px" color={COLORS.heading}>
                  Drag and drop images here
                </Text>
                <Text fontFamily={FONT} fontSize="14px" color={COLORS.subtle}>
                  or click to browse
                </Text>
                <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
                  {describeUpload('photo')} each
                </Text>
              </Flex>
              <input
                ref={input}
                type="file"
                accept={acceptFor('photo')}
                multiple
                hidden
                onChange={(event) => {
                  addFiles(event.target.files)
                  event.target.value = ''
                }}
              />

              {rejected ? (
                <Text mt="10px" fontFamily={FONT} fontSize="12.5px" color="#92400E">
                  {rejected} {rejected === 1 ? 'file was' : 'files were'} skipped. Only {describeUpload('photo')} images can be uploaded.
                </Text>
              ) : null}

              {files.length ? (
                <>
                  <Text mt="14px" mb="8px" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>
                    {files.length} {files.length === 1 ? 'image' : 'images'} selected
                  </Text>
                  <SimpleGrid columns={{ base: 3, sm: 4, md: 6 }} gap="8px" maxH="260px" overflowY="auto">
                    {files.map((file) => (
                      <FilePreview
                        key={fileKey(file)}
                        file={file}
                        disabled={busy}
                        onRemove={() => setFiles((prev) => prev.filter((item) => item !== file))}
                      />
                    ))}
                  </SimpleGrid>
                </>
              ) : null}

              {error ? (
                <Text role="alert" mt="12px" fontFamily={FONT} fontSize="13px" color="#B91C1C">
                  {error}
                </Text>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px">
              <Button disabled={busy || !files.length} onClick={reset}>
                Clear
              </Button>
              <Button tone="primary" loading={busy} disabled={busy || !files.length} onClick={handleUpload}>
                {busy && progress ? progress : files.length > 1 ? `Upload ${files.length} images` : 'Upload'}
              </Button>
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

function ConfirmDeleteDialog({ images, busy, progress, error, onCancel, onConfirm }) {
  const count = images?.length ?? 0
  const image = count === 1 ? images[0] : null
  return (
    <Dialog.Root
      open={count > 0}
      onOpenChange={({ open }) => {
        if (!open && !busy) onCancel()
      }}
      placement="center"
      size="sm"
      role="alertdialog"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content borderRadius="16px">
            <Dialog.Header py="16px">
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="17px" color={COLORS.heading}>
                {count > 1 ? `Delete ${count} images?` : 'Delete this image?'}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body pb="8px">
              {image ? (
                <Box
                  as="img"
                  src={image.url}
                  alt=""
                  w="100%"
                  maxH="180px"
                  objectFit="contain"
                  borderRadius="8px"
                  bg={COLORS.canvas}
                  mb="12px"
                />
              ) : null}
              {count > 1 ? (
                <Flex gap="6px" wrap="wrap" mb="12px">
                  {images.slice(0, 8).map((item) => (
                    <Box key={item.id} as="img" src={item.url} alt="" boxSize="52px" objectFit="cover" borderRadius="6px" />
                  ))}
                  {count > 8 ? (
                    <Flex boxSize="52px" align="center" justify="center" borderRadius="6px" bg={COLORS.hoverBg} fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
                      +{count - 8}
                    </Flex>
                  ) : null}
                </Flex>
              ) : null}
              <Text fontFamily={FONT} fontSize="13px" color={COLORS.muted}>
                {count > 1 ? 'Each image file is' : 'The image file is'} removed from storage and{' '}
                {count > 1 ? 'their records are' : 'its record is'} deleted from the table. This cannot be undone.
              </Text>
              {error ? (
                <Text role="alert" mt="10px" fontFamily={FONT} fontSize="13px" color="#B91C1C">
                  {error}
                </Text>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer py="14px" gap="10px">
              <Button onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button tone="danger" icon={LuTrash2} loading={busy} disabled={busy} onClick={onConfirm}>
                {busy && progress ? progress : count > 1 ? `Delete ${count} images` : 'Delete image'}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

/**
 * Photo gallery for one project from `project_dev` or `future_dev`: a thumbnail
 * grid, newest first, with a drag-and-zoom viewer. Images can be uploaded,
 * replaced (old file and row deleted first) and deleted (file and row).
 */
export default function DevGalleryView({ gallery, projectCode, projectName }) {
  const [openIndex, setOpenIndex] = useState(null)
  const [busy, setBusy] = useState('') // '' | 'upload' | 'replace:<id>' | 'delete'
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // array of images awaiting confirmation
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [progress, setProgress] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(null) // the image shown in the fullscreen modal
  const replaceInput = useRef(null)
  const replaceTarget = useRef(null)
  const title = DEV_GALLERIES[gallery]?.title ?? ''

  const query = useMemo(() => ({ gallery, projectCode }), [gallery, projectCode])
  const { data, loading, reload, refresh } = useApiQuery(fetchDevImages, query)
  const images = data?.images ?? []
  const current = openIndex === null ? null : images[openIndex]
  const canEdit = data?.source === 'database' && Boolean(projectCode)
  const projectLabel = data?.projectLabel ?? ''

  async function run(kind, action, success) {
    setBusy(kind)
    setError('')
    try {
      const result = await action()
      const message = typeof result === 'string' ? result : success
      notifySaved(message.replace(/\.$/, ''))
      reload()
      return true
    } catch (err) {
      setError(err.message)
      notifyFailed(kind === 'upload' ? 'Upload failed' : kind === 'delete' ? 'Delete failed' : 'Replace failed', err)
      // A replace can fail after the old image was deleted; re-read so the grid is accurate.
      reload()
      return false
    } finally {
      setBusy('')
      setProgress('')
    }
  }

  /**
   * Run `task` on each item in turn, carrying on past failures. Resolves the
   * items that failed with their reasons; `verb` labels the progress text.
   */
  async function eachWithProgress(items, verb, task) {
    const failures = []
    for (let i = 0; i < items.length; i += 1) {
      setProgress(items.length > 1 ? `${verb} ${i + 1} of ${items.length}…` : '')
      try {
        await task(items[i])
      } catch (err) {
        failures.push({ item: items[i], reason: err.message })
      }
    }
    return failures
  }

  const failureSummary = (done, total, noun, failures, nameOf) =>
    `${done} of ${total} ${noun} succeeded. Failed: ${failures
      .slice(0, 5)
      .map((failure) => `${nameOf(failure.item)} (${failure.reason})`)
      .join('; ')}${failures.length > 5 ? `; and ${failures.length - 5} more` : ''}`

  /** Upload `files`; resolves the files that failed (empty when all succeeded). */
  async function handleUpload(files) {
    if (!files.length) return []
    let failedFiles = []
    await run(
      'upload',
      async () => {
        const failures = await eachWithProgress(files, 'Uploading', (file) =>
          uploadDevImage({ gallery, projectCode, projectLabel, file }),
        )
        failedFiles = failures.map((failure) => failure.item)
        if (failures.length) {
          throw new Error(failureSummary(files.length - failures.length, files.length, 'uploads', failures, (file) => file.name))
        }
        return files.length === 1 ? 'Image uploaded.' : `${files.length} images uploaded.`
      },
      'Image uploaded.',
    )
    return failedFiles
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function stopSelecting() {
    setSelecting(false)
    setSelected(new Set())
  }

  function startReplace(image) {
    replaceTarget.current = image
    replaceInput.current?.click()
  }

  async function handleReplace(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    const image = replaceTarget.current
    if (!file || !image) return
    const ok = await run(
      `replace:${image.id}`,
      () => replaceDevImage({ gallery, projectCode, projectLabel, image, file }),
      'Image replaced.',
    )
    // The new image is the newest, so it moves to the front of the grid.
    if (ok && openIndex !== null) setOpenIndex(0)
  }

  async function handleDelete() {
    const targets = confirmDelete ?? []
    let failedIds = new Set()
    const ok = await run(
      'delete',
      async () => {
        const failures = await eachWithProgress(targets, 'Deleting', (image) => deleteDevImage({ gallery, image }))
        failedIds = new Set(failures.map((failure) => failure.item.id))
        if (failures.length) {
          throw new Error(
            failureSummary(targets.length - failures.length, targets.length, 'deletes', failures, (image) =>
              decodeURIComponent(image.url.split('/').pop() ?? '').replace(/^\d+_[a-z0-9]+_/, ''),
            ),
          )
        }
        return targets.length === 1 ? 'Image deleted.' : `${targets.length} images deleted.`
      },
      'Image deleted.',
    )
    setConfirmDelete(null)
    setOpenIndex(null)
    // Keep only the images that could not be deleted selected, so they can be retried.
    if (ok) stopSelecting()
    else setSelected(failedIds)
  }

  if (loading && !data) return <GallerySkeleton />

  const tileActions = (image) =>
    canEdit ? (
      <Flex gap="6px">
        <Button
          icon={LuRefreshCw}
          aria-label="Replace image"
          title="Replace image"
          loading={busy === `replace:${image.id}`}
          disabled={Boolean(busy)}
          onClick={() => startReplace(image)}
        />
        <Button
          tone="dangerGhost"
          icon={LuTrash2}
          aria-label="Delete image"
          title="Delete image"
          disabled={Boolean(busy)}
          onClick={() => {
            setError('')
            setConfirmDelete([image])
          }}
        />
      </Flex>
    ) : null

  const allSelected = images.length > 0 && selected.size === images.length

  return (
    <Card>
      <Flex align="center" justify="space-between" gap="12px" mb="14px" flexWrap="wrap">
        <Flex align="baseline" gap="10px" wrap="wrap">
          <Text fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontWeight="700" fontSize="16px" color={COLORS.heading}>
            {title}
          </Text>
          {images.length ? (
            <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
              {images.length} {images.length === 1 ? 'image' : 'images'}
            </Text>
          ) : null}
        </Flex>
        <Flex gap="8px" wrap="wrap">
            <RefreshButton onRefresh={refresh} label="Refresh images" size="34px" />
            {!canEdit ? null : selecting ? (
              <>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => setSelected(allSelected ? new Set() : new Set(images.map((image) => image.id)))}
                >
                  {allSelected ? 'Clear selection' : 'Select all'}
                </Button>
                <Button
                  tone="danger"
                  icon={LuTrash2}
                  disabled={Boolean(busy) || selected.size === 0}
                  onClick={() => {
                    setError('')
                    setConfirmDelete(images.filter((image) => selected.has(image.id)))
                  }}
                >
                  Delete selected ({selected.size})
                </Button>
                <Button disabled={Boolean(busy)} onClick={stopSelecting}>
                  Done
                </Button>
              </>
            ) : (
              <>
                {images.length ? (
                  <Button icon={LuListChecks} disabled={Boolean(busy)} onClick={() => setSelecting(true)}>
                    Select
                  </Button>
                ) : null}
                <Button
                  tone="primary"
                  icon={LuImagePlus}
                  loading={busy === 'upload'}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setError('')
                    setUploadOpen(true)
                  }}
                >
                  {busy === 'upload' && progress ? progress : 'Upload images'}
                </Button>
              </>
            )}
        </Flex>
        <input ref={replaceInput} type="file" accept={acceptFor('photo')} hidden onChange={handleReplace} />
      </Flex>

      {error && !confirmDelete ? (
        <Text role="alert" mb="12px" fontFamily={FONT} fontSize="13px" color="#B91C1C">
          {error}
        </Text>
      ) : null}

      {images.length === 0 ? (
        <EmptyState
          icon={LuImages}
          title={`No ${title.toLowerCase()} images yet`}
          hint={
            !data || data.source !== 'database'
              ? 'Images load from Supabase once the database is connected.'
              : `Use "Upload image" to add images for ${projectName || projectCode}.`
          }
        />
      ) : (
        <SimpleGrid columns={{ base: 2, md: 3, xl: 4 }} gap="12px" opacity={loading ? 0.6 : 1} transition="opacity 120ms ease">
          {images.map((image, index) => {
            const isSelected = selected.has(image.id)
            return (
            <Box
              key={image.id}
              position="relative"
              borderRadius="10px"
              overflow="hidden"
              border="2px solid"
              borderColor={selecting && isSelected ? COLORS.activeBg : COLORS.border}
              bg={COLORS.surface}
              transition="box-shadow 120ms ease, border-color 120ms ease"
              _hover={{ boxShadow: '0 4px 14px rgba(11,28,48,0.12)' }}
            >
              {selecting ? (
                <Flex
                  position="absolute"
                  top="8px"
                  left="8px"
                  zIndex={1}
                  boxSize="22px"
                  align="center"
                  justify="center"
                  borderRadius="6px"
                  border="2px solid"
                  borderColor={isSelected ? COLORS.activeBg : '#FFFFFF'}
                  bg={isSelected ? COLORS.activeBg : 'rgba(11,28,48,0.35)'}
                  pointerEvents="none"
                >
                  {isSelected ? <Icon as={LuCheck} boxSize="14px" color="#FFFFFF" /> : null}
                </Flex>
              ) : null}
              <Box
                as="button"
                type="button"
                display="block"
                w="100%"
                cursor={selecting ? 'pointer' : 'zoom-in'}
                bg={COLORS.canvas}
                onClick={() => (selecting ? toggleSelected(image.id) : setOpenIndex(index))}
                aria-label={selecting ? `Select ${title} image ${index + 1}` : `Open ${title} image ${index + 1}`}
                aria-pressed={selecting ? isSelected : undefined}
                opacity={selecting && !isSelected ? 0.85 : 1}
                _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '-2px' }}
              >
                <Box
                  as="img"
                  src={image.url}
                  alt=""
                  loading="lazy"
                  display="block"
                  w="100%"
                  aspectRatio="4 / 3"
                  objectFit="cover"
                />
              </Box>
              <Flex align="center" justify="space-between" gap="8px" px="10px" py="6px" minH="46px">
                <Text fontFamily={FONT} fontSize="11.5px" color={COLORS.subtle} truncate>
                  {image.createdAt ? formatDate(image.createdAt) : ''}
                </Text>
                {selecting ? null : tileActions(image)}
              </Flex>
            </Box>
            )
          })}
        </SimpleGrid>
      )}

      <Dialog.Root
        open={Boolean(current) && !confirmDelete}
        onOpenChange={({ open }) => {
          if (!open && !busy) setOpenIndex(null)
        }}
        placement="center"
        size="xl"
        scrollBehavior="inside"
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner px="16px">
            <Dialog.Content
              borderRadius="16px"
              maxH="calc(100dvh - 32px)"
              onKeyDown={(event) => {
                if (busy) return
                if (event.key === 'ArrowLeft' && openIndex > 0) setOpenIndex(openIndex - 1)
                if (event.key === 'ArrowRight' && openIndex < images.length - 1) setOpenIndex(openIndex + 1)
              }}
            >
              <Dialog.Header py="14px" pr="56px">
                <Dialog.Title fontFamily={FONT} fontSize="14px" fontWeight="600" color={COLORS.heading}>
                  {title} · {openIndex === null ? '' : `${openIndex + 1} of ${images.length}`}
                  {current?.createdAt ? (
                    <Text as="span" ml="8px" fontWeight="400" color={COLORS.subtle}>
                      {formatDate(current.createdAt)}
                    </Text>
                  ) : null}
                </Dialog.Title>
              </Dialog.Header>
              <Dialog.Body pb="16px">
                {current ? <ZoomableImage key={current.id} src={current.url} alt={`${title} image ${openIndex + 1}`} /> : null}
                {error ? (
                  <Text role="alert" mt="10px" fontFamily={FONT} fontSize="13px" color="#B91C1C">
                    {error}
                  </Text>
                ) : null}
                <Flex align="center" justify="space-between" mt="12px" gap="10px" wrap="wrap">
                  <Button
                    icon={LuChevronLeft}
                    aria-label="Previous image"
                    disabled={!openIndex || Boolean(busy)}
                    onClick={() => setOpenIndex(openIndex - 1)}
                  />
                  <Flex align="center" gap="8px" wrap="wrap" justify="center">
                    {current ? (
                      <Button icon={LuExpand} onClick={() => setFullscreen(current)}>
                        Open full size
                      </Button>
                    ) : null}
                    {canEdit && current ? (
                      <>
                        <Button
                          icon={LuRefreshCw}
                          loading={busy === `replace:${current.id}`}
                          disabled={Boolean(busy)}
                          onClick={() => startReplace(current)}
                        >
                          Replace image
                        </Button>
                        <Button
                          tone="dangerGhost"
                          icon={LuTrash2}
                          disabled={Boolean(busy)}
                          onClick={() => {
                            setError('')
                            setConfirmDelete([current])
                          }}
                        >
                          Delete
                        </Button>
                      </>
                    ) : null}
                  </Flex>
                  <Button
                    icon={LuChevronRight}
                    aria-label="Next image"
                    disabled={openIndex === null || openIndex >= images.length - 1 || Boolean(busy)}
                    onClick={() => setOpenIndex(openIndex + 1)}
                  />
                </Flex>
              </Dialog.Body>
              <Dialog.CloseTrigger asChild top="10px" right="10px">
                <CloseButton size="sm" disabled={Boolean(busy)} />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      <FullscreenImageDialog
        open={Boolean(fullscreen)}
        src={fullscreen?.url}
        alt={`${title} image`}
        title={title}
        onClose={() => setFullscreen(null)}
      />

      <UploadImagesDialog
        open={uploadOpen}
        title={title}
        busy={busy === 'upload'}
        progress={progress}
        error={uploadOpen ? error : ''}
        onClose={() => {
          setUploadOpen(false)
          setError('')
        }}
        onUpload={async (files) => {
          const failed = await handleUpload(files)
          if (!failed.length) setUploadOpen(false)
          return failed
        }}
      />

      <ConfirmDeleteDialog
        images={confirmDelete}
        busy={busy === 'delete'}
        progress={progress}
        error={confirmDelete ? error : ''}
        onCancel={() => {
          setConfirmDelete(null)
          setError('')
        }}
        onConfirm={handleDelete}
      />
    </Card>
  )
}
