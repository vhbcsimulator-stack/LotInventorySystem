import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, Portal, Spinner, Text } from '@chakra-ui/react'
import {
  LuCheck,
  LuChevronDown,
  LuDownload,
  LuEraser,
  LuEye,
  LuEyeOff,
  LuImage,
  LuLayoutGrid,
  LuPaintbrush,
  LuPalette,
  LuPipette,
  LuSave,
  LuShapes,
  LuSlidersHorizontal,
  LuRedo2,
  LuTriangleAlert,
  LuUndo2,
  LuWandSparkles,
  LuZoomIn,
  LuZoomOut,
} from 'react-icons/lu'
import useLotPainter from '@/components/projects/useLotPainter'
import { TOLERANCE_DEFAULT, TOLERANCE_MAX, TOLERANCE_MIN } from '@/components/projects/lotRecolor'
import { DEFAULT_PALETTE, hexToHsv, hsvToHex, isDefaultPalette, loadPalette, savePalette } from '@/components/projects/legendPalette'
import { frameMisfit, isSvgUrl } from '@/lib/svgMaps'
import { fillForStatus, lotsForLabel, planStatusUpdate } from '@/components/projects/lotStatusPlan'
import { SellerPicker } from '@/components/projects/SoldByPicker'
import { sellerFields } from '@/components/projects/seller'
import ClientPicker from '@/components/projects/ClientPicker'
import { unitDescription } from '@/data/clientsData'
import { LOT_STATUS_OPTIONS } from '@/data/projectsData'
import { uiStatus } from '@/data/supabase'
import { COLORS, LOT_STATUS, MAP_LOT_FILL } from '@/theme/colors'

/** The brush that removes a lot's new colour, leaving the map's own. */
const ORIGINAL = 'original'
const FILL_BY_STATUS = Object.fromEntries(MAP_LOT_FILL.map((option) => [option.value, option]))
/** Who a lot painted Reserved is held for; stored on the lot as its reserve type. */
const RESERVE_TYPES = [
  // '' is a plain reservation, held for neither; it is stored as no reserve type.
  { value: '', label: 'Default' },
  { value: 'client', label: 'Client' },
  { value: 'company', label: 'Company' },
]
const reserveTypeLabel = (value) => RESERVE_TYPES.find((option) => option.value === value)?.label ?? ''
/** A paint's colour name, with its reserve type when it has one: "Reserved · Client". */
function paintLabel({ status, reserveType }) {
  const label = FILL_BY_STATUS[status]?.label ?? status
  return reserveType ? `${label} · ${reserveTypeLabel(reserveType)}` : label
}
// Polygon clicks before the map is ready to colour.
const IGNORE = () => {}

/** How many colouring steps Undo can go back. */
const HISTORY_LIMIT = 100

/**
 * The paint state after `update` — the new paints, with the ones they replace
 * kept as a step Undo can return to, and anything undone before dropped. A
 * change that changes nothing (resetting an empty map, a reserve type no lot
 * uses) records no step.
 */
function withPaints(prev, url, update) {
  const current = prev.url === url ? prev.paints : []
  const next = update(current)
  const same = next.length === current.length && next.every((paint, index) => paint === current[index])
  if (same) return prev
  const past = prev.url === url ? prev.past : []
  return { url, paints: next, past: [...past, current].slice(-HISTORY_LIMIT), future: [] }
}
const NONE = []

const FONT = 'Inter, system-ui, sans-serif'

/*
 * Every annotation is outlined in one colour with no fill, so the map's own lot
 * colours show through untouched.
 */
const OUTLINE = '#1D4ED8'
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
      color: OUTLINE,
      rings: rings.length ? rings : boxRing,
      fromBox: !rings.length && Boolean(box),
    }
  })
}

/**
 * The lot behind the selected outline — lot number, status, and size — matched
 * by the outline's label as saving a coloring would match it. An identifier
 * used in more than one phase lists every lot it can mean.
 */
function SelectedLotCard({ shape, lotsByKey, error, canLookUp, onClose }) {
  const lots = lotsByKey ? lotsForLabel(shape.label, lotsByKey) : []
  const statusLabel = (status) => LOT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? (status || '—')
  const row = (label, value) => (
    <Flex justify="space-between" gap="16px">
      <Text color={COLORS.subtle}>{label}</Text>
      <Text fontWeight="600" color={COLORS.heading} textAlign="right">
        {value}
      </Text>
    </Flex>
  )

  let body
  if (!canLookUp) body = <Text color={COLORS.subtle}>Lot details are not available here.</Text>
  else if (error) body = <Text color="#B91C1C">Could not load the lots: {error}</Text>
  else if (!lotsByKey) {
    body = (
      <Flex align="center" gap="8px" color={COLORS.subtle}>
        <Spinner size="xs" /> Loading lot…
      </Flex>
    )
  } else if (!lots.length) body = <Text color={COLORS.subtle}>No lot in the table has this identifier.</Text>
  else {
    body = lots.map((lot, index) => {
      const status = LOT_STATUS[uiStatus(lot.status)]
      return (
        <Flex key={lot.id} direction="column" gap="4px" pt={index ? '8px' : 0} mt={index ? '8px' : 0} borderTop={index ? '1px solid' : 'none'} borderColor={COLORS.border}>
          {row('Lot No.', lot.lotNo || '—')}
          <Flex justify="space-between" align="center" gap="16px">
            <Text color={COLORS.subtle}>Status</Text>
            <Flex align="center" gap="6px" px="8px" py="1px" borderRadius="full" bg={status?.bg ?? COLORS.hoverBg} color={status?.fg ?? COLORS.heading} fontWeight="600" fontSize="12px">
              {status ? <Box boxSize="6px" borderRadius="full" bg={status.dot} /> : null}
              {statusLabel(lot.status)}
            </Flex>
          </Flex>
          {row('Size', lot.areaSqm ? `${Number(lot.areaSqm.toFixed(2)).toLocaleString('en-PH')} sqm` : '—')}
        </Flex>
      )
    })
  }

  return (
    <Box
      position="absolute"
      top="10px"
      left="10px"
      zIndex={2}
      w="240px"
      maxW="calc(100% - 20px)"
      p="12px"
      bg={COLORS.surface}
      border="1px solid"
      borderColor={COLORS.border}
      borderRadius="10px"
      boxShadow="0 4px 14px rgba(0,0,0,0.12)"
      fontFamily={FONT}
      fontSize="12.5px"
      // Clicks on the card must not reach the map and pan or deselect.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Flex align="center" justify="space-between" gap="8px" mb="8px">
        <Text fontWeight="700" fontSize="13.5px" color={COLORS.heading} truncate>
          {shape.label}
        </Text>
        <CloseButton size="2xs" aria-label="Clear selection" onClick={onClose} />
      </Flex>
      {body}
    </Box>
  )
}

/**
 * The painted lots, drawn over the map while colouring. Each layer is the map
 * itself — the same picture, at the same full resolution — through a colour
 * filter turning the lot's old colour into its new one, clipped to its lots.
 * Nothing is redrawn at a lower resolution and nothing is swapped in later, so a
 * painted lot is sharp the moment it is clicked. `layers` come from
 * useLotPainter; their outlines are in canvas pixels, this drawing's own units.
 * Clicks pass straight through to the lots underneath.
 */
const PaintLayers = memo(function PaintLayers({ id, url, width, height, layers }) {
  if (!layers.length) return null
  return (
    <g pointerEvents="none">
      <defs>
        {layers.map((layer, index) => {
          // Outlines come from a copy of the map drawn `scale` times larger.
          const [sx, sy] = layer.scale ?? [1, 1]
          return (
          <Fragment key={layer.key}>
            <clipPath id={`${id}-clip-${index}`}>
              <path d={layer.d} transform={`scale(${1 / sx} ${1 / sy})`} />
            </clipPath>
            <filter
              id={`${id}-fill-${index}`}
              filterUnits="userSpaceOnUse"
              x={layer.box[0] / sx}
              y={layer.box[1] / sy}
              width={(layer.box[2] - layer.box[0]) / sx}
              height={(layer.box[3] - layer.box[1]) / sy}
              colorInterpolationFilters="sRGB"
            >
              <feColorMatrix type="matrix" values={layer.matrix} />
            </filter>
          </Fragment>
          )
        })}
      </defs>
      {layers.map((layer, index) => (
        <g key={layer.key} clipPath={`url(#${id}-clip-${index})`} filter={`url(#${id}-fill-${index})`}>
          <image href={url} x="0" y="0" width={width} height={height} preserveAspectRatio="none" />
        </g>
      ))}
    </g>
  )
})

/**
 * The polygons, as their own component.
 *
 * A phase can hold hundreds of them, and panning changes the view many times a
 * second: re-rendering every polygon on each of those frames is what made
 * dragging stutter. Memoised, they are rebuilt only when the annotations, the
 * selection, or their visibility actually change, and a pan just moves the layer
 * that already exists.
 */
/**
 * A status fill darkened for drawing an outline, so the pale fills (Open,
 * Prime) still show as borders over lots painted the same colour.
 */
function outlineColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const value = parseInt(hex.slice(1), 16)
  const shade = (channel) => Math.round(channel * 0.55)
  return `rgb(${shade((value >> 16) & 255)}, ${shade((value >> 8) & 255)}, ${shade(value & 255)})`
}

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
  // Border only: the fill is invisible but still takes clicks, so a lot is picked
  // anywhere inside it. The selected lot is drawn last, on top, in a heavier black.
  const ordered = selected === null ? shapes : [...shapes.filter((shape) => shape.id !== selected), ...shapes.filter((shape) => shape.id === selected)]
  return ordered.map((shape) =>
    shape.rings.map((ring, index) => (
      <polygon
        key={`${shape.id}-${index}`}
        points={ring.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="#000"
        fillOpacity={0}
        stroke={shape.id === selected ? SELECTED : shape.color}
        strokeWidth={shape.id === selected ? strokeWidth * 1.5 : strokeWidth}
        strokeLinejoin="round"
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
  // The lots' project, so a sold lot's new client is prefilled with it.
  projectCode,
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
  /*
   * Read-only twin of `loadLots` for those who cannot colour: it only lets a
   * selected outline show its lot's number, status, and size. `loadLots` is
   * used for that too when given.
   */
  lookupLots,
  // Optional escape hatches for the two synchronization directions.
  onSkipColoring,
  allowMapOnlySave = false,
  saving = false,
  saveError = '',
  /*
   * Opening on a colouring already begun — a status just changed in the lot
   * table: `initialPaints` are the draft, `startPainting` opens with the brush
   * out, `focusShapeIds` are the lots to zoom to, and `notice` says why it opened.
   */
  initialPaints = NONE,
  startPainting = false,
  // Open with the annotation outlines already drawn over the map.
  showAnnotations = false,
  focusShapeIds = NONE,
  notice = '',
  // A caution shown above the map in amber — e.g. coloring with no COCO JSON.
  warning = '',
  // What to ask before closing with colours unsaved.
  closeConfirm = 'Discard the lot colors you have not saved?',
}) {
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  // The map url that has finished loading (or failed to); any other url is still on its way.
  const [loadedUrl, setLoadedUrl] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const imageLoading = Boolean(url) && loadedUrl !== url
  const [selected, setSelected] = useState(null)
  // Keep the base map clean on open; annotations remain available from the
  // explicit Show annotations control (and appear automatically while painting).
  const [showShapes, setShowShapes] = useState(showAnnotations)

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
  /*
   * An SVG map can declare the right size yet draw its picture a little short
   * of it — an export's rounded scale — and the annotations then drift. Only
   * the start of the file is read to tell, not the whole picture.
   */
  const [misfit, setMisfit] = useState(null) // { url, value }
  useEffect(() => {
    if (!open || !isSvgUrl(url)) return undefined
    const controller = new AbortController()
    ;(async () => {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok || !response.body) return
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let head = ''
      while (head.length < 65536) {
        const { done, value } = await reader.read()
        if (done) break
        head += decoder.decode(value, { stream: true })
      }
      controller.abort()
      setMisfit({ url, value: frameMisfit(head) })
    })().catch(() => {})
    return () => controller.abort()
  }, [open, url])
  const frameIssue = misfit?.url === url ? misfit.value : null
  const matches = Math.abs(canvas.width - natural.width) < 1 && Math.abs(canvas.height - natural.height) < 1 && !frameIssue
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
  const [painting, setPainting] = useState(startPainting)
  const [brush, setBrush] = useState(initialPaints.at(-1)?.status ?? MAP_LOT_FILL[0].value)
  // How far each painted lot's colour reaches; see the toolbar's Tolerance control.
  const [tolerance, setTolerance] = useState(TOLERANCE_DEFAULT)
  /*
   * How an annotated lot is colored: exactly inside its polygon (the default),
   * or following the printed lot lines out from it — better when outlines were
   * drawn well inside the lines. Clicked lots always follow the printed lines.
   */
  const [shapeMode, setShapeMode] = useState('polygon')
  const [reserveType, setReserveType] = useState(initialPaints.at(-1)?.reserveType ?? RESERVE_TYPES[0].value)
  // What a click paints: the brush's colour, and for Reserved who it is held for.
  const brushPaint = useMemo(
    () => (brush === 'reserved' ? { status: brush, reserveType } : { status: brush }),
    [brush, reserveType],
  )
  /*
   * The colour each status paints: the default legend, or the colours read off
   * this map's own legend. Matching the legend works on a draft: `picking` is
   * the statuses still to be read — a click on the map then samples a swatch
   * for the first of them instead of painting a lot, or the colour wheel sets
   * it by hand — and once none are left the draft waits for confirmation.
   * Painted lots show the draft meanwhile, as a preview; only confirming it
   * replaces the saved colours.
   */
  const paletteKey = title || url
  const [savedPalette, setSavedPalette] = useState(() => loadPalette(paletteKey))
  const [legendDraft, setLegendDraft] = useState(null) // null, or the palette being matched
  const palette = legendDraft ?? savedPalette
  const [picking, setPicking] = useState([])
  const pickingRef = useRef(false)
  pickingRef.current = picking.length > 0
  function changePalette(next) {
    setSavedPalette(next)
    savePalette(paletteKey, next)
  }
  const setDraftColor = (status, hex) => setLegendDraft((draft) => ({ ...(draft ?? savedPalette), [status]: hex }))
  function pickLegendColor(x, y) {
    const hex = painter.sampleColor(x, y)
    if (!hex) return
    setDraftColor(picking[0], hex)
    setPicking((queue) => queue.slice(1))
  }
  function endMatching(apply) {
    if (apply && legendDraft) changePalette(legendDraft)
    setLegendDraft(null)
    setPicking([])
  }
  // The paints, with the steps before (past) and undone after (future) them.
  const [paintState, setPaintState] = useState({ url, paints: initialPaints, past: [], future: [] })
  const [paintMessage, setPaintMessage] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  /*
   * Linking clicked areas to lots. A lot colored by clicking has no annotation
   * to name it, so it is linked by hand to a row of the lot table — which is
   * what lets Save Update change its status. `linking` is the { x, y } of the
   * paint being linked; the lot list loads the first time it is needed.
   */
  const canLink = Boolean(loadLots)
  const fetchLots = loadLots ?? lookupLots
  const [linking, setLinking] = useState(null)
  const [lotOptions, setLotOptions] = useState(null) // null until loaded: [{ id, lotNo, key, phase, category, status }]
  // The same lots by identifier, for naming a selected outline's lot.
  const [lotsByKey, setLotsByKey] = useState(null)
  const [lotsError, setLotsError] = useState('')
  const lotsRequested = useRef(false)
  function ensureLots() {
    if (!fetchLots || lotsRequested.current) return
    lotsRequested.current = true
    fetchLots().then(
      (byKey) => {
        setLotsByKey(byKey)
        setLotOptions(
          [...byKey.values()]
            .flat()
            .map((lot) => ({ ...lot, key: String(lot.lotNo).toLowerCase().replace(/[^a-z0-9]/g, '') }))
            .sort((a, b) => String(a.lotNo).localeCompare(String(b.lotNo), undefined, { numeric: true })),
        )
      },
      (err) => {
        lotsRequested.current = false
        setLotsError(err.message)
      },
    )
  }

  // The annotations list is coloured by each lot's status, so the lots load as soon as the preview opens.
  useEffect(() => {
    if (open) ensureLots()
  })

  /*
   * The map colour for an annotation's lot status — Sold, Reserved, Hold, or
   * Available (open) — as { color, label }. Null until the lots load, or when the
   * label names no single lot; the annotation then keeps its own colour.
   */
  function statusSwatch(shape) {
    if (!lotsByKey) return null
    const matches = lotsForLabel(shape.label, lotsByKey)
    if (matches.length !== 1) return null
    const status = String(matches[0].status).toLowerCase()
    const fill = fillForStatus(status)
    if (!fill || !palette[fill]) return null
    return { color: palette[fill], label: LOT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? matches[0].status }
  }

  // The outlines on the map follow the same status colours, darkened so pale fills still read as borders.
  const statusShapes = useMemo(() => {
    if (!lotsByKey) return shapes
    return shapes.map((shape) => {
      const matches = lotsForLabel(shape.label, lotsByKey)
      const fill = matches.length === 1 ? fillForStatus(String(matches[0].status).toLowerCase()) : null
      return fill && palette[fill] ? { ...shape, color: outlineColor(palette[fill]) } : shape
    })
  }, [shapes, lotsByKey, palette])
  // Selecting an outline shows its lot, so the lots load the first time one is picked.
  useEffect(() => {
    if (selected !== null) ensureLots()
    // ensureLots only reads refs and stable props; the selection is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])
  const selectedShape = selected === null || painting ? null : shapes.find((shape) => shape.id === selected) ?? null
  function openLinker(paint) {
    setLotsError('')
    ensureLots()
    setLinking({ x: paint.x, y: paint.y })
  }
  const samePoint = (paint, point) => paint.shapeId === undefined && paint.x === point.x && paint.y === point.y
  /** Link the area being linked to `lot`, or unlink it with null. */
  function linkLot(lot) {
    if (!linking) return
    const point = linking
    updatePaints((list) =>
      list.map((paint) => {
        if (!samePoint(paint, point)) return paint
        if (!lot) {
          const rest = { ...paint }
          delete rest.lot
          return rest
        }
        return { ...paint, lot: { id: lot.id, lotNo: lot.lotNo } }
      }),
    )
    setLinking(null)
  }
  // Colour layers are referenced by id; unique per preview, and safe inside url(#…).
  const paintLayerId = `paint-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const paints = useMemo(() => (paintState.url === url ? paintState.paints : []), [paintState, url])
  const painter = useLotPainter({
    enabled: painting,
    url,
    width: canvas.width,
    height: canvas.height,
    shapes,
    paints,
    tolerance,
    palette,
    shapeMode,
  })
  const updatePaints = (update) => setPaintState((prev) => withPaints(prev, url, update))
  /*
   * "Show original" hides the colours to compare with the map as it was. It is
   * tied to the paints it was turned on for: any change — a paint, undo, redo,
   * reset — makes new paints, so the colours come back and every edit is seen.
   */
  const [originalFor, setOriginalFor] = useState(null)
  const showOriginal = painting && originalFor !== null && originalFor === paints
  const toggleOriginal = () => setOriginalFor(showOriginal ? null : paints)
  const canUndo = paintState.url === url && paintState.past.length > 0
  const canRedo = paintState.url === url && paintState.future.length > 0
  const undo = useCallback(() => {
    setPaintMessage('')
    setPaintState((prev) =>
      prev.url !== url || !prev.past.length
        ? prev
        : { url, paints: prev.past.at(-1), past: prev.past.slice(0, -1), future: [prev.paints, ...prev.future] },
    )
  }, [url])
  const redo = useCallback(() => {
    setPaintMessage('')
    setPaintState((prev) =>
      prev.url !== url || !prev.future.length
        ? prev
        : { url, paints: prev.future[0], past: [...prev.past, prev.paints], future: prev.future.slice(1) },
    )
  }, [url])
  /*
   * A new reserve type is what the next click paints. The lots this preview was
   * opened for are already painted Reserved, so they take it straight away —
   * otherwise picking Company there would still save them as Client.
   */
  function pickReserveType(value) {
    setReserveType(value)
    if (!focusShapeIds.length) return
    updatePaints((list) =>
      list.map((paint) =>
        paint.status === 'reserved' && focusShapeIds.includes(paint.shapeId) ? { ...paint, reserveType: value } : paint,
      ),
    )
  }
  // The newest paint of each annotated lot, for the swatches in the list.
  const shapePaint = new Map(paints.filter((paint) => paint.shapeId !== undefined).map((paint) => [paint.shapeId, paint]))
  // Areas colored by clicking, each once; the one being linked, while it still exists (undo can remove it).
  const clickedPaints = paints.filter((paint) => paint.shapeId === undefined)
  const linkingPaint = linking ? (clickedPaints.find((paint) => samePoint(paint, linking)) ?? null) : null
  const linkedIds = new Set(clickedPaints.filter((paint) => paint.lot).map((paint) => paint.lot.id))

  // Stable per brush, so the memoised polygons are not rebuilt on every pan frame.
  const paintShape = useCallback(
    (id) => {
      setPaintMessage('')
      setPaintState((prev) =>
        withPaints(prev, url, (list) => {
          const rest = list.filter((paint) => paint.shapeId !== id)
          return brush === ORIGINAL ? rest : [...rest, { shapeId: id, ...brushPaint }]
        }),
      )
    },
    [brush, brushPaint, url],
  )
  // A polygon click while colouring; the click that ends a pan is not one.
  const paintShapeClick = useCallback(
    (id) => {
      // While reading the legend the drawing's own click handler samples instead.
      if (!dragged.current && !spaceHeld.current && !pickingRef.current) paintShape(id)
    },
    [paintShape],
  )
  function paintPoint(x, y) {
    const { found, index } = painter.locatePoint(x, y)
    setPaintMessage('')
    // A click off every lot — on a road, a line, the margin — simply does nothing.
    if (!found) return
    // Coloring an area again keeps the lot it was linked to.
    const lot = index >= 0 ? paints[index]?.lot : undefined
    updatePaints((list) => {
      const rest = list.filter((_, n) => n !== index)
      return brush === ORIGINAL ? rest : [...rest, { x, y, ...brushPaint, ...(lot ? { lot } : {}) }]
    })
    if (brush === ORIGINAL) setLinking(null)
    else if (canLink && !lot) openLinker({ x, y })
  }
  /** A click on the map itself, off every annotation: colour the lot under it. */
  function onDrawingClick(event) {
    // Every pointer-up resets `dragged`, so reading it is enough to skip the end of a pan.
    if (!painting || !painter.ready || dragged.current || spaceHeld.current) return
    // Reading a legend swatch takes a click anywhere, over an annotation or not.
    if (!picking.length && event.target.tagName === 'polygon') return
    // The drawing is letterboxed into the svg box, as its viewBox is.
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height)
    const x = (event.clientX - rect.left - (rect.width - canvas.width * scale) / 2) / scale
    const y = (event.clientY - rect.top - (rect.height - canvas.height * scale) / 2) / scale
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return
    if (picking.length) pickLegendColor(x, y)
    else paintPoint(x, y)
  }

  const fileNameBase = `${(title || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'}-colored`
  const svgFileName = `${fileNameBase}.svg`
  const pngFileName = `${fileNameBase}.png`

  async function saveImage() {
    try {
      // PNG is lossless and uses the painter's full working dimensions, not the scaled preview.
      const href = URL.createObjectURL(await painter.toPngBlob())
      const link = document.createElement('a')
      link.href = href
      link.download = pngFileName
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
  // Who sold each lot the review turns sold, and to which client, by lot id:
  // { [id]: { soldBy, client } } — both required before saving to the table.
  const [sales, setSales] = useState({})

  // Ctrl+Z undoes a colouring step; Ctrl+Y or Ctrl+Shift+Z redoes it (⌘ on a Mac).
  useEffect(() => {
    if (!open || !painting || review) return undefined
    function onKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target
      if (target?.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target?.tagName) || (target?.tagName === 'INPUT' && target.type !== 'range')) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, painting, review, undo, redo])

  async function openReview() {
    setPaintMessage('')
    setReview({ loading: true })
    try {
      // Every annotated lot's newest colour, as the saved map will show it.
      const labels = new Map(shapes.map((shape) => [shape.id, shape.label]))
      const newest = new Map(paints.filter((paint) => paint.shapeId !== undefined).map((paint) => [paint.shapeId, paint]))
      const linkedPaints = new Map(paints.filter((paint) => paint.shapeId === undefined && paint.lot).map((paint) => [paint.lot.id, paint]))
      const painted = [
        ...[...newest].map(([id, paint]) => ({ label: labels.get(id) ?? `Annotation ${id}`, fill: paint.status, paint })),
        ...[...linkedPaints.values()].map((paint) => ({ label: paint.lot.lotNo, fill: paint.status, paint })),
      ]
      setReview({ plan: planStatusUpdate(shapes, paints, await loadLots()), painted })
    } catch (err) {
      setReview({ error: err.message })
    }
  }
  async function confirmSave(updateTable = true) {
    const changes = updateTable
      ? review.plan.changes.map((change) => {
          const sale = sales[change.id] ?? {}
          // Skipped: only the status changes; the lot keeps whatever seller and client it had.
          if (sale.skip) return { ...change, skipped: true }
          // The client's record is pointed at the lot too, when it is one from the list.
          const client = { client: sale.client?.trim() ?? '', clientId: sale.clientId }
          if (change.status === 'sold') return { ...change, ...sellerFields(sale.seller), ...client }
          if (isClientReservation(change)) return { ...change, ...sellerFields(sale.seller), ...client }
          return change
        })
      : []
    const unnamed = (change) => !change.skipped && ((!change.soldBy && !change.salesAgent) || !change.client)
    const unsold = changes.filter((change) => change.status === 'sold' && unnamed(change))
    const unheld = changes.filter((change) => isClientReservation(change) && unnamed(change))
    if (unsold.length || unheld.length) {
      const lots = (list) => list.map((change) => change.lotNo).join(', ')
      const message = [
        unsold.length ? `Choose who sold ${lots(unsold)} and the client.` : '',
        unheld.length ? `Choose who reserved ${lots(unheld)} and the client.` : '',
      ]
        .filter(Boolean)
        .join(' ')
      setReview((current) => (current ? { ...current, saveError: message } : current))
      return
    }
    try {
      /*
       * Always saved as SVG, so nothing is lost: the map as it is — its own SVG,
       * or the uploaded picture embedded byte for byte — with the colored lots
       * written in as filled paths, all in one file the Flutter app also shows.
       */
      const file = new File([await painter.toSvgBlob()], svgFileName, { type: 'image/svg+xml' })
      const { failed } = await onSaveUpdate({ file, changes })
      // The lots' statuses just changed; reload them so the annotations list shows the new colours.
      lotsRequested.current = false
      ensureLots()
      setReview(null)
      setSales({})
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

  /*
   * Zoom in on the lots being focused, once per picture, as soon as both the
   * frame and the canvas size are known. The drawing is letterboxed into its
   * box, so a COCO point sits at (point − centre) × fit-scale from the middle.
   */
  const focusedFor = useRef('')
  useEffect(() => {
    if (!focusShapeIds.length || !canvas.width || !canvas.height || focusedFor.current === url) return undefined
    const points = shapes.filter((shape) => focusShapeIds.includes(shape.id)).flatMap((shape) => shape.rings.flat())
    if (!points.length) return undefined
    const raf = requestAnimationFrame(() => {
      const frame = frameRef.current
      const drawing = drawingRef.current
      if (!frame || !drawing || !drawing.offsetWidth) return
      focusedFor.current = url
      const xs = points.map(([x]) => x)
      const ys = points.map(([, y]) => y)
      const scale = Math.min(drawing.offsetWidth / canvas.width, drawing.offsetHeight / canvas.height)
      const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) * scale
      const zoom = clampZoom(Math.min(4, (Math.min(frame.clientWidth, frame.clientHeight) * 0.3) / size))
      const cx = ((Math.min(...xs) + Math.max(...xs)) / 2 - canvas.width / 2) * scale
      const cy = ((Math.min(...ys) + Math.max(...ys)) / 2 - canvas.height / 2) * scale
      setView(clampPan({ zoom, x: -cx * zoom, y: -cy * zoom }))
    })
    return () => cancelAnimationFrame(raf)
  }, [url, canvas.width, canvas.height, shapes, focusShapeIds])

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
      const zoom = clampZoom(typeof next === 'function' ? next(prev.zoom) : next)
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

  /*
   * While colouring, a left click paints and never pans. The map moves with
   * the middle button, or with the left button while Space is held — then a
   * click only moves the map, it never paints. Outside colouring, the left
   * button pans as it always has, and the middle one does too.
   */
  const spaceHeld = useRef(false)
  const [panKey, setPanKey] = useState(false)
  useEffect(() => {
    if (!open || !painting) return undefined
    const typing = (target) =>
      target?.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target?.tagName) || (target?.tagName === 'INPUT' && target.type !== 'range')
    const release = () => {
      spaceHeld.current = false
      setPanKey(false)
    }
    function onKeyDown(event) {
      if (event.code !== 'Space' || typing(event.target)) return
      // Nor does Space press whatever button last had focus.
      event.preventDefault()
      if (spaceHeld.current) return
      spaceHeld.current = true
      setPanKey(true)
    }
    function onKeyUp(event) {
      if (event.code !== 'Space') return
      if (!typing(event.target)) event.preventDefault()
      release()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', release)
      release()
    }
  }, [open, painting])

  function onPointerDown(event) {
    const middle = event.button === 1
    // No auto-scroll on a middle press: here it moves the map.
    if (middle) event.preventDefault()
    const pans = middle || (event.button === 0 && (!painting || spaceHeld.current))
    if (!pans) return
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

  // Sizes that match (or are still loading) need no attention; a mismatch is always shown.
  const sizesOk = matches || !natural.width
  // With nothing to show beside it, the map takes the whole width.
  const showSidebar = showShapes || !sizesOk || (painting && clickedPaints.length > 0)

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (next) return
        // Unsaved colours are the one thing closing would silently lose.
        if (paints.length) setDiscardOpen(true)
        else onClose()
      }}
      placement="center"
      size="cover"
      /*
       * Focus leaving is not a reason to close: a dialog that opened this one
       * (the Color lots choice) hands focus back to the page as it closes, which
       * otherwise shut this modal the moment it appeared. Clicking outside, Esc,
       * and the close button still close it.
       */
      onFocusOutside={(event) => event.preventDefault()}
    >
      <Portal>
        <Dialog.Backdrop />
        {/* "cover" pads the dialog by 40px all round; a thin margin leaves the map that height instead. */}
        <Dialog.Positioner p={{ base: '0', md: '12px' }}>
          {/* As wide as "cover", but only as tall as the map and its controls — no empty band below them. */}
          <Dialog.Content bg={COLORS.surface} borderRadius={{ base: '0', md: '16px' }} h="auto" maxH={{ base: '100dvh', md: 'calc(100dvh - 24px)' }} overflow="hidden">
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
                  {warning ? (
                    <Flex
                      role="alert"
                      mb="10px"
                      px="12px"
                      py="8px"
                      gap="8px"
                      align="flex-start"
                      borderRadius="8px"
                      border="1px solid #F5C77E"
                      bg="#FFF7E6"
                    >
                      <Icon as={LuTriangleAlert} boxSize="16px" color="#B45309" mt="1px" flexShrink={0} />
                      <Text fontFamily={FONT} fontSize="12.5px" color="#7C2D12">
                        {warning}
                      </Text>
                    </Flex>
                  ) : null}
                  {notice ? (
                    <Text
                      mb="10px"
                      px="12px"
                      py="8px"
                      borderRadius="8px"
                      bg={COLORS.statusBg}
                      fontFamily={FONT}
                      fontSize="12.5px"
                      color={COLORS.heading}
                    >
                      {notice}
                    </Text>
                  ) : null}
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
                    // As tall as the dialog allows (the screen less its 12px margins) less its header, padding and the button row below.
                    h={{ base: '70dvh', md: 'calc(100dvh - 24px - 140px)' }}
                    minH="320px"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    cursor={dragging ? 'grabbing' : painting && !panKey ? 'crosshair' : 'grab'}
                    // While moving the map, the lots' own pointer cursor gives way to the hand.
                    css={painting && (panKey || dragging) ? { '& *': { cursor: 'inherit !important' } } : undefined}
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
                      /*
                       * On its own compositor layer only while dragging, so a pan
                       * moves pixels already drawn instead of repainting the map.
                       * Kept on, the layer stays rasterised at 100% and zooming
                       * only stretches that bitmap, blurring the map; dropping it
                       * afterwards lets the browser redraw at the zoom shown.
                       */
                      willChange={dragging ? 'transform' : 'auto'}
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
                      />
                      {painting && !showOriginal ? (
                        <PaintLayers id={paintLayerId} url={url} width={canvas.width || 1} height={canvas.height || 1} layers={painter.layers} />
                      ) : null}
                      {showShapes || painting ? (
                        <Shapes
                          shapes={statusShapes}
                          selected={selected}
                          // Thin: about 1.4 units on a 2048-wide map, so outlines trace the lots without covering them.
                          strokeWidth={Math.max(0.75, (canvas.width || 1) / 1500)}
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
                        onLoad={(event) => {
                          setNatural({ width: event.target.naturalWidth, height: event.target.naturalHeight })
                          setLoadFailed(false)
                          setLoadedUrl(url)
                        }}
                        onError={() => {
                          setLoadFailed(true)
                          setLoadedUrl(url)
                        }}
                      />
                    </Box>
                    {selectedShape ? (
                      <SelectedLotCard
                        shape={selectedShape}
                        lotsByKey={lotsByKey}
                        error={lotsError}
                        canLookUp={Boolean(fetchLots)}
                        onClose={() => setSelected(null)}
                      />
                    ) : null}
                    {painting && legendDraft ? (
                      <LegendPickBanner
                        picking={picking}
                        palette={palette}
                        saved={savedPalette}
                        onSkip={() => setPicking((queue) => queue.slice(1))}
                        onDone={() => setPicking([])}
                        onPreview={setDraftColor}
                        onUse={(status, hex) => {
                          setDraftColor(status, hex)
                          setPicking((queue) => queue.filter((value) => value !== status))
                        }}
                        onRepick={(status) => setPicking([status])}
                        onApply={() => endMatching(true)}
                        onCancel={() => endMatching(false)}
                      />
                    ) : null}
                    {showOriginal ? (
                      <Flex
                        role="status"
                        position="absolute"
                        top="10px"
                        left="10px"
                        align="center"
                        gap="6px"
                        px="10px"
                        py="5px"
                        bg={COLORS.surface}
                        border="1px solid"
                        borderColor={COLORS.border}
                        borderRadius="999px"
                        boxShadow="0 1px 3px rgba(0,0,0,0.08)"
                        pointerEvents="none"
                        fontFamily={FONT}
                        fontSize="12px"
                        fontWeight="600"
                        color={COLORS.heading}
                      >
                        <Icon as={LuEyeOff} boxSize="13px" />
                        Original — before coloring
                      </Flex>
                    ) : null}
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
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <Flex
                        {...zoomControl}
                        aria-label="Zoom out"
                        disabled={view.zoom <= ZOOM_MIN}
                        onClick={() => zoomAt((current) => current - ZOOM_STEP)}
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
                        onClick={() => zoomAt((current) => current + ZOOM_STEP)}
                      >
                        <Icon as={LuZoomIn} boxSize="16px" />
                      </Flex>
                    </Flex>
                    {/* Covers the frame until the map arrives, so outlines never float over an empty canvas. */}
                    {imageLoading || loadFailed || !url ? (
                      <Flex
                        role="status"
                        position="absolute"
                        inset="0"
                        direction="column"
                        align="center"
                        justify="center"
                        gap="10px"
                        px="24px"
                        bg={COLORS.canvas}
                        textAlign="center"
                      >
                        {loadFailed ? (
                          <Icon as={LuTriangleAlert} boxSize="22px" color="#B91C1C" />
                        ) : (
                          <Spinner size="md" color={COLORS.brandGreen} />
                        )}
                        <Text fontFamily={FONT} fontSize="13px" color={loadFailed ? '#B91C1C' : COLORS.subtle}>
                          {loadFailed ? 'The map image could not be loaded. Close and try again.' : 'Loading map…'}
                        </Text>
                      </Flex>
                    ) : null}
                    {/*
                      * Opened for approval, the untouched map must never pass for
                      * the preview: it stays covered until the new colors are on.
                      */}
                    {startPainting && painting && !painter.ready ? (
                      <Flex
                        position="absolute"
                        inset="0"
                        direction="column"
                        align="center"
                        justify="center"
                        gap="10px"
                        px="24px"
                        bg={COLORS.canvas}
                        textAlign="center"
                      >
                        {painter.error ? (
                          <Icon as={LuTriangleAlert} boxSize="22px" color="#B91C1C" />
                        ) : (
                          <Spinner size="md" color={COLORS.brandGreen} />
                        )}
                        <Text fontFamily={FONT} fontSize="13px" color={painter.error ? '#B91C1C' : COLORS.subtle}>
                          {painter.error || 'Applying the new lot colors to the map…'}
                        </Text>
                      </Flex>
                    ) : null}
                  </Box>

                  <Flex mt="10px" gap="8px" align="center" flexWrap="wrap">
                    {shapes.length ? (
                      // One switch for the outlines on the map, the size report and the annotations list.
                      <Flex {...controlStyle} aria-pressed={showShapes} onClick={() => setShowShapes((on) => !on)}>
                        <Icon as={showShapes ? LuEyeOff : LuEye} boxSize="14px" />
                        {showShapes ? 'Hide lot outlines' : 'Show lot outlines'}
                      </Flex>
                    ) : null}
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
                        {fitting
                          ? frameIssue
                            ? 'Fitting map…'
                            : 'Resizing image…'
                          : frameIssue
                            ? 'Fit map to its frame'
                            : `Resize image to ${canvas.width} × ${canvas.height}`}
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
                      reserveType={reserveType}
                      onReserveType={pickReserveType}
                      palette={palette}
                      matching={Boolean(legendDraft)}
                      onMatchLegend={() => {
                        setPaintMessage('')
                        setLegendDraft({ ...savedPalette })
                        setPicking(MAP_LOT_FILL.map(({ value }) => value))
                      }}
                      onDefaultPalette={() => {
                        endMatching(false)
                        changePalette(DEFAULT_PALETTE)
                      }}
                      tolerance={tolerance}
                      onTolerance={setTolerance}
                      shapeMode={shapes.length ? shapeMode : null}
                      onShapeMode={setShapeMode}
                      count={paints.length}
                      ready={painter.ready}
                      loadError={painter.error}
                      message={paintMessage}
                      saving={saving || Boolean(review?.loading)}
                      controlStyle={controlStyle}
                      onReset={() => updatePaints(() => [])}
                      showOriginal={showOriginal}
                      onToggleOriginal={toggleOriginal}
                      onUndo={undo}
                      onRedo={redo}
                      canUndo={canUndo}
                      canRedo={canRedo}
                      onDownload={saveImage}
                      onSaveUpdate={onSaveUpdate && loadLots ? openReview : null}
                      onSkipColoring={onSkipColoring}
                      unlinked={canLink ? clickedPaints.filter((paint) => !paint.lot).length : 0}
                    />
                  ) : null}
                  {painting && linkingPaint ? (
                    <LotLinkPanel
                      key={`${linkingPaint.x}-${linkingPaint.y}`}
                      paint={linkingPaint}
                      lots={lotOptions}
                      error={lotsError}
                      linkedIds={linkedIds}
                      palette={palette}
                      onLink={linkLot}
                      onUnlink={() => linkLot(null)}
                      onClose={() => setLinking(null)}
                    />
                  ) : null}
                </Box>

                {showSidebar ? (
                <Box w={{ base: '100%', lg: '280px' }} flexShrink={0}>
                  {showShapes || !sizesOk ? (
                    <SizeReport
                      annotated={annotated}
                      natural={natural}
                      fit={fit}
                      matches={matches}
                      reshaped={reshaped}
                      frameIssue={frameIssue}
                      lots={shapes.length}
                    />
                  ) : null}
                  {showShapes ? (
                  <>
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
                          bg={shape.id === selected ? SELECTED : (statusSwatch(shape)?.color ?? shape.color)}
                          border={statusSwatch(shape) ? '1px solid rgba(0,0,0,0.25)' : undefined}
                          title={statusSwatch(shape)?.label}
                          flexShrink={0}
                        />
                        <Text fontFamily={FONT} fontSize="12.5px" color={COLORS.heading} truncate>
                          {shape.label}
                        </Text>
                        {shapePaint.has(shape.id) ? (
                          <Flex align="center" gap="4px" ml="auto" flexShrink={0}>
                            <Box
                              boxSize="10px"
                              borderRadius="3px"
                              bg={palette[shapePaint.get(shape.id).status]}
                              border="1px solid rgba(0,0,0,0.25)"
                            />
                            <Text fontFamily={FONT} fontSize="11px" color={COLORS.subtle}>
                              {paintLabel(shapePaint.get(shape.id))}
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
                  </>
                  ) : null}
                  {painting && clickedPaints.length ? (
                    <>
                      <Text mt="14px" mb="6px" fontFamily={FONT} fontWeight="600" fontSize="13px" color={COLORS.heading}>
                        Clicked lots ({clickedPaints.length})
                      </Text>
                      <Flex direction="column" gap="4px" maxH="220px" overflowY="auto">
                        {clickedPaints.map((paint) => (
                          <Flex
                            key={`${paint.x}-${paint.y}`}
                            as="button"
                            type="button"
                            align="center"
                            gap="8px"
                            px="8px"
                            py="6px"
                            borderRadius="8px"
                            textAlign="left"
                            bg={linking && linking.x === paint.x && linking.y === paint.y ? COLORS.statusBg : 'transparent'}
                            cursor={canLink ? 'pointer' : 'default'}
                            _hover={canLink ? { bg: COLORS.hoverBg } : undefined}
                            title={canLink ? 'Link this area to a lot in the table' : undefined}
                            onClick={() => canLink && openLinker(paint)}
                          >
                            <Box boxSize="10px" borderRadius="3px" bg={palette[paint.status]} border="1px solid rgba(0,0,0,0.25)" flexShrink={0} />
                            <Text fontFamily={FONT} fontSize="12.5px" color={COLORS.heading} truncate>
                              {paint.lot ? paint.lot.lotNo : 'Not linked'}
                            </Text>
                            <Text ml="auto" fontFamily={FONT} fontSize="11px" color={paint.lot ? COLORS.subtle : '#B45309'} flexShrink={0}>
                              {paint.lot ? paintLabel(paint) : 'pick a lot'}
                            </Text>
                          </Flex>
                        ))}
                      </Flex>
                    </>
                  ) : null}
                </Box>
                ) : null}
              </Flex>
            </Dialog.Body>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
      <SaveReviewDialog
        palette={palette}
        open={Boolean(review && !review.loading)}
        review={review && !review.loading ? review : null}
        saving={saving}
        error={review?.saveError || saveError}
        controlStyle={controlStyle}
        projectCode={projectCode}
        sales={sales}
        onSaleChange={(id, patch) => {
          setSales((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
          setReview((current) => (current?.saveError ? { ...current, saveError: '' } : current))
        }}
        onCancel={() => setReview(null)}
        onConfirm={() => confirmSave(true)}
        onSaveMapOnly={allowMapOnlySave && review?.plan?.changes.length ? () => confirmSave(false) : null}
      />
      <DiscardColorsDialog
        open={discardOpen}
        message={closeConfirm}
        onCancel={() => setDiscardOpen(false)}
        onDiscard={() => {
          setDiscardOpen(false)
          onClose()
        }}
      />
    </Dialog.Root>
  )
}

/** In-app replacement for the browser confirm shown when closing with unsaved colors. */
function DiscardColorsDialog({ open, message, onCancel, onDiscard }) {
  return (
    <Dialog.Root open={open} onOpenChange={({ open: next }) => !next && onCancel()} placement="center" size="sm">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px="16px">
          <Dialog.Content bg={COLORS.surface} borderRadius="16px" maxW="440px" overflow="hidden">
            <Dialog.Header borderBottom="1px solid" borderColor={COLORS.border} py="18px" pr="56px">
              <Flex align="center" gap="10px">
                <Icon as={LuTriangleAlert} boxSize="20px" color="#B45309" flexShrink={0} />
                <Dialog.Title fontFamily="'Plus Jakarta Sans', Inter, system-ui, sans-serif" fontSize="18px" color={COLORS.heading}>
                  Discard unsaved colors?
                </Dialog.Title>
              </Flex>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild top="14px" right="14px">
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
            <Dialog.Body py="18px">
              <Text fontFamily={FONT} fontSize="14px" lineHeight="22px" color={COLORS.muted}>
                {message}
              </Text>
            </Dialog.Body>
            <Dialog.Footer borderTop="1px solid" borderColor={COLORS.border} py="16px" gap="10px">
              <Box
                as="button"
                type="button"
                onClick={onCancel}
                h="38px"
                px="16px"
                borderRadius="8px"
                border="1px solid"
                borderColor={COLORS.border}
                bg={COLORS.surface}
                fontFamily={FONT}
                fontWeight="600"
                fontSize="14px"
                color={COLORS.heading}
                cursor="pointer"
                _hover={{ bg: COLORS.hoverBg }}
              >
                Keep editing
              </Box>
              <Box
                as="button"
                type="button"
                onClick={onDiscard}
                h="38px"
                px="16px"
                borderRadius="8px"
                bg="#B91C1C"
                fontFamily={FONT}
                fontWeight="600"
                fontSize="14px"
                color="#FFFFFF"
                cursor="pointer"
                _hover={{ bg: '#991B1B' }}
              >
                Discard colors
              </Box>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

function statusLabel(value, reserveType) {
  const label = LOT_STATUS_OPTIONS.find((option) => option.value === String(value).toLowerCase())?.label ?? (value || 'No status')
  // Only a reserved lot has a reserve type worth naming.
  return reserveType !== undefined && /^(reserved|rsv-p)$/i.test(String(value))
    ? `${label} · ${reserveTypeLabel(reserveType) || 'Default'}`
    : label
}

/**
 * The last look before saving: every lot whose status the table will get, and
 * every coloured lot that will not change (with why). Nothing is written until
 * Save update is pressed here.
 */
function SaveReviewDialog({ open, review: current, palette, saving, error, controlStyle, projectCode, sales, onSaleChange, onCancel, onConfirm, onSaveMapOnly }) {
  /*
   * This dialog stays mounted and is opened through `open`. Mounting it already
   * open, inside the open map dialog, let StrictMode's mount–unmount–mount read
   * as a dismissal, and the review closed the moment it appeared. The last
   * review is kept so the content does not empty while the dialog animates shut.
   */
  const [last, setLast] = useState(current)
  if (current && current !== last) setLast(current)
  const review = current ?? last
  const plan = review?.plan
  const text = { fontFamily: FONT, fontSize: '12.5px', color: COLORS.heading }
  return (
    <Dialog.Root open={open} onOpenChange={({ open: next }) => (next || saving ? null : onCancel())} placement="center" size="md">
      {review ? (
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
                    New map colors ({review.painted.length + plan.mapOnly})
                  </Text>
                  <Flex direction="column" gap="4px" mb="14px">
                    {review.painted.map((entry) => (
                      <Flex key={entry.label} gap="8px" align="center" px="8px" py="5px" borderRadius="8px" bg={COLORS.canvas}>
                        <Text {...text} fontWeight="600" flex="1" truncate>
                          {entry.label}
                        </Text>
                        <Box boxSize="12px" borderRadius="3px" bg={palette[entry.fill]} border="1px solid rgba(0,0,0,0.25)" />
                        <Text {...text} fontWeight="700">
                          {paintLabel(entry.paint)}
                        </Text>
                      </Flex>
                    ))}
                  </Flex>
                  <Text {...text} fontWeight="600" mb="6px">
                    {plan.changes.length
                      ? `${plan.changes.length} lot status${plan.changes.length === 1 ? '' : 'es'} will also change in the table`
                      : 'The lot table already matches these colors — only the map image is saved.'}
                  </Text>
                  <Flex direction="column" gap="4px">
                    {plan.changes.map((change) => (
                      <Box key={change.id} px="8px" py="5px" borderRadius="8px" bg={COLORS.canvas}>
                        <Flex gap="8px" align="center">
                          <Text {...text} fontWeight="600" flex="1" truncate>
                            {change.lotNo}
                          </Text>
                          <Text {...text} color={COLORS.subtle}>
                            {statusLabel(change.from, change.fromReserveType)}
                          </Text>
                          <Text {...text}>→</Text>
                          <Text {...text} fontWeight="700">
                            {statusLabel(change.status, change.reserveType)}
                          </Text>
                        </Flex>
                        {/*
                          * A sold lot names who sold it (a broker is credited on the Brokers page) and
                          * to whom; a client reservation names its client. A company one names no one.
                          */}
                        {change.status === 'sold' || isClientReservation(change) ? (
                          <SaleFields
                            change={change}
                            sale={sales[change.id] ?? {}}
                            projectCode={projectCode}
                            disabled={saving}
                            textStyle={text}
                            onChange={(patch) => onSaleChange(change.id, patch)}
                          />
                        ) : null}
                      </Box>
                    ))}
                  </Flex>
                  {plan.upToDate.length ? (
                    <Flex direction="column" gap="2px" mt="6px">
                      {plan.upToDate.map((entry) => (
                        <Text key={entry.label} {...text} color={COLORS.subtle}>
                          <Box as="span" fontWeight="600" color={COLORS.heading}>
                            {entry.label}
                          </Box>{' '}
                          — already {statusLabel(entry.status, entry.reserveType)} in the table.
                        </Text>
                      ))}
                    </Flex>
                  ) : null}
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
                <>
                  {onSaveMapOnly ? (
                    <Flex
                      {...controlStyle}
                      opacity={saving ? 0.55 : 1}
                      title="Save the new colors without changing lot statuses in the table"
                      onClick={saving ? undefined : onSaveMapOnly}
                    >
                      Save map only (skip table)
                    </Flex>
                  ) : null}
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
                </>
              )}
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
      ) : null}
    </Dialog.Root>
  )
}

/** A change that reserves a lot for a client, who must then be named. */
const isClientReservation = (change) => change.status === 'reserved' && change.reserveType === 'client'

/** Who sold or reserved it (a broker or a sales agent) and the client, for a lot the review turns sold or reserves for a client. */
function SaleFields({ change, sale, projectCode, disabled, textStyle, onChange }) {
  const sold = change.status === 'sold'
  const fieldProps = { h: '32px', fontFamily: FONT, fontSize: '12.5px', bg: COLORS.surface, borderRadius: '8px' }
  const labelProps = { ...textStyle, color: COLORS.subtle, lineHeight: '32px', flexShrink: 0, w: '52px' }
  const linkProps = {
    as: 'button',
    type: 'button',
    ...textStyle,
    fontWeight: '600',
    color: COLORS.activeBg,
    cursor: disabled ? 'default' : 'pointer',
    _hover: { textDecoration: 'underline' },
  }
  // Skipped: the status still changes, but no one is named; the lot keeps what it had.
  if (sale.skip) {
    return (
      <Flex mt="6px" align="center" justify="space-between" gap="8px">
        <Text {...textStyle} color={COLORS.subtle}>
          Skipped — saved without who {sold ? 'sold' : 'reserved'} it or the client.
        </Text>
        <Box {...linkProps} onClick={disabled ? undefined : () => onChange({ skip: false })}>
          Undo
        </Box>
      </Flex>
    )
  }
  return (
    <Flex direction="column" gap="6px" mt="6px">
      {/* A sale and a client reservation alike name who brought the client in. */}
      {sold || isClientReservation(change) ? (
        <Flex gap="8px" align="flex-start">
          <Text {...labelProps}>{sold ? 'Sold by' : 'Reserved by'}</Text>
          <SellerPicker value={sale.seller} onChange={(seller) => onChange({ seller })} disabled={disabled} fieldProps={fieldProps} />
        </Flex>
      ) : null}
      <Flex gap="8px" align="flex-start">
        <Text {...labelProps}>Client</Text>
        <ClientPicker
          value={sale.client ?? ''}
          onChange={(client, clientId) => onChange({ client, clientId })}
          disabled={disabled}
          fieldProps={fieldProps}
          defaults={{
            // A new client's broker is whoever sold or reserved the lot.
            brokerName: sale.seller?.name ?? '',
            ...(sold ? {} : { stage: 'reserved' }),
            projectCode: projectCode ?? '',
            unitDescription: unitDescription(projectCode, change.lotNo, sold ? 'Sold' : 'Reserved'),
          }}
        />
      </Flex>
      <Box
        {...linkProps}
        alignSelf="flex-end"
        title="Change the status without naming the broker, sales agent, or client"
        onClick={disabled ? undefined : () => onChange({ skip: true })}
      >
        Skip
      </Box>
    </Flex>
  )
}

/** A colour chip: a small square of `color`, outlined so pale ones still show. */
function Swatch({ color, size = '12px' }) {
  return <Box boxSize={size} borderRadius="3px" bg={color} border="1px solid rgba(0,0,0,0.3)" flexShrink={0} />
}

/**
 * A colour wheel: hue around the rim, saturation from the centre out, and a
 * brightness slider under it. Dragging on the wheel or the slider reports the
 * colour as '#RRGGBB' through `onChange` at every move.
 */
function ColorWheel({ value, onChange, size = 150 }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value) ?? { h: 0, s: 0, v: 1 })
  // A colour typed elsewhere (the hex field) moves the marker too.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    const next = hexToHsv(value)
    if (next && hsvToHex(hsv.h, hsv.s, hsv.v) !== value) setHsv(next)
  }
  const wheelRef = useRef(null)
  const update = (next) => {
    setHsv(next)
    onChange(hsvToHex(next.h, next.s, next.v))
  }
  function pickAt(event) {
    const rect = wheelRef.current.getBoundingClientRect()
    const dx = event.clientX - rect.left - rect.width / 2
    const dy = event.clientY - rect.top - rect.height / 2
    // Hue runs clockwise from red at the top, as the conic gradient draws it.
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    update({ ...hsv, h, s: Math.min(1, Math.hypot(dx, dy) / (rect.width / 2)) })
  }
  const rad = (hsv.h * Math.PI) / 180
  return (
    <Flex direction="column" align="center" gap="8px" flexShrink={0}>
      <Box
        ref={wheelRef}
        position="relative"
        boxSize={`${size}px`}
        borderRadius="50%"
        cursor="crosshair"
        touchAction="none"
        role="slider"
        aria-label="Hue and saturation"
        aria-valuetext={hsvToHex(hsv.h, hsv.s, hsv.v)}
        style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          pickAt(event)
        }}
        onPointerMove={(event) => {
          if (event.buttons & 1) pickAt(event)
        }}
      >
        <Box position="absolute" inset="0" borderRadius="50%" style={{ background: 'radial-gradient(circle closest-side, #fff, rgba(255,255,255,0))' }} />
        <Box position="absolute" inset="0" borderRadius="50%" bg="#000" opacity={1 - hsv.v} />
        <Box
          position="absolute"
          left={`${50 + 50 * hsv.s * Math.sin(rad)}%`}
          top={`${50 - 50 * hsv.s * Math.cos(rad)}%`}
          boxSize="16px"
          borderRadius="50%"
          border="2px solid #FFFFFF"
          boxShadow="0 0 0 1px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.4)"
          transform="translate(-50%, -50%)"
          pointerEvents="none"
          bg={hsvToHex(hsv.h, hsv.s, hsv.v)}
        />
      </Box>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(hsv.v * 100)}
        aria-label="Brightness"
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => update({ ...hsv, v: Number(event.target.value) / 100 })}
        style={{
          width: `${size}px`,
          height: '10px',
          borderRadius: '999px',
          appearance: 'none',
          cursor: 'pointer',
          background: `linear-gradient(to right, #000, ${hsvToHex(hsv.h, hsv.s, 1)})`,
        }}
      />
    </Flex>
  )
}

/**
 * Choosing one status's colour by hand: the wheel, the colour before and the
 * one chosen side by side, and its hex code to read or type. Lots already
 * painted with this status show the new colour on the map as it moves.
 */
function ManualColorPanel({ label, value, original, onChange, onUse, onCancel, button }) {
  const [text, setText] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(value)
  }
  return (
    <Flex gap="16px" align="center" flexWrap="wrap" p="12px" borderRadius="10px" bg={COLORS.canvas} border="1px solid" borderColor={COLORS.border}>
      <ColorWheel value={value} onChange={onChange} />
      <Flex direction="column" gap="10px" flex="1" minW="190px">
        <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle}>
          Preview · {label}
        </Text>
        <Flex align="center" gap="10px">
          <Flex direction="column" align="center" gap="4px">
            <Swatch color={original} size="40px" />
            <Text fontFamily={FONT} fontSize="11px" color={COLORS.subtle}>
              Before
            </Text>
          </Flex>
          <Text fontFamily={FONT} fontSize="16px" color={COLORS.subtle} pb="18px">
            {'\u2192'}
          </Text>
          <Flex direction="column" align="center" gap="4px">
            <Swatch color={value} size="40px" />
            <Text fontFamily={FONT} fontSize="11px" fontWeight="600" color={COLORS.heading}>
              New
            </Text>
          </Flex>
          <Box
            as="input"
            value={text}
            aria-label={`${label} color code`}
            maxLength={7}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const next = event.target.value.toUpperCase()
              setText(next)
              if (/^#[0-9A-F]{6}$/.test(next)) onChange(next)
            }}
            ml="auto"
            w="92px"
            h="32px"
            px="8px"
            borderRadius="8px"
            border="1px solid"
            borderColor={COLORS.border}
            bg={COLORS.surface}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize="13px"
            color={COLORS.heading}
          />
        </Flex>
        <Text fontFamily={FONT} fontSize="11.5px" color={COLORS.subtle}>
          Lots already colored {label} show the new color on the map as you pick.
        </Text>
        <Flex gap="6px">
          <Box {...button.primary} onClick={onUse}>
            Use this color
          </Box>
          <Box {...button.secondary} onClick={onCancel}>
            Cancel
          </Box>
        </Flex>
      </Flex>
    </Flex>
  )
}

/**
 * The legend-matching prompt, over the map where the click has to land. While
 * picking: which swatch to click now, big enough to notice, a strip of every
 * status (done ones ticked with their new colour), and a colour wheel for
 * choosing the current one by hand. Once every status is done: a confirmation
 * listing each colour before and after \u2014 nothing is saved until it is accepted,
 * and a status can be picked again from it.
 */
function LegendPickBanner({ picking, palette, saved, onSkip, onDone, onPreview, onUse, onRepick, onApply, onCancel }) {
  const confirming = picking.length === 0
  const current = MAP_LOT_FILL.find((option) => option.value === picking[0])
  // The status open on the colour wheel, with its colour from before the wheel moved it.
  const [manual, setManual] = useState(null) // null | { status, original }
  const manualOpen = Boolean(current && manual?.status === current.value)
  const base = {
    as: 'button',
    type: 'button',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    h: '32px',
    px: '14px',
    borderRadius: '8px',
    fontFamily: FONT,
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
  }
  const button = {
    primary: { ...base, bg: COLORS.brandGreen, color: '#FFFFFF', _hover: { bg: '#00541F' } },
    secondary: { ...base, bg: COLORS.surface, color: COLORS.heading, border: '1px solid', borderColor: COLORS.border, _hover: { bg: COLORS.hoverBg } },
  }
  const changed = MAP_LOT_FILL.filter(({ value }) => palette[value] !== saved[value]).length
  function closeManual(restore) {
    if (restore && manual) onPreview(manual.status, manual.original)
    setManual(null)
  }

  return (
    <Flex
      role="status"
      aria-live="polite"
      position="absolute"
      top="12px"
      left="50%"
      transform="translateX(-50%)"
      zIndex={2}
      direction="column"
      gap="10px"
      w="min(600px, calc(100% - 24px))"
      maxH="calc(100% - 24px)"
      overflowY="auto"
      p="14px 16px"
      bg={COLORS.surface}
      color={COLORS.heading}
      border="1px solid"
      borderColor={COLORS.border}
      borderRadius="12px"
      boxShadow="0 8px 24px rgba(0, 0, 0, 0.16)"
      // The banner's own clicks are not pans of the map underneath.
      onPointerDown={(event) => event.stopPropagation()}
      css={
        confirming || manualOpen
          ? undefined
          : { animation: 'legendPulse 1.6s ease-in-out infinite', '@keyframes legendPulse': { '0%, 100%': { boxShadow: '0 8px 24px rgba(0,0,0,0.16)' }, '50%': { boxShadow: '0 8px 32px rgba(0,0,0,0.3)' } } }
      }
    >
      <Flex align="center" gap="10px">
        <Flex align="center" justify="center" boxSize="34px" borderRadius="999px" bg={COLORS.hoverBg} color={COLORS.brandGreen} flexShrink={0}>
          <Icon as={confirming ? LuCheck : LuPipette} boxSize="18px" />
        </Flex>
        <Box flex="1" minW={0}>
          <Text fontFamily={FONT} fontSize="11px" fontWeight="600" letterSpacing="0.06em" textTransform="uppercase" color={COLORS.subtle}>
            {confirming ? 'Custom \u00b7 review' : `Custom`}
          </Text>
          <Text fontFamily={FONT} fontSize="17px" fontWeight="700" lineHeight="1.3">
            {confirming ? (
              'Use these legend colors?'
            ) : (
              <>
                {manualOpen ? 'Choose the ' : 'Click the '}
                <Box as="span" px="6px" borderRadius="4px" bg="#1D4ED8" color="#FFFFFF">
                  {current?.label.toUpperCase()}
                </Box>
                {manualOpen ? ' color on the wheel' : ' swatch in the map\u2019s legend'}
              </>
            )}
          </Text>
        </Box>
      </Flex>

      {confirming ? (
        <>
          <Flex direction="column" gap="4px">
            {MAP_LOT_FILL.map(({ value, label }) => {
              const differs = palette[value] !== saved[value]
              return (
                <Flex
                  key={value}
                  as="button"
                  type="button"
                  align="center"
                  gap="10px"
                  px="10px"
                  py="6px"
                  borderRadius="8px"
                  textAlign="left"
                  bg={differs ? COLORS.hoverBg : 'transparent'}
                  cursor="pointer"
                  _hover={{ bg: COLORS.statusBg }}
                  title={`Pick ${label} again`}
                  onClick={() => onRepick(value)}
                >
                  <Text fontFamily={FONT} fontSize="13px" fontWeight="600" w="72px">
                    {label}
                  </Text>
                  <Swatch color={saved[value]} size="18px" />
                  <Text fontFamily={FONT} fontSize="13px" color={COLORS.subtle}>
                    {'\u2192'}
                  </Text>
                  <Swatch color={palette[value]} size="18px" />
                  <Text fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="12px" color={COLORS.subtle}>
                    {palette[value]}
                  </Text>
                  <Text ml="auto" fontFamily={FONT} fontSize="11px" color={differs ? COLORS.brandGreen : COLORS.subtle} fontWeight="600">
                    {differs ? 'changed' : 'unchanged'}
                  </Text>
                </Flex>
              )
            })}
          </Flex>
          <Flex gap="6px" justify="flex-end" flexWrap="wrap">
            <Box {...button.secondary} onClick={onCancel}>
              Cancel
            </Box>
            <Box {...button.primary} onClick={onApply}>
              <Icon as={LuCheck} boxSize="14px" />
              {changed ? `Use these colors (${changed} changed)` : 'Use these colors'}
            </Box>
          </Flex>
        </>
      ) : (
        <>
          <Flex align="center" gap="6px" flexWrap="wrap">
            {MAP_LOT_FILL.map(({ value, label }) => {
              const done = !picking.includes(value)
              const now = value === picking[0]
              return (
                <Flex
                  key={value}
                  align="center"
                  gap="5px"
                  h="26px"
                  px="8px"
                  borderRadius="999px"
                  bg={now ? '#1D4ED8' : COLORS.hoverBg}
                  color={now ? '#FFFFFF' : COLORS.heading}
                  opacity={done || now ? 1 : 0.7}
                  fontFamily={FONT}
                  fontSize="12px"
                  fontWeight={now ? '700' : '600'}
                >
                  <Swatch color={palette[value]} />
                  {label}
                  {done ? <Icon as={LuCheck} boxSize="12px" /> : null}
                </Flex>
              )
            })}
          </Flex>
          {manualOpen ? (
            <ManualColorPanel
              key={current.value}
              label={current.label}
              value={palette[current.value]}
              original={manual.original}
              button={button}
              onChange={(hex) => onPreview(current.value, hex)}
              onUse={() => {
                const status = current.value
                setManual(null)
                onUse(status, palette[status])
              }}
              onCancel={() => closeManual(true)}
            />
          ) : null}
          <Flex gap="6px" justify="flex-end" flexWrap="wrap">
            {manualOpen ? null : (
              <Box {...button.secondary} mr="auto" onClick={() => setManual({ status: current.value, original: palette[current.value] })}>
                <Icon as={LuPalette} boxSize="14px" />
                Pick manually
              </Box>
            )}
            <Box
              {...button.secondary}
              onClick={() => {
                closeManual(true)
                onSkip()
              }}
            >
              Skip
            </Box>
            <Box
              {...button.primary}
              onClick={() => {
                closeManual(true)
                onDone()
              }}
            >
              Done
            </Box>
          </Flex>
        </>
      )}
    </Flex>
  )
}

/**
 * "Which lot is this?" — shown after an area is colored by clicking, where there
 * is no annotation to name it. Linking it to a row of the lot table is what lets
 * Save Update change that lot's status; skipping leaves it a map-only color.
 */
function LotLinkPanel({ paint, lots, error, linkedIds, palette, onLink, onUnlink, onClose }) {
  const [filter, setFilter] = useState('')
  const inputRef = useRef(null)
  useEffect(() => inputRef.current?.focus(), [])
  const key = filter.toLowerCase().replace(/[^a-z0-9]/g, '')
  const shown = (lots ?? []).filter((lot) => !key || lot.key.includes(key)).slice(0, 60)
  const status = FILL_BY_STATUS[paint.status]?.label ?? paint.status
  return (
    <Box mt="10px" p="10px" border="1px solid" borderColor={COLORS.activeBg} borderRadius="10px" bg={COLORS.surface}>
      <Flex align="center" gap="8px" flexWrap="wrap" mb="8px">
        <Box boxSize="12px" borderRadius="3px" bg={palette[paint.status]} border="1px solid rgba(0,0,0,0.25)" />
        <Text fontFamily={FONT} fontSize="13px" fontWeight="600" color={COLORS.heading}>
          {paint.lot ? `Colored ${status} · linked to ${paint.lot.lotNo}` : `Colored ${status} — which lot is this?`}
        </Text>
        <Flex ml="auto" gap="6px">
          {/* Every clicked lot has to be linked before saving, so there is no skipping — only closing once linked. */}
          {paint.lot ? (
            <>
              <Box as="button" type="button" fontFamily={FONT} fontSize="12px" color={COLORS.subtle} cursor="pointer" _hover={{ textDecoration: 'underline' }} onClick={onUnlink}>
                Unlink
              </Box>
              <Box as="button" type="button" fontFamily={FONT} fontSize="12px" color={COLORS.subtle} cursor="pointer" _hover={{ textDecoration: 'underline' }} onClick={onClose}>
                Close
              </Box>
            </>
          ) : null}
        </Flex>
      </Flex>
      {error ? (
        <Text role="alert" fontFamily={FONT} fontSize="12px" color="#B91C1C">
          The lots could not be loaded: {error}
        </Text>
      ) : !lots ? (
        <Flex align="center" gap="8px">
          <Spinner size="xs" />
          <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
            Loading lots…
          </Text>
        </Flex>
      ) : (
        <>
          <Box
            as="input"
            ref={inputRef}
            type="search"
            value={filter}
            placeholder="Type the lot number, e.g. C L6 or B2 L14"
            aria-label="Find the lot"
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && shown.length === 1) onLink(shown[0])
              if (event.key === 'Escape' && paint.lot) onClose()
            }}
            w="100%"
            h="32px"
            px="10px"
            mb="6px"
            borderRadius="8px"
            border="1px solid"
            borderColor={COLORS.border}
            fontFamily={FONT}
            fontSize="13px"
          />
          <Flex direction="column" gap="2px" maxH="168px" overflowY="auto">
            {shown.map((lot) => {
              const chosen = paint.lot?.id === lot.id
              const taken = !chosen && linkedIds.has(lot.id)
              return (
                <Flex
                  key={lot.id}
                  as="button"
                  type="button"
                  align="center"
                  gap="8px"
                  px="8px"
                  py="5px"
                  borderRadius="6px"
                  textAlign="left"
                  bg={chosen ? COLORS.statusBg : 'transparent'}
                  cursor="pointer"
                  _hover={{ bg: COLORS.hoverBg }}
                  onClick={() => onLink(lot)}
                >
                  <Text fontFamily={FONT} fontSize="12.5px" fontWeight="600" color={COLORS.heading}>
                    {lot.lotNo}
                  </Text>
                  <Text fontFamily={FONT} fontSize="11.5px" color={COLORS.subtle} truncate>
                    {[lot.phase !== null && lot.phase !== '' ? `Phase ${lot.phase}` : '', lot.category, lot.status].filter(Boolean).join(' · ')}
                  </Text>
                  {taken ? (
                    <Text ml="auto" fontFamily={FONT} fontSize="11px" color="#B45309" flexShrink={0}>
                      already linked
                    </Text>
                  ) : null}
                </Flex>
              )
            })}
            {shown.length ? null : (
              <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
                No lot matches “{filter}”.
              </Text>
            )}
          </Flex>
        </>
      )}
    </Box>
  )
}

/**
 * The colouring controls: which status a click paints, and what to do with the
 * result — download it, or review and save it as the slot's map and the lots' statuses.
 */
function PaintToolbar({
  brush,
  onBrush,
  reserveType,
  onReserveType,
  palette,
  // Matching the map legend is under way (the banner on the map leads it).
  matching,
  onMatchLegend,
  onDefaultPalette,
  tolerance,
  onTolerance,
  // 'polygon' | 'lines' for a map with annotations; null hides the choice.
  shapeMode,
  onShapeMode,
  count,
  ready,
  loadError,
  message,
  saving,
  controlStyle,
  onReset,
  showOriginal,
  onToggleOriginal,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDownload,
  onSaveUpdate,
  onSkipColoring,
  // Clicked lots not yet linked to a lot in the table; Save Update waits for them.
  unlinked = 0,
}) {
  const chip = (value, label, swatch, chosen = brush === value, onPick = onBrush) => {
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
        onClick={() => onPick(value)}
        _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
      >
        {swatch}
        {label}
      </Flex>
    )
  }
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const toleranceId = `${baseId}-tolerance`
  const moreId = `${baseId}-more`
  const [moreOpen, setMoreOpen] = useState(false)
  // Settings behind More options that are off their default.
  const changedCount = tolerance !== TOLERANCE_DEFAULT ? 1 : 0
  const busy = !ready || saving
  const action = (props) => ({
    ...controlStyle,
    opacity: busy || count === 0 ? 0.55 : 1,
    cursor: busy || count === 0 ? 'not-allowed' : 'pointer',
    'aria-disabled': busy || count === 0,
    ...props,
    onClick: busy || count === 0 ? undefined : props.onClick,
  })

  return (
    <Box mt="10px" p="10px" border="1px solid" borderColor={COLORS.border} borderRadius="10px" bg={COLORS.canvas}>
      <Flex align="center" gap="6px" flexWrap="wrap">
        <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
          Color as
        </Text>
        {MAP_LOT_FILL.map(({ value, label }) =>
          chip(value, label, <Box boxSize="12px" borderRadius="3px" bg={palette[value]} border="1px solid rgba(0,0,0,0.25)" />),
        )}
        {chip(ORIGINAL, 'Original', <Icon as={LuEraser} boxSize="13px" />)}
      </Flex>
      {/*
        * Which colours the statuses paint: the default legend, or the colours of
        * the legend printed on this map, read by clicking each of its swatches.
        */}
      <Flex mt="8px" align="center" gap="6px" flexWrap="wrap" role="group" aria-label="Legend colors">
        <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
          Legend colors
        </Text>
        {chip('palette-default', 'Default', null, !matching && isDefaultPalette(palette), onDefaultPalette)}
        {chip(
          'palette-legend',
          'Custom',
          <Icon as={LuPipette} boxSize="13px" />,
          matching || !isDefaultPalette(palette),
          onMatchLegend,
        )}
      </Flex>
      {brush === 'reserved' ? (
        <Flex mt="8px" align="center" gap="6px" flexWrap="wrap" role="group" aria-label="Reserved for">
          <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
            Reserved for
          </Text>
          {RESERVE_TYPES.map(({ value, label }) =>
            chip(value, value ? `${label} Reserved` : label, null, reserveType === value, onReserveType),
          )}
        </Flex>
      ) : null}
      {/*
        * The finer settings — annotated-lot shapes and tolerance — sit behind
        * More options so the everyday controls stay short. The toggle says when
        * one of them is off its default, so a hidden change is not forgotten.
        */}
      <Flex mt="8px" align="center" gap="6px" flexWrap="wrap">
        <Flex
          as="button"
          type="button"
          align="center"
          gap="6px"
          h="30px"
          px="10px"
          borderRadius="999px"
          border="1px solid"
          borderColor={moreOpen ? COLORS.heading : COLORS.border}
          bg={moreOpen ? COLORS.hoverBg : COLORS.surface}
          fontFamily={FONT}
          fontSize="12px"
          fontWeight="600"
          color={COLORS.heading}
          cursor="pointer"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => setMoreOpen((open) => !open)}
          _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
        >
          <Icon as={LuSlidersHorizontal} boxSize="13px" />
          More options
          {changedCount && !moreOpen ? (
            <Text as="span" fontWeight="500" color={COLORS.subtle}>
              · {changedCount} changed
            </Text>
          ) : null}
          <Icon as={LuChevronDown} boxSize="13px" transform={moreOpen ? 'rotate(180deg)' : undefined} transition="transform 120ms ease" />
        </Flex>
      </Flex>
      <Box id={moreId} hidden={!moreOpen} mt="8px" pl="10px" borderLeft="2px solid" borderColor={COLORS.border}>
      {shapeMode ? (
        <Flex align="center" gap="6px" flexWrap="wrap" role="group" aria-label="Annotated lots">
          <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
            Annotated lots (optional)
          </Text>
          {chip('polygon', 'Follow polygon', <Icon as={LuShapes} boxSize="13px" />, shapeMode === 'polygon', onShapeMode)}
          {chip('lines', 'Follow lot lines', null, shapeMode === 'lines', onShapeMode)}
        </Flex>
      ) : null}
      {/*
        * How far a lot's colour reaches. Default is what colouring has always
        * used; tighter keeps to colours very close to the fill, looser takes in
        * faded or unevenly printed fills. Painted lots follow it at once.
        */}
      <Flex mt={shapeMode ? '8px' : 0} align="center" gap="8px" flexWrap="wrap">
        <Text as="label" htmlFor={toleranceId} fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
          Tolerance
        </Text>
        <input
          id={toleranceId}
          type="range"
          min={Math.round(TOLERANCE_MIN * 100)}
          max={Math.round(TOLERANCE_MAX * 100)}
          step={10}
          value={Math.round(tolerance * 100)}
          aria-valuetext={`${Math.round(tolerance * 100)}%${tolerance === TOLERANCE_DEFAULT ? ', default' : ''}`}
          onChange={(event) => onTolerance(Number(event.target.value) / 100)}
          style={{ width: '180px', accentColor: COLORS.brandGreen, cursor: 'pointer' }}
        />
        <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.heading} minW="92px">
          {Math.round(tolerance * 100)}%{tolerance === TOLERANCE_DEFAULT ? ' · Default' : ''}
        </Text>
        {tolerance !== TOLERANCE_DEFAULT ? chip('tolerance-default', 'Use default', null, false, () => onTolerance(TOLERANCE_DEFAULT)) : null}
      </Flex>
      </Box>
      <Flex mt="10px" gap="8px" flexWrap="wrap" align="center">
        {/* Undo and redo only need a step to go to — they work with no lot coloured too. */}
        {[
          { label: 'Undo', icon: LuUndo2, onClick: onUndo, enabled: canUndo, keys: 'Ctrl+Z' },
          { label: 'Redo', icon: LuRedo2, onClick: onRedo, enabled: canRedo, keys: 'Ctrl+Y' },
        ].map(({ label, icon, onClick, enabled, keys }) => {
          const off = !ready || saving || !enabled
          return (
            <Flex
              key={label}
              {...controlStyle}
              opacity={off ? 0.55 : 1}
              cursor={off ? 'not-allowed' : 'pointer'}
              aria-disabled={off}
              title={`${label} (${keys})`}
              onClick={off ? undefined : onClick}
            >
              <Icon as={icon} boxSize="14px" />
              {label}
            </Flex>
          )
        })}
        {/* Compare with the map before any colouring; press again for the colours. */}
        <Flex
          {...action({ onClick: onToggleOriginal })}
          aria-pressed={showOriginal}
          title={showOriginal ? 'Show the new colors again' : 'Show the map as it was, before coloring'}
          bg={showOriginal ? COLORS.hoverBg : controlStyle.bg}
          borderColor={showOriginal ? COLORS.heading : controlStyle.borderColor}
        >
          <Icon as={showOriginal ? LuEye : LuEyeOff} boxSize="14px" />
          {showOriginal ? 'Show colors' : 'Show original'}
        </Flex>
        <Flex {...action({ onClick: onReset })}>Reset colors</Flex>
        <Flex {...action({ onClick: onDownload })}>
          <Icon as={LuDownload} boxSize="14px" />
          Download image
        </Flex>
        {onSkipColoring ? (
          <Flex
            {...controlStyle}
            opacity={saving ? 0.55 : 1}
            cursor={saving ? 'not-allowed' : 'pointer'}
            aria-disabled={saving}
            onClick={saving ? undefined : onSkipColoring}
          >
            Skip map coloring
          </Flex>
        ) : null}
        {onSaveUpdate ? (
          <Flex
            {...action({ onClick: onSaveUpdate })}
            {...(unlinked
              ? { opacity: 0.55, cursor: 'not-allowed', 'aria-disabled': true, onClick: undefined, title: 'Pick a lot for every clicked area first' }
              : {})}
            bg={COLORS.brandGreen}
            borderColor={COLORS.brandGreen}
            color="#FFFFFF"
            _hover={{ bg: '#00541F' }}
          >
            {saving ? <Spinner size="xs" /> : <Icon as={LuSave} boxSize="14px" />}
            {saving ? 'Checking…' : 'Save Update'}
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
        {message}
      </Text>
    </Box>
  )
}

/** The two sizes side by side, and what was done about a mismatch. */
function SizeReport({ annotated, natural, fit, matches, reshaped, frameIssue, lots = null }) {
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
      {frameIssue ? (
        <Flex mt="6px" gap="6px" align="flex-start">
          <Icon as={LuTriangleAlert} boxSize="14px" color="#B45309" mt="2px" flexShrink={0} />
          <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
            The sizes match, but the picture inside this SVG is drawn at {frameIssue.picture.width} ×{' '}
            {frameIssue.picture.height} — short of its {frameIssue.frame.width} × {frameIssue.frame.height} frame, a
            rounding in the export. The annotations drift from the lots, more toward the right and bottom. Use “Fit map
            to its frame” to stretch the picture to fill it and store the corrected map.
          </Text>
        </Flex>
      ) : matches ? (
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
      {/* Every annotation outlines one lot, so their count is the map's lot count. */}
      {lots !== null ? (
        <Box mt="8px" pt="6px" borderTop="1px solid" borderColor={COLORS.border}>
          {row(LuLayoutGrid, 'Lots on this map', lots.toLocaleString())}
        </Box>
      ) : null}
    </Box>
  )
}
