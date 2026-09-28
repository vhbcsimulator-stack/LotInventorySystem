import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  CloseButton,
  Dialog,
  Flex,
  Icon,
  Input,
  NativeSelect,
  Portal,
  Spinner,
  Text,
} from '@chakra-ui/react'
import { LuExpand, LuImagePlus, LuMap, LuRefreshCw, LuZoomIn, LuZoomOut } from 'react-icons/lu'
import { Card } from '@/components/ui-kit/Card'
import { MapViewSkeleton } from '@/components/skeletons/ProjectViewSkeletons'
import SegmentedControl from '@/components/ui-kit/SegmentedControl'
import RefreshButton from '@/components/ui-kit/RefreshButton'
import { Reveal } from '@/components/ui-kit/Reveal'
import AnnotatedImagesPanel from '@/components/projects/AnnotatedImagesPanel'
import EmptyState from '@/components/EmptyState'
import useApiQuery from '@/hooks/useApiQuery'
import { fetchProjectMaps, mapTabValue, saveProjectMap, usesFloors } from '@/data/projectMapsData'
import { refreshTables } from '@/data/queryClient'
import { COLORS } from '@/theme/colors'
import { notifyFailed, notifySaved } from '@/lib/notify'
import { acceptFor, describeUpload, uploadProblem } from '@/lib/uploadRules'

const FONT = 'Inter, system-ui, sans-serif'

function ActionButton({ icon, children, tone = 'neutral', loading, ...rest }) {
  const tones = {
    neutral: { bg: COLORS.surface, color: COLORS.heading, borderColor: COLORS.border, hover: COLORS.hoverBg },
    primary: { bg: COLORS.brandGreen, color: '#FFFFFF', borderColor: COLORS.brandGreen, hover: '#00541F' },
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
      px="12px"
      borderRadius="8px"
      border="1px solid"
      fontFamily={FONT}
      fontWeight="600"
      fontSize="13px"
      cursor="pointer"
      flexShrink={0}
      _hover={{ bg: hover }}
      _disabled={{ opacity: 0.55, cursor: 'not-allowed' }}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      {...style}
      {...rest}
    >
      {loading ? <Spinner size="xs" /> : icon ? <Icon as={icon} boxSize="14px" /> : null}
      {children}
    </Flex>
  )
}

const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25

const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/**
 * Map image in a fixed-height frame with no scrollbars. At 100% the whole image
 * fits the frame; Ctrl + scroll or the buttons zoom, and dragging pans. The pan
 * is clamped so the image edge never leaves the frame.
 */
export function ZoomableImage({ src, alt, height, fill = false }) {
  const [view, setView] = useState({ zoom: ZOOM_MIN, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef(null)
  const imgRef = useRef(null)
  const drag = useRef(null)
  const zoom = view.zoom

  /** Keep the scaled image covering the frame where it is larger than it. */
  function clampPan(next) {
    const frame = frameRef.current
    const img = imgRef.current
    if (!frame || !img) return next
    const maxX = Math.max(0, (img.offsetWidth * next.zoom - frame.clientWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * next.zoom - frame.clientHeight) / 2)
    return {
      zoom: next.zoom,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    }
  }

  /** Zoom to `nextZoom`, keeping the point (px, py) — relative to the frame centre — fixed. */
  function zoomAt(nextZoom, px = 0, py = 0) {
    setView((prev) => {
      const z = clampZoom(typeof nextZoom === 'function' ? nextZoom(prev.zoom) : nextZoom)
      const ratio = z / prev.zoom
      return clampPan({ zoom: z, x: px - (px - prev.x) * ratio, y: py - (py - prev.y) * ratio })
    })
  }
  const change = (delta) => zoomAt((current) => current + delta)

  // Ctrl + wheel zooms toward the cursor. React's onWheel is passive, so the
  // browser's own page zoom can only be blocked with a native listener.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return undefined
    function onWheel(event) {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = frame.getBoundingClientRect()
      const px = event.clientX - rect.left - rect.width / 2
      const py = event.clientY - rect.top - rect.height / 2
      setView((prev) => {
        const z = clampZoom(prev.zoom * Math.exp(-event.deltaY * 0.002))
        const ratio = z / prev.zoom
        return clampPan({ zoom: z, x: px - (px - prev.x) * ratio, y: py - (py - prev.y) * ratio })
      })
    }
    frame.addEventListener('wheel', onWheel, { passive: false })
    return () => frame.removeEventListener('wheel', onWheel)
  }, [])

  function onPointerDown(event) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y }
    setDragging(true)
  }
  function onPointerMove(event) {
    if (!drag.current) return
    const { startX, startY, originX, originY } = drag.current
    setView((prev) => clampPan({ ...prev, x: originX + event.clientX - startX, y: originY + event.clientY - startY }))
  }
  function endDrag() {
    drag.current = null
    setDragging(false)
  }

  const controlStyle = {
    as: 'button',
    type: 'button',
    align: 'center',
    justify: 'center',
    boxSize: '30px',
    borderRadius: '6px',
    color: COLORS.heading,
    cursor: 'pointer',
    _hover: { bg: COLORS.hoverBg },
    _disabled: { opacity: 0.4, cursor: 'not-allowed' },
  }

  return (
    <Box position="relative" h={fill ? '100%' : undefined}>
      <Flex
        ref={frameRef}
        h={height ?? { base: '320px', md: '480px' }}
        align="center"
        justify="center"
        borderRadius="10px"
        border="1px solid"
        borderColor={COLORS.border}
        bg={COLORS.canvas}
        overflow="hidden"
        cursor={dragging ? 'grabbing' : 'grab'}
        userSelect="none"
        touchAction="none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setView({ zoom: ZOOM_MIN, x: 0, y: 0 })}
      >
        <Box
          as="img"
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          display="block"
          maxW="100%"
          maxH="100%"
          objectFit="contain"
          pointerEvents="none"
          transform={`translate(${view.x}px, ${view.y}px) scale(${zoom})`}
          transformOrigin="center"
          transition={dragging ? 'none' : 'transform 80ms ease-out'}
        />
      </Flex>
      <Flex
        position="absolute"
        bottom="10px"
        right="10px"
        align="center"
        gap="2px"
        p="3px"
        bg={COLORS.surface}
        border="1px solid"
        borderColor={COLORS.border}
        borderRadius="8px"
        boxShadow="0 1px 3px rgba(0,0,0,0.08)"
      >
        <Flex {...controlStyle} aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onClick={() => change(-ZOOM_STEP)}>
          <Icon as={LuZoomOut} boxSize="16px" />
        </Flex>
        <Box
          as="button"
          type="button"
          minW="46px"
          fontFamily={FONT}
          fontSize="12px"
          fontWeight="600"
          color={COLORS.heading}
          cursor="pointer"
          title="Reset zoom"
          onClick={() => setView({ zoom: ZOOM_MIN, x: 0, y: 0 })}
        >
          {Math.round(zoom * 100)}%
        </Box>
        <Flex {...controlStyle} aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => change(ZOOM_STEP)}>
          <Icon as={LuZoomIn} boxSize="16px" />
        </Flex>
      </Flex>
    </Box>
  )
}

/** A ZoomableImage filling a fullscreen modal, with the same zoom and drag controls. */
export function FullscreenImageDialog({ open, src, alt, title, onClose }) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next) onClose()
      }}
      placement="center"
      size="full"
      motionPreset="none"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg={COLORS.surface} borderRadius="0" h="100dvh" maxH="100dvh" display="flex" flexDirection="column">
            <Dialog.CloseTrigger asChild>
              <CloseButton position="absolute" top="10px" right="12px" zIndex={2} size="sm" />
            </Dialog.CloseTrigger>
            {title ? (
              <Dialog.Header py="12px" pr="56px">
                <Dialog.Title fontFamily={FONT} fontSize="14px" fontWeight="600" color={COLORS.heading} truncate>
                  {title}
                </Dialog.Title>
              </Dialog.Header>
            ) : null}
            <Dialog.Body flex="1" minH={0} p="12px">
              {open && src ? <ZoomableImage key={src} src={src} alt={alt} height="100%" fill /> : null}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

/** The slot a tab stands for, used as the Add dialog's default. */
function slotForTab(tabValue, floors) {
  if (tabValue === 'commercial') return { kind: 'commercial', phase: '' }
  const match = /^phase-(\d+)(?:-(a|b|c|east))?$/.exec(tabValue ?? '')
  if (match) return { kind: 'phase', phase: match[1], section: match[2] ? match[2].toUpperCase() === 'EAST' ? 'East' : match[2].toUpperCase() : '' }
  // A condominium has no whole-site map, so its default slot is still a floor.
  return floors ? { kind: 'phase', phase: '' } : { kind: 'whole', phase: '' }
}

function AddMapDialog({ open, initialSlot, floors, mvlc, busy, error, onClose, onSave }) {
  const [kind, setKind] = useState(initialSlot.kind)
  const [phase, setPhase] = useState(initialSlot.phase)
  const [section, setSection] = useState(initialSlot.section || 'A')
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState('')

  const unit = floors ? 'Floor' : 'Phase'
  const needsPhase = kind === 'phase'
  const phaseNumber = phase.trim() === '' ? null : Number(phase)
  const allowed = phaseNumber === 1 ? ['A', 'B', 'C', 'East'] : phaseNumber === 2 ? ['A', 'B', 'East'] : []
  const mapSection = mvlc && needsPhase && allowed.length ? (allowed.includes(section) ? section : allowed[0]) : null
  const canSave = file && !busy && (!needsPhase || (Number.isInteger(phaseNumber) && phaseNumber > 0 && (!mvlc || phaseNumber <= 3)))

  const label = (children) => (
    <Text mb="6px" fontFamily={FONT} fontWeight="500" fontSize="13px" color={COLORS.heading}>
      {children}
    </Text>
  )

  return (
    <Dialog.Root
      open={open}
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
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="18px" color={COLORS.heading}>
                Add map
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="18px">
              <Flex direction="column" gap="14px">
                <Box>
                  {label('Map for')}
                  <NativeSelect.Root>
                    <NativeSelect.Field value={kind} onChange={(event) => setKind(event.target.value)}>
                      {floors ? null : <option value="whole">Whole Map</option>}
                      <option value="phase">{unit}</option>
                      <option value="commercial">Commercial</option>
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Box>
                {kind !== 'whole' ? (
                  <Box>
                    {label(needsPhase ? `${unit} number` : `${unit} number (optional)`)}
                    {mvlc && needsPhase ? (
                      <NativeSelect.Root>
                        <NativeSelect.Field value={phase} onChange={(event) => setPhase(event.target.value)}>
                          <option value="">Select phase</option>
                          <option value="1">Phase 1</option>
                          <option value="2">Phase 2</option>
                          <option value="3">Phase 3</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    ) : (
                      <Input type="number" min={1} step={1} value={phase} onChange={(event) => setPhase(event.target.value)} placeholder="e.g. 1" />
                    )}
                  </Box>
                ) : null}
                {mvlc && needsPhase && allowed.length ? (
                  <Box>
                    {label('Section')}
                    <NativeSelect.Root>
                      <NativeSelect.Field value={mapSection} onChange={(event) => setSection(event.target.value)}>
                        {allowed.map((value) => <option key={value} value={value}>{value}</option>)}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </Box>
                ) : null}
                <Box>
                  {label('Image')}
                  <Input
                    type="file"
                    accept={acceptFor('map')}
                    pt="6px"
                    onChange={(event) => {
                      const next = event.target.files?.[0] ?? null
                      const problem = next ? uploadProblem('map', next) : ''
                      setFileError(problem)
                      setFile(problem ? null : next)
                      if (problem) event.target.value = ''
                    }}
                  />
                  <Text mt="4px" fontFamily={FONT} fontSize="12px" color={fileError ? '#B91C1C' : COLORS.subtle} role={fileError ? 'alert' : undefined}>
                    {fileError || describeUpload('map')}
                  </Text>
                </Box>
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
                onClick={() => onSave({ phase: kind === 'whole' ? null : phaseNumber, section: mapSection, commercial: kind === 'commercial' }, file)}
              >
                Save map
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
 * Map view for one project: the whole-site map (phased projects), one map per
 * phase or floor, and the
 * commercial maps, chosen by tab and read from the Supabase `uploads` table.
 * Maps can be added to any slot, and each image can be replaced.
 */
export default function ProjectMapView({ projectCode, projectName, projectId, initialTab = '', initialAction = '' }) {
  const [tab, setTab] = useState(initialTab)
  // The first map only reveals with the panel around it; later tabs reveal themselves.
  const [tabSwitched, setTabSwitched] = useState(false)
  const floors = usesFloors(projectCode)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState('') // '' | 'add' | <map id being replaced>
  const [error, setError] = useState('')
  const [fullscreen, setFullscreen] = useState(null) // the map shown in the fullscreen modal
  const replaceInput = useRef(null)
  const replaceTarget = useRef(null)

  const query = useMemo(() => ({ projectCode }), [projectCode])
  const { data, loading, reload } = useApiQuery(fetchProjectMaps, query)

  const tabs = data?.tabs ?? []
  // A floor tab can disappear when the project changes (and the old Annotated
  // tab is gone); fall back to the first tab.
  const active = tabs.find((option) => option.value === tab) ?? tabs[0]
  const canEdit = data?.source === 'database' && Boolean(projectCode)

  async function save(target, file, mode, replaceId = null) {
    setBusy(mode)
    setError('')
    try {
      await saveProjectMap({ projectCode, projectId, target, file, existing: data?.maps ?? [], replaceId })
      setAdding(false)
      notifySaved(mode === 'add' ? 'Map added' : 'Map image replaced')
      // Jump to the tab the map landed in.
      setTab(mapTabValue(target))
      reload()
    } catch (err) {
      setError(err.message)
      notifyFailed(mode === 'add' ? 'Could not add the map' : 'Could not replace the map image', err)
    } finally {
      setBusy('')
    }
  }

  function startReplace(map) {
    replaceTarget.current = map
    setError('')
    replaceInput.current?.click()
  }

  function handleReplaceFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    const map = replaceTarget.current
    // The map's own id goes with it: replacing rewrites that row, never adds one.
    if (file && map) save({ phase: map.phase, section: map.section, commercial: map.commercial }, file, map.id, map.id)
  }

  if (loading && !data) return <MapViewSkeleton />

  return (
    <Card>
      <Flex align="center" justify="space-between" gap="12px" flexWrap="wrap" mb="14px">
        <Box overflowX="auto" maxW="100%">
          <SegmentedControl
            options={tabs.map(({ value, label }) => ({ value, label }))}
            value={active?.value}
            onChange={(next) => {
              if (next === tab) return
              setTabSwitched(true)
              setTab(next)
            }}
            size="sm"
          />
        </Box>
        {/*
          * Shown on every map tab, filled or not: a slot that already has a map
          * still needs a way to add another one for a different phase, and
          * uploading into an occupied slot replaces its map in place — the same
          * row, and the same file in the bucket.
          */}
        <Flex align="center" gap="8px" flexWrap="wrap">
        {/*
          * One button for the maps and the annotated images beside them: the
          * outlines are drawn over these maps, so they refresh together.
          */}
        <RefreshButton onRefresh={() => refreshTables(['uploads', 'annotated_images'])} label="Refresh maps" size="34px" />
        {/*
          * The lot outlines of the map in view, and Color lots for painting
          * statuses onto it; `slots` names each map as its tab does.
          */}
        {active ? (
          <AnnotatedImagesPanel
            projectCode={projectCode}
            projectName={projectName}
            projectId={projectId}
            slot={active.value}
            hasMap={active.maps.length > 0}
            slots={tabs.map(({ value, label }) => ({ value, label }))}
            startColoring={initialAction === 'color-lots'}
            onSelectSlot={(next) => {
              setTabSwitched(true)
              setTab(next)
            }}
            ActionButton={ActionButton}
          />
        ) : null}
        {canEdit ? (
          <ActionButton
            tone="primary"
            icon={LuImagePlus}
            disabled={Boolean(busy)}
            onClick={() => {
              setError('')
              setAdding(true)
            }}
          >
            Add map
          </ActionButton>
        ) : null}
        </Flex>
        <input ref={replaceInput} type="file" accept={acceptFor('map')} hidden onChange={handleReplaceFile} />
      </Flex>

      {error && !adding ? (
        <Text role="alert" mb="12px" fontFamily={FONT} fontSize="13px" color="#B91C1C">
          {error}
        </Text>
      ) : null}

      {/* Each map tab reveals as it arrives; `key` replays it on every switch. */}
      <Reveal key={active?.value ?? 'none'} animate={tabSwitched}>
      {active && active.maps.length > 0 ? (
        <Flex direction="column" gap="18px" opacity={loading ? 0.6 : 1} transition="opacity 120ms ease">
          {active.maps.map((map) => (
            <Box key={map.id}>
              <Flex align="center" justify="space-between" gap="12px" mb="8px" flexWrap="wrap">
                <Text fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading} truncate minW={0} flex="1">
                  {/* The file name is not shown; a caption only tells several maps apart. */}
                  {active.maps.length > 1 ? map.caption : ''}
                </Text>
                <Flex align="center" gap="8px" flexWrap="wrap">
                  <ActionButton
                    icon={LuExpand}
                    onClick={() =>
                      setFullscreen({
                        ...map,
                        name: `${projectName || projectCode} — ${active.label}${active.maps.length > 1 && map.caption ? ` · ${map.caption}` : ''}`,
                      })
                    }
                  >
                    Open full size
                  </ActionButton>
                  {canEdit ? (
                    <ActionButton
                      icon={LuRefreshCw}
                      loading={busy === map.id}
                      disabled={Boolean(busy)}
                      onClick={() => startReplace(map)}
                    >
                      Replace image
                    </ActionButton>
                  ) : null}
                </Flex>
              </Flex>
              <ZoomableImage
                src={map.url}
                alt={`${projectName || projectCode} — ${active.label} map`}
              />
            </Box>
          ))}
        </Flex>
      ) : (
        <EmptyState
          icon={LuMap}
          title={`No ${(active?.label ?? 'project').toLowerCase()} map yet`}
          hint={
            data?.source !== 'database'
              ? 'Maps load from the Supabase uploads table once the database is connected.'
              : `Use "Add map" to upload one for ${projectName || projectCode}.`
          }
        />
      )}
      </Reveal>

      <FullscreenImageDialog
        open={Boolean(fullscreen)}
        src={fullscreen?.url}
        alt={`${projectName || projectCode} — ${active?.label} map`}
        title={fullscreen?.name}
        onClose={() => setFullscreen(null)}
      />

      {adding ? (
        <AddMapDialog
          open
          initialSlot={slotForTab(active?.value, floors)}
          floors={floors}
          mvlc={/^mvlc$/i.test(projectCode ?? '')}
          busy={busy === 'add'}
          error={error}
          onClose={() => {
            setAdding(false)
            setError('')
          }}
          onSave={(target, file) => save(target, file, 'add')}
        />
      ) : null}
    </Card>
  )
}
