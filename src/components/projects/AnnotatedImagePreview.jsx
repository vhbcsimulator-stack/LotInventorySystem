import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Portal, Spinner, Text } from '@chakra-ui/react'
import {
  LuDownload,
  LuEraser,
  LuEye,
  LuEyeOff,
  LuImage,
  LuPaintbrush,
  LuSave,
  LuShapes,
  LuTriangleAlert,
  LuWandSparkles,
  LuZoomIn,
  LuZoomOut,
} from 'react-icons/lu'
import useLotPainter from '@/components/projects/useLotPainter'
import { planStatusUpdate } from '@/components/projects/lotStatusPlan'
import { LOT_STATUS_OPTIONS } from '@/data/projectsData'
import { COLORS, MAP_LOT_FILL } from '@/theme/colors'

/** The brush that removes a lot's new colour, leaving the map's own. */
const ORIGINAL = 'original'
const FILL_BY_STATUS = Object.fromEntries(MAP_LOT_FILL.map((option) => [option.value, option]))
// Polygon clicks before the map is ready to colour.
const IGNORE = () => {}

const FONT = 'Inter, system-ui, sans-serif'

/** Outline colour for an unselected shape, cycled so neighbours stay apart. */
const SHAPE_COLORS = ['#2563EB', '#0F9D58', '#D97706', '#7C3AED', '#DB2777', '#0891B2']
const SELECTED = '#000'

const ZOOM_MIN = 1
const ZOOM_MAX = 8
const ZOOM_STEP = 0.25
const clampZoom = (zoom) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
/*
 * Farther than this between pointer down and up and it was a drag, not a click on
 * a lot — without which panning across the map keeps changing the selection.
 */
const DRAG_SLOP = 4

/**
 * The size the COCO file was annotated against — its first image entry, which is
 * what a single-image export has. Zero when the file records no size, in which
 * case the image's own size is assumed and nothing is scaled.
 */
function cocoSize(coco) {
  const entry = Array.isArray(coco?.images) ? coco.images[0] : null
  return { width: Number(entry?.width) || 0, height: Number(entry?.height) || 0, fileName: entry?.file_name ?? '' }
}

/**
 * The polygons to draw, in COCO coordinates.
 *
 * `segmentation` is COCO's list of flat [x1, y1, x2, y2, …] rings; an annotation
 * with none — a detection-only export — falls back to its bounding box, so every
 * annotation is visible rather than silently missing from the preview.
 */
function toShapes(coco) {
  const names = new Map((Array.isArray(coco?.categories) ? coco.categories : []).map((category) => [category.id, category.name]))
  const annotations = Array.isArray(coco?.annotations) ? coco.annotations : []

  return annotations.map((annotation, index) => {
    const rings = (Array.isArray(annotation.segmentation) ? annotation.segmentation : [])
      .filter((ring) => Array.isArray(ring) && ring.length >= 6)
      .map((ring) => {
        const points = []
        for (let i = 0; i + 1 < ring.length; i += 2) points.push([Number(ring[i]), Number(ring[i + 1])])
        return points
      })
    const [bx, by, bw, bh] = Array.isArray(annotation.bbox) ? annotation.bbox.map(Number) : []
    const box = Number.isFinite(bx) && Number.isFinite(by) && bw > 0 && bh > 0 ? { x: bx, y: by, w: bw, h: bh } : null
    const boxRing = box
      ? [
          [
            [box.x, box.y],
            [box.x + box.w, box.y],
            [box.x + box.w, box.y + box.h],
            [box.x, box.y + box.h],
          ],
        ]
      : []

    return {
      id: annotation.id ?? index,
      label: names.get(annotation.category_id) ?? `Annotation ${index + 1}`,
      color: SHAPE_COLORS[index % SHAPE_COLORS.length],
      rings: rings.length ? rings : boxRing,
      fromBox: !rings.length && Boolean(box),
    }
  })
}

/**
 * The polygons, as their own component.
 *
 * A phase can hold hundreds of them, and panning changes the view many times a
 * second: re-rendering every polygon on each of those frames is what made
 * dragging stutter. Memoised, they are rebuilt only when the annotations, the
 * selection, or their visibility actually change, and a pan just moves the layer
 * that already exists.
 */
const Shapes = memo(function Shapes({ shapes, selected, strokeWidth, onSelect, painting = false, outlined = true }) {
  /*
   * While colouring, the shapes are clear click targets over the recoloured map —
   * any tint would hide the very colours being chosen — outlined only when the
   * annotations are shown.
   */
  if (painting) {
    return shapes.map((shape) =>
      shape.rings.map((ring, index) => (
        <polygon
          key={`${shape.id}-${index}`}
          points={ring.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="#000"
          fillOpacity={0}
          stroke={shape.color}
          strokeOpacity={outlined ? 0.7 : 0}
          strokeWidth={strokeWidth}
          cursor="pointer"
          onClick={() => onSelect(shape.id)}
        />
      )),
    )
  }
  return shapes.map((shape) =>
    shape.rings.map((ring, index) => (
      <polygon
        key={`${shape.id}-${index}`}
        points={ring.map(([x, y]) => `${x},${y}`).join(' ')}
        fill={shape.id === selected ? SELECTED : shape.color}
        fillOpacity={shape.id === selected ? 0.3 : 0.12}
        stroke={shape.id === selected ? SELECTED : shape.color}
        strokeWidth={strokeWidth}
        cursor="pointer"
        onClick={() => onSelect(shape.id)}
      />
    )),
  )
})

/**
 * The annotated image with its polygons drawn over it, the two sizes stated, and
 * the annotations listed so one can be picked out.
 *
 * Everything is drawn in the COCO file's own coordinates: the annotations are
 * left exactly as exported and the image is fitted to them. Scaling the polygons
 * onto the image instead needs a factor per axis whenever the two files differ in
 * proportion, which pulls every shape out of true — fitting the picture moves it
 * by the same amount but keeps the shapes, and so the lots, where the annotator
 * drew them. Nothing is cropped, and both the size difference and the fit applied
 * are reported beside it.
 */
export default function AnnotatedImagePreview({
  open,
  title,
  url,
  coco,
  fitting,
  fitError,
  onFitImage,
  onClose,
  /*
   * Colouring is a draft until it is saved. `loadLots()` resolves the project's
   * lots (fetchLotsByIdentifier) so the save can be reviewed first, and
   * `onSaveUpdate({ file, changes })` stores the recoloured map and applies the
   * reviewed status changes, resolving { failed: [{ lotNo, message }] }.
   */
  loadLots,
  onSaveUpdate,
  saving = false,
  saveError = '',
}) {
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [selected, setSelected] = useState(null)
  const [showShapes, setShowShapes] = useState(true)

  const shapes = useMemo(() => toShapes(coco), [coco])
  const annotated = cocoSize(coco)

  /*
   * The canvas is the COCO file's own size. Where it records none — and until the
   * image has loaded — the image's size stands in, and the two are then equal by
   * definition, so nothing is fitted.
   */
  const canvas = { width: annotated.width || natural.width, height: annotated.height || natural.height }
  // How far the image has to be squeezed or stretched to land on that canvas.
  const fit =
    canvas.width > 0 && natural.width > 0
      ? { x: canvas.width / natural.width, y: canvas.height / natural.height }
      : { x: 1, y: 1 }
  const matches = Math.abs(canvas.width - natural.width) < 1 && Math.abs(canvas.height - natural.height) < 1
  // Different factors per axis: the two files disagree on proportion, not only on
  // size, so the picture is visibly reshaped to fit.
  const reshaped = Math.abs(fit.x - fit.y) > 0.01

  /*
   * Stable across renders, or the memoised polygons would rebuild on every pan
   * anyway. The pan flag lives in a ref for the same reason.
   */
  const select = useCallback((id) => {
    // Swallow the click that ends a pan.
    if (dragged.current) dragged.current = false
    else setSelected((current) => (current === id ? null : id))
  }, [])
  const toggle = (id) => setSelected((current) => (current === id ? null : id))

  /*
   * Colouring lots. Each paint is { shapeId, status } for an annotated lot, or
   * { x, y, status } for one clicked outside every annotation; they belong to
   * the picture they were made on, so uploading the result — which changes
   * `url` — starts the next round from a clean slate on the new map.
   */
  const [painting, setPainting] = useState(false)
  const [brush, setBrush] = useState(MAP_LOT_FILL[0].value)
  const [paintState, setPaintState] = useState({ url, paints: [] })
  const [paintMessage, setPaintMessage] = useState('')
  const paintCanvasRef = useRef(null)
  const paints = useMemo(() => (paintState.url === url ? paintState.paints : []), [paintState, url])
  const painter = useLotPainter({
    enabled: painting,
    url,
    width: canvas.width,
    height: canvas.height,
    shapes,
    paints,
    canvasRef: paintCanvasRef,
  })
  const updatePaints = (update) =>
    setPaintState((prev) => ({ url, paints: update(prev.url === url ? prev.paints : []) }))
  // The newest paint of each annotated lot, for the swatches in the list.
  const shapeStatus = new Map(paints.filter((paint) => paint.shapeId !== undefined).map((paint) => [paint.shapeId, paint.status]))

  // Stable per brush, so the memoised polygons are not rebuilt on every pan frame.
  const paintShape = useCallback(
    (id) => {
      setPaintMessage('')
      setPaintState((prev) => {
        const rest = (prev.url === url ? prev.paints : []).filter((paint) => paint.shapeId !== id)
        return { url, paints: brush === ORIGINAL ? rest : [...rest, { shapeId: id, status: brush }] }
      })
    },
    [brush, url],
  )
  // A polygon click while colouring; the click that ends a pan is not one.
  const paintShapeClick = useCallback(
    (id) => {
      if (!dragged.current) paintShape(id)
    },
    [paintShape],
  )
  function paintPoint(x, y) {
    const { found, index } = painter.locatePoint(x, y)
    if (!found) {
      setPaintMessage("That spot isn't inside a lot — click on a lot's colored area.")
      return
    }
    setPaintMessage('')
    updatePaints((list) => {
      const rest = list.filter((_, n) => n !== index)
      return brush === ORIGINAL ? rest : [...rest, { x, y, status: brush }]
    })
  }
  /** A click on the map itself, off every annotation: colour the lot under it. */
  function onDrawingClick(event) {
    // Every pointer-up resets `dragged`, so reading it is enough to skip the end of a pan.
    if (!painting || !painter.ready || event.target.tagName === 'polygon' || dragged.current) return
    // The drawing is letterboxed into the svg box, as its viewBox is.
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height)
    const x = (event.clientX - rect.left - (rect.width - canvas.width * scale) / 2) / scale
    const y = (event.clientY - rect.top - (rect.height - canvas.height * scale) / 2) / scale
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return
    paintPoint(x, y)
  }

  const fileName = `${(title || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'}-colored.png`

  async function saveImage() {
    try {
      const blob = await painter.toBlob()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch (err) {
      setPaintMessage(err.message)
    }
  }

  /*
   * Saving is two steps so a slip of the brush never reaches the database: the
   * review lists every status the table will get, and only confirming it writes.
   * review: null | { loading } | { plan } | { error }
   */
  const [review, setReview] = useState(null)
  async function openReview() {
    setPaintMessage('')
    setReview({ loading: true })
    try {
      setReview({ plan: planStatusUpdate(shapes, paints, await loadLots()) })
    } catch (err) {
      setReview({ error: err.message })
    }
  }
  async function confirmSave() {
    try {
      const blob = await painter.toBlob()
      const { failed } = await onSaveUpdate({
        file: new File([blob], fileName, { type: 'image/png' }),
        changes: review.plan.changes,
      })
      setReview(null)
      if (failed.length) {
        setPaintMessage(
          `The map was saved, but ${failed.length} lot${failed.length === 1 ? '' : 's'} kept the old status: ${failed
            .map((entry) => `${entry.lotNo} (${entry.message})`)
            .join('; ')}`,
        )
      }
    } catch (err) {
      setReview((current) => (current ? { ...current, saveError: err.message } : current))
    }
  }

  /*
   * Zoom and pan over the drawing as a whole — image and polygons together, since
   * they share one viewBox — with the same controls and gestures as the map tabs:
   * the buttons, Ctrl (or Cmd) + scroll toward the cursor, dragging to move, and
   * a double click to reset. The pan is clamped so the drawing cannot be pushed
   * out of its frame.
   */
  const [view, setView] = useState({ zoom: ZOOM_MIN, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef(null)
  const drawingRef = useRef(null)
  const drag = useRef(null)
  // Whether the click now arriving is the tail of a pan, and so not a selection.
  const dragged = useRef(false)
  // A pointer reports far more often than the screen redraws; coalescing to one
  // update per frame is the difference between a smooth pan and a stuttering one.
  const frame = useRef(0)

  // A new picture starts from scratch rather than inheriting the last one's pan.
  useEffect(() => setView({ zoom: ZOOM_MIN, x: 0, y: 0 }), [url])

  function clampPan(next) {
    const frame = frameRef.current
    const drawing = drawingRef.current
    if (!frame || !drawing) return next
    const maxX = Math.max(0, (drawing.offsetWidth * next.zoom - frame.clientWidth) / 2)
    const maxY = Math.max(0, (drawing.offsetHeight * next.zoom - frame.clientHeight) / 2)
    return {
      zoom: next.zoom,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    }
  }

  /** Zoom to `next`, keeping the point (px, py) — from the frame's centre — still. */
  const zoomAt = (next, px = 0, py = 0) =>
    setView((prev) => {
      const zoom = clampZoom(next)
      const ratio = zoom / prev.zoom
      return clampPan({ zoom, x: px - (px - prev.x) * ratio, y: py - (py - prev.y) * ratio })
    })
  const reset = () => setView({ zoom: ZOOM_MIN, x: 0, y: 0 })

  /*
   * React's onWheel is passive, so the browser's own page zoom can only be kept
   * out of the way by a native listener.
   */
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
        const zoom = clampZoom(prev.zoom * Math.exp(-event.deltaY * 0.002))
        const ratio = zoom / prev.zoom
        return clampPan({ zoom, x: px - (px - prev.x) * ratio, y: py - (py - prev.y) * ratio })
      })
    }
    frame.addEventListener('wheel', onWheel, { passive: false })
    return () => frame.removeEventListener('wheel', onWheel)
  }, [])

  function onPointerDown(event) {
    if (event.button !== 0) return
    drag.current = { startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y, moved: false }
  }
  function onPointerMove(event) {
    if (!drag.current) return
    const { startX, startY, originX, originY } = drag.current
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    // A press only becomes a pan once it has travelled; a still hand still selects.
    if (!drag.current.moved && Math.hypot(dx, dy) > DRAG_SLOP) {
      drag.current.moved = true
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    if (!drag.current.moved || frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      setView((prev) => clampPan({ ...prev, x: originX + dx, y: originY + dy }))
    })
  }
  function endDrag() {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    dragged.current = Boolean(drag.current?.moved)
    drag.current = null
    setDragging(false)
  }

  const zoomControl = {
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

  const controlStyle = {
    as: 'button',
    type: 'button',
    align: 'center',
    gap: '6px',
    h: '32px',
    px: '10px',
    borderRadius: '8px',
    border: '1px solid',
    borderColor: COLORS.border,
    fontFamily: FONT,
    fontWeight: '600',
    fontSize: '12.5px',
    color: COLORS.heading,
    cursor: 'pointer',
    _hover: { bg: COLORS.hoverBg },
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (next) return
        // Unsaved colours are the one thing closing would silently lose.
        if (paints.length && !window.confirm('Discard the lot colors you have not saved?')) return
        onClose()
      }}
      placement="center"
      size="cover"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px={{ base: '0', md: '16px' }}>
          <Dialog.Content bg={COLORS.surface} borderRadius={{ base: '0', md: '16px' }} maxH="92dvh" overflow="hidden">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="16px" pr="56px">
              <Dialog.Title
                fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif"
                fontSize="17px"
                color={COLORS.heading}
                truncate
              >
                {title}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="16px" overflowY="auto">
              <Flex gap="16px" align="flex-start" direction={{ base: 'column', lg: 'row' }}>
                <Box flex="1" minW={0} w="100%">
                  <Box
                    ref={frameRef}
                    position="relative"
                    borderRadius="10px"
                    border="1px solid"
                    borderColor={COLORS.border}
                    bg={COLORS.canvas}
                    overflow="hidden"
                    /*
                     * A fixed frame, so the whole map is in view at 100% however
                     * large the picture is — a 2048-wide export otherwise opens
                     * taller than the dialog and has to be scrolled to be seen.
                     * Only the display is scaled down; the stored image keeps its
                     * own size, and zooming in goes back to full detail.
                     */
                    h={{ base: '320px', md: '460px', lg: '62dvh' }}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    cursor={dragging ? 'grabbing' : painting ? 'crosshair' : 'grab'}
                    touchAction="none"
                    userSelect="none"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onDoubleClick={reset}
                  >
                    <Box
                      ref={drawingRef}
                      position="relative"
                      w="100%"
                      h="100%"
                      // Kept on its own compositor layer, so a pan moves pixels
                      // that are already drawn instead of repainting the map.
                      willChange="transform"
                      transform={`translate(${view.x}px, ${view.y}px) scale(${view.zoom})`}
                      transformOrigin="center"
                      transition={dragging ? 'none' : 'transform 80ms ease-out'}
                    >
                    {/*
                      * One drawing: the image fills the COCO canvas —
                      * preserveAspectRatio="none" is what fits it, rather than
                      * letterboxing it and leaving the shapes adrift — and the
                      * polygons sit on it at their exported coordinates. Sharing
                      * one viewBox keeps them aligned at every display width.
                      */}
                    {/* No preserveAspectRatio here: the default letterboxes the
                        whole drawing into the frame, which is what fits it. */}
                    {/*
                      * While colouring, the recoloured map is a canvas at the
                      * annotations' size under the svg; `contain` letterboxes it
                      * exactly as the viewBox letterboxes the drawing, so the two
                      * stay aligned at every size and zoom.
                      */}
                    {painting ? (
                      <canvas
                        ref={paintCanvasRef}
                        width={canvas.width || 1}
                        height={canvas.height || 1}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          visibility: painter.ready ? 'visible' : 'hidden',
                        }}
                      />
                    ) : null}
                    <Box
                      as="svg"
                      position="relative"
                      viewBox={`0 0 ${canvas.width || 1} ${canvas.height || 1}`}
                      w="100%"
                      h="100%"
                      display="block"
                      onClick={onDrawingClick}
                    >
                      <image
                        href={url}
                        x="0"
                        y="0"
                        width={canvas.width || 1}
                        height={canvas.height || 1}
                        preserveAspectRatio="none"
                        visibility={painting && painter.ready ? 'hidden' : 'visible'}
                      />
                      {showShapes || painting ? (
                        <Shapes
                          shapes={shapes}
                          selected={selected}
                          strokeWidth={Math.max(1, (canvas.width || 1) / 500)}
                          onSelect={painting ? (painter.ready ? paintShapeClick : IGNORE) : select}
                          painting={painting}
                          outlined={showShapes}
                        />
                      ) : null}
                    </Box>
                    {/*
                      * Hidden twin, only there to report the image's true pixel
                      * size: an SVG <image> has no naturalWidth of its own.
                      */}
                      <Box
                        as="img"
                        src={url}
                        alt=""
                        hidden
                        decoding="async"
                        onLoad={(event) => setNatural({ width: event.target.naturalWidth, height: event.target.naturalHeight })}
                      />
                    </Box>
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
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <Flex
                        {...zoomControl}
                        aria-label="Zoom out"
                        disabled={view.zoom <= ZOOM_MIN}
                        onClick={() => zoomAt(view.zoom - ZOOM_STEP)}
                      >
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
                        onClick={reset}
                      >
                        {Math.round(view.zoom * 100)}%
                      </Box>
                      <Flex
                        {...zoomControl}
                        aria-label="Zoom in"
                        disabled={view.zoom >= ZOOM_MAX}
                        onClick={() => zoomAt(view.zoom + ZOOM_STEP)}
                      >
                        <Icon as={LuZoomIn} boxSize="16px" />
                      </Flex>
                    </Flex>
                  </Box>

                  <Flex mt="10px" gap="8px" align="center" flexWrap="wrap">
                    <Flex
                      {...controlStyle}
                      aria-pressed={painting}
                      bg={painting ? COLORS.hoverBg : undefined}
                      onClick={() => {
                        setPainting((on) => !on)
                        setSelected(null)
                        setPaintMessage('')
                      }}
                    >
                      <Icon as={LuPaintbrush} boxSize="14px" />
                      {painting ? 'Stop coloring' : 'Color lots'}
                    </Flex>
                    <Flex {...controlStyle} onClick={() => setShowShapes((on) => !on)}>
                      <Icon as={showShapes ? LuEyeOff : LuEye} boxSize="14px" />
                      {showShapes ? 'Hide annotations' : 'Show annotations'}
                    </Flex>
                    {selected !== null ? (
                      <Flex {...controlStyle} onClick={() => setSelected(null)}>
                        Clear selection
                      </Flex>
                    ) : null}
                    {/*
                      * Fitting on the page only changes how this preview draws.
                      * This rewrites the stored image at the annotations' size, so
                      * everything reading the row afterwards gets a picture that
                      * already matches and nothing has to be fitted again.
                      */}
                    {onFitImage && !matches && natural.width > 0 ? (
                      <Flex
                        {...controlStyle}
                        borderColor={COLORS.brandGreen}
                        color={COLORS.brandGreen}
                        opacity={fitting ? 0.6 : 1}
                        cursor={fitting ? 'progress' : 'pointer'}
                        onClick={() => (fitting ? null : onFitImage(canvas))}
                      >
                        <Icon as={LuWandSparkles} boxSize="14px" />
                        {fitting ? 'Resizing image…' : `Resize image to ${canvas.width} × ${canvas.height}`}
                      </Flex>
                    ) : null}
                  </Flex>
                  {fitError ? (
                    <Text role="alert" mt="8px" fontFamily={FONT} fontSize="12.5px" color="#B91C1C">
                      {fitError}
                    </Text>
                  ) : null}
                  {painting ? (
                    <PaintToolbar
                      brush={brush}
                      onBrush={setBrush}
                      count={paints.length}
                      ready={painter.ready}
                      loadError={painter.error}
                      message={paintMessage}
                      saving={saving || Boolean(review?.loading)}
                      controlStyle={controlStyle}
                      onReset={() => updatePaints(() => [])}
                      onDownload={saveImage}
                      onSaveUpdate={onSaveUpdate && loadLots ? openReview : null}
                    />
                  ) : null}
                </Box>

                <Box w={{ base: '100%', lg: '280px' }} flexShrink={0}>
                  <SizeReport annotated={annotated} natural={natural} fit={fit} matches={matches} reshaped={reshaped} />
                  <Text mt="14px" mb="6px" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>
                    Annotations ({shapes.length})
                  </Text>
                  <Flex direction="column" gap="4px" maxH="320px" overflowY="auto">
                    {shapes.map((shape) => (
                      <Flex
                        key={shape.id}
                        as="button"
                        type="button"
                        align="center"
                        gap="8px"
                        px="8px"
                        py="6px"
                        borderRadius="8px"
                        textAlign="left"
                        bg={shape.id === selected ? COLORS.statusBg : 'transparent'}
                        cursor="pointer"
                        _hover={{ bg: COLORS.hoverBg }}
                        // While colouring, a row paints its lot — handy for lots too small to hit on the map.
                        onClick={() => (painting ? painter.ready && paintShape(shape.id) : toggle(shape.id))}
                      >
                        <Box
                          boxSize="10px"
                          borderRadius="2px"
                          bg={shape.id === selected ? SELECTED : shape.color}
                          flexShrink={0}
                        />
                        <Text fontFamily={FONT} fontSize="12.5px" color={COLORS.heading} truncate>
                          {shape.label}
                        </Text>
                        {shapeStatus.has(shape.id) ? (
                          <Flex align="center" gap="4px" ml="auto" flexShrink={0}>
                            <Box
                              boxSize="10px"
                              borderRadius="3px"
                              bg={FILL_BY_STATUS[shapeStatus.get(shape.id)].color}
                              border="1px solid rgba(0,0,0,0.25)"
                            />
                            <Text fontFamily={FONT} fontSize="11px" color={COLORS.subtle}>
                              {FILL_BY_STATUS[shapeStatus.get(shape.id)].label}
                            </Text>
                          </Flex>
                        ) : null}
                        {shape.fromBox ? (
                          <Text fontFamily={FONT} fontSize="11px" color={COLORS.subtle} ml="auto" flexShrink={0}>
                            box only
                          </Text>
                        ) : null}
                      </Flex>
                    ))}
                    {shapes.length ? null : (
                      <Text fontFamily={FONT} fontSize="12.5px" color={COLORS.subtle}>
                        This COCO file lists no annotations.
                      </Text>
                    )}
                  </Flex>
                </Box>
              </Flex>
            </Dialog.Body>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
      {review && !review.loading ? (
        <SaveReviewDialog
          review={review}
          saving={saving}
          error={review.saveError || saveError}
          controlStyle={controlStyle}
          onCancel={() => setReview(null)}
          onConfirm={confirmSave}
        />
      ) : null}
    </Dialog.Root>
  )
}

const statusLabel = (value) =>
  LOT_STATUS_OPTIONS.find((option) => option.value === String(value).toLowerCase())?.label ?? (value || 'No status')

/**
 * The last look before saving: every lot whose status the table will get, and
 * every coloured lot that will not change (with why). Nothing is written until
 * Save update is pressed here.
 */
function SaveReviewDialog({ review, saving, error, controlStyle, onCancel, onConfirm }) {
  const { plan } = review
  const text = { fontFamily: FONT, fontSize: '12.5px', color: COLORS.heading }
  return (
    <Dialog.Root open onOpenChange={({ open: next }) => (next || saving ? null : onCancel())} placement="center" size="md">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content bg={COLORS.surface} borderRadius="16px" maxH="85dvh" overflow="hidden">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="14px">
              <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="16px" color={COLORS.heading}>
                Review before saving
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body py="14px" overflowY="auto">
              {review.error ? (
                <Text role="alert" {...text} color="#B91C1C">
                  The lots could not be loaded, so nothing was saved: {review.error}
                </Text>
              ) : (
                <>
                  <Text {...text} fontWeight="600" mb="6px">
                    {plan.changes.length
                      ? `${plan.changes.length} lot status${plan.changes.length === 1 ? '' : 'es'} will change in the table`
                      : 'No lot status will change — only the map is saved.'}
                  </Text>
                  <Flex direction="column" gap="4px">
                    {plan.changes.map((change) => (
                      <Flex key={change.id} gap="8px" align="center" px="8px" py="5px" borderRadius="8px" bg={COLORS.canvas}>
                        <Text {...text} fontWeight="600" flex="1" truncate>
                          {change.lotNo}
                        </Text>
                        <Text {...text} color={COLORS.subtle}>
                          {statusLabel(change.from)}
                        </Text>
                        <Text {...text}>→</Text>
                        <Text {...text} fontWeight="700">
                          {statusLabel(change.status)}
                        </Text>
                      </Flex>
                    ))}
                  </Flex>
                  {plan.skipped.length ? (
                    <>
                      <Text {...text} fontWeight="600" mt="14px" mb="6px">
                        Not changed in the table ({plan.skipped.length})
                      </Text>
                      <Flex direction="column" gap="2px">
                        {plan.skipped.map((entry, index) => (
                          <Text key={index} {...text} color={COLORS.subtle}>
                            <Box as="span" fontWeight="600" color={COLORS.heading}>
                              {entry.label}
                            </Box>{' '}
                            — {entry.reason}
                          </Text>
                        ))}
                      </Flex>
                    </>
                  ) : null}
                  {plan.mapOnly ? (
                    <Text {...text} color={COLORS.subtle} mt="12px">
                      {plan.mapOnly} area{plan.mapOnly === 1 ? '' : 's'} colored by clicking outside the annotations — saved on
                      the map only.
                    </Text>
                  ) : null}
                </>
              )}
              {error ? (
                <Text role="alert" {...text} color="#B91C1C" mt="12px">
                  {error}
                </Text>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="12px" gap="8px">
              <Flex {...controlStyle} opacity={saving ? 0.55 : 1} onClick={saving ? undefined : onCancel}>
                Keep editing
              </Flex>
              {review.error ? null : (
                <Flex
                  {...controlStyle}
                  bg={COLORS.brandGreen}
                  borderColor={COLORS.brandGreen}
                  color="#FFFFFF"
                  _hover={{ bg: '#00541F' }}
                  cursor={saving ? 'progress' : 'pointer'}
                  onClick={saving ? undefined : onConfirm}
                >
                  {saving ? <Spinner size="xs" /> : <Icon as={LuSave} boxSize="14px" />}
                  {saving ? 'Saving…' : 'Save update'}
                </Flex>
              )}
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

/**
 * The colouring controls: which status a click paints, and what to do with the
 * result — download it, or review and save it as the slot's map and the lots' statuses.
 */
function PaintToolbar({ brush, onBrush, count, ready, loadError, message, saving, controlStyle, onReset, onDownload, onSaveUpdate }) {
  const chip = (value, label, swatch) => {
    const chosen = brush === value
    return (
      <Flex
        key={value}
        as="button"
        type="button"
        align="center"
        gap="6px"
        h="30px"
        px="10px"
        borderRadius="999px"
        border="1px solid"
        borderColor={chosen ? COLORS.heading : COLORS.border}
        bg={chosen ? COLORS.hoverBg : COLORS.surface}
        fontFamily={FONT}
        fontSize="12px"
        fontWeight={chosen ? '700' : '500'}
        color={COLORS.heading}
        cursor="pointer"
        aria-pressed={chosen}
        onClick={() => onBrush(value)}
        _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      >
        {swatch}
        {label}
      </Flex>
    )
  }
  const busy = !ready || saving
  const action = (props) => ({
    ...controlStyle,
    opacity: busy || count === 0 ? 0.55 : 1,
    cursor: busy || count === 0 ? 'not-allowed' : 'pointer',
    'aria-disabled': busy || count === 0,
    ...props,
    onClick: busy || count === 0 ? undefined : props.onClick,
  })

  const hint = loadError
    ? loadError
    : !ready
      ? 'Preparing the map for coloring…'
      : `Pick a status, then click a lot on the map or in the list. Only its fill changes — the text, lines, and trees stay as they are. Original puts a lot back. ${count} lot${count === 1 ? '' : 's'} colored — nothing is stored until you press Save update and confirm.`

  return (
    <Box mt="10px" p="10px" border="1px solid" borderColor={COLORS.border} borderRadius="10px" bg={COLORS.canvas}>
      <Flex align="center" gap="6px" flexWrap="wrap">
        <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
          Color as
        </Text>
        {MAP_LOT_FILL.map(({ value, label, color }) =>
          chip(value, label, <Box boxSize="12px" borderRadius="3px" bg={color} border="1px solid rgba(0,0,0,0.25)" />),
        )}
        {chip(ORIGINAL, 'Original', <Icon as={LuEraser} boxSize="13px" />)}
      </Flex>
      <Flex mt="10px" gap="8px" flexWrap="wrap" align="center">
        <Flex {...action({ onClick: onReset })}>Reset colors</Flex>
        <Flex {...action({ onClick: onDownload })}>
          <Icon as={LuDownload} boxSize="14px" />
          Download image
        </Flex>
        {onSaveUpdate ? (
          <Flex
            {...action({ onClick: onSaveUpdate })}
            bg={COLORS.brandGreen}
            borderColor={COLORS.brandGreen}
            color="#FFFFFF"
            _hover={{ bg: '#00541F' }}
          >
            {saving ? <Spinner size="xs" /> : <Icon as={LuSave} boxSize="14px" />}
            {saving ? 'Checking…' : 'Save update…'}
          </Flex>
        ) : null}
      </Flex>
      <Text
        mt="8px"
        fontFamily={FONT}
        fontSize="12px"
        color={message || loadError ? '#B91C1C' : COLORS.subtle}
        role={message || loadError ? 'alert' : undefined}
      >
        {message || hint}
      </Text>
    </Box>
  )
}

/** The two sizes side by side, and what was done about a mismatch. */
function SizeReport({ annotated, natural, fit, matches, reshaped }) {
  const row = (icon, label, value) => (
    <Flex align="center" gap="8px" py="3px">
      <Icon as={icon} boxSize="14px" color={COLORS.subtle} />
      <Text fontFamily={FONT} fontSize="12.5px" color={COLORS.subtle} flex="1">
        {label}
      </Text>
      <Text fontFamily={FONT} fontWeight="600" fontSize="12.5px" color={COLORS.heading}>
        {value}
      </Text>
    </Flex>
  )
  const size = ({ width, height }) => (width && height ? `${width} × ${height}` : '—')

  return (
    <Box p="10px" borderRadius="10px" border="1px solid" borderColor={COLORS.border}>
      {row(LuImage, 'Image', size(natural))}
      {row(LuShapes, 'COCO', annotated.width ? size(annotated) : 'not stated')}
      {matches ? (
        <Text mt="6px" fontFamily={FONT} fontSize="12px" color={COLORS.brandGreen}>
          Sizes match.
        </Text>
      ) : (
        <Flex mt="6px" gap="6px" align="flex-start">
          <Icon
            as={reshaped ? LuTriangleAlert : LuImage}
            boxSize="14px"
            color={reshaped ? '#B45309' : COLORS.subtle}
            mt="2px"
            flexShrink={0}
          />
          <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
            Sizes differ, so the image is fitted to the annotations (×{fit.x.toFixed(2)}
            {reshaped ? ` across and ×${fit.y.toFixed(2)} down` : ''}) and the polygons are drawn exactly as exported.
            {reshaped
              ? ' The two also differ in proportion, so the picture is reshaped to fit — if it looks wrong, the JSON was annotated on a differently cropped image.'
              : ''}{' '}
            Use “Resize image” to store it at that size for good.
          </Text>
        </Flex>
      )}
    </Box>
  )
}
