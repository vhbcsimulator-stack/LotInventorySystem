import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Box, CloseButton, Dialog, Flex, Icon, NativeSelect, Portal, Spinner, Text } from '@chakra-ui/react'
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
  LuPencil,
  LuPipette,
  LuSave,
  LuShapes,
  LuPaintBucket,
  LuSlidersHorizontal,
  LuRedo2,
  LuTriangleAlert,
  LuType,
  LuUndo2,
  LuWandSparkles,
  LuZoomIn,
  LuZoomOut,
} from 'react-icons/lu'
import useLotPainter from '@/components/projects/useLotPainter'
import { TOLERANCE_DEFAULT, TOLERANCE_MAX, TOLERANCE_MIN } from '@/components/projects/lotRecolor'
import {
  DEFAULT_PALETTE,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  isDefaultPalette,
  samePalette,
  loadPalette,
  parseColorCode,
  rgbToHex,
  savePalette,
} from '@/components/projects/legendPalette'
import {
  LOT_RING_COLOR,
  MARK_FONT,
  RING_SIZE_MAX,
  RING_SIZE_MIN,
  RING_THICKNESS_MAX,
  RING_THICKNESS_MIN,
  clampRingCenter,
  frameMisfit,
  isSvgUrl,
  strokePath,
} from '@/lib/svgMaps'
import { fillForStatus, lotsForLabel, planStatusUpdate } from '@/components/projects/lotStatusPlan'
import { SellerPicker } from '@/components/projects/SoldByPicker'
import { sellerFields } from '@/components/projects/seller'
import ClientPicker from '@/components/projects/ClientPicker'
import { unitDescription } from '@/data/clientsData'
import { LOT_STATUS_OPTIONS, lotTermsFor, subscribeToLots } from '@/data/projectsData'
import { fetchLegendColors, fetchProjectLegendColors, saveLegendColors } from '@/data/legendColorsData'
import { notifyFailed } from '@/lib/notify'
import { uiStatus } from '@/data/supabase'
import { COLORS, LOT_STATUS, MAP_LOT_FILL } from '@/theme/colors'

/** The brush that removes a lot's new colour, leaving the map's own. */
const ORIGINAL = 'original'
// The brush that erases a red circle printed into the map picture, leaving the lot's status alone.
const ERASE_RING = 'erase-ring'
/** The mark-up tools: drawing freehand, and writing text, on the map. */
const DRAW = 'draw'
const TEXT = 'text'
const marking = (brush) => brush === DRAW || brush === TEXT
/*
 * The pointer while picking a colour off the map: an eyedropper, black over a
 * white outline so it shows on any colour, with its tip — the bottom-left
 * corner — the point that is read. The crosshair stands in where custom
 * cursors are not drawn.
 */
const EYEDROPPER_SHAPE =
  '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>'
const EYEDROPPER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="#FFFFFF" stroke-width="4.5">${EYEDROPPER_SHAPE}</g>` +
    `<g stroke="#111827" stroke-width="2" fill="#FFFFFF">${EYEDROPPER_SHAPE}</g>` +
    '</svg>',
)}") 2 22, crosshair`
/** The colours marks can be drawn in. */
const MARK_COLORS = ['#111827', '#E11D1D', '#1D4ED8', '#16A34A', '#F59E0B', '#FFFFFF']
/** The colours offered for the rings of circled lots, red (the default) first; any other can be picked too. */
const RING_COLORS = [LOT_RING_COLOR, '#111827', '#1D4ED8', '#16A34A', '#F59E0B', '#7C3AED']
// A circled lot's background under its ring: Regular lots are white, Prime ones the legend's yellow.
const REGULAR_BACKGROUND = '#FFFFFF'
const PRIME_BACKGROUND = MAP_LOT_FILL.find(({ value }) => value === 'prime').color
/** Every new text box starts in black, whatever colour the brush was last in. */
const TEXT_DEFAULT_COLOR = '#111827'
/** The size marks start at: small. */
const MARK_SIZE_DEFAULT = 2
/** A text's height per step of Size, in mark units; and how small or large a text can be dragged. */
const TEXT_SCALE = 6
const TEXT_SIZE_MIN = 3
const TEXT_SIZE_MAX = 150
const MARK_SIZE_MIN = 1
const MARK_SIZE_MAX = 10
/** A mark's size step, as a share of the map's width, so marks look alike on any map. */
const MARK_UNIT = 1 / 1000
/** The weights text can be written in — the two every SVG reader draws in Arial. */
const TEXT_WEIGHTS = [
  { value: 'normal', label: 'Regular' },
  { value: 'bold', label: 'Bold' },
]
/** A point of the drawing under the pointer, in its own units. */
function pointIn(svg, event) {
  const matrix = svg?.getScreenCTM()
  if (!matrix) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return [point.x, point.y]
}
/** The text box's hint while empty. */
const TEXT_HINT = 'Text'
/** The text box's width: as wide as it was drawn, or as its text (or hint) needs if that is wider. */
const textBoxWidth = (draft) => Math.max(draft.boxWidth ?? 0, (Math.max(draft.value.length, TEXT_HINT.length) * 0.62 + 0.6) * draft.size)
/** Whether a colour is light — light text is typed on a dark box so it can be read. */
const isLightColor = (hex) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 160
}
/** The brush cursor: its ring's colour, and its thickness in screen pixels at any zoom. */
const BRUSH_CURSOR_COLOR = '#939393'
const BRUSH_CURSOR_WIDTH = 3
/** How far below a text's middle its baseline sits, as a share of its size. */
const TEXT_BASELINE = 0.35
/** A text turned by its rotate handle snaps level (or upright) within this many degrees; with Shift, to every 15°. */
const TEXT_ANGLE_SNAP = 4
/** A turned text's transform: about the left end of its middle line, where its box turns too. */
const textRotation = (angle, x, y) => (angle ? `rotate(${+angle.toFixed(1)} ${+x.toFixed(1)} ${+y.toFixed(1)})` : undefined)
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
function paintLabel({ status, reserveType, eraseRing }) {
  // A lot only cleared of its printed circle has no new status.
  if (!status) return eraseRing ? 'Circle removed · Available' : ''
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

/*
 * Marks — brush strokes and text — share the paint list with the lot paints,
 * so one Undo covers both; they are kept after the lot paints, and each kind
 * is changed without touching the other.
 */
const isMark = (paint) => paint.mark !== undefined
const withLotPaints = (prev, url, update) =>
  withPaints(prev, url, (list) => [...update(list.filter((paint) => !isMark(paint))), ...list.filter(isMark)])
const withMarks = (prev, url, update) =>
  withPaints(prev, url, (list) => [...list.filter((paint) => !isMark(paint)), ...update(list.filter(isMark))])

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
 * Brush strokes and text drawn on the map (see useLotPainter's `marks`), with
 * the stroke being drawn. Clicks pass through to the map, except while a mark
 * can be rubbed out (`onErase`) or a text opened to change it (`onEditText`).
 */
const MarksLayer = memo(function MarksLayer({ marks, live, editing, onErase, onEditText, onMoveText }) {
  // A text being dragged: { mark, startX, startY (screen), start: [x, y], offset: [dx, dy], moved }.
  const [moving, setMoving] = useState(null)
  if (!marks.length && !live) return null
  // With Text, a press on a text either drags it (once it travels) or, left still, opens it to change.
  const movable = (mark) =>
    onMoveText
      ? {
          cursor: 'move',
          onPointerDown: (event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            const start = pointIn(event.currentTarget.ownerSVGElement, event)
            if (start) setMoving({ mark, startX: event.clientX, startY: event.clientY, start, offset: [0, 0], moved: false })
          },
          onPointerMove: (event) => {
            if (moving?.mark !== mark) return
            if (!moving.moved && Math.hypot(event.clientX - moving.startX, event.clientY - moving.startY) <= DRAG_SLOP) return
            const point = pointIn(event.currentTarget.ownerSVGElement, event)
            if (point) setMoving({ ...moving, moved: true, offset: [point[0] - moving.start[0], point[1] - moving.start[1]] })
          },
          onPointerUp: (event) => {
            if (moving?.mark !== mark) return
            event.stopPropagation()
            setMoving(null)
            if (moving.moved) onMoveText(mark, ...moving.offset)
            else onEditText?.(mark)
          },
          onPointerCancel: () => setMoving(null),
          onClick: (event) => event.stopPropagation(),
        }
      : {}
  const pick = (mark, handler) =>
    handler
      ? {
          cursor: 'pointer',
          onPointerDown: (event) => event.stopPropagation(),
          onClick: (event) => {
            event.stopPropagation()
            handler(mark)
          },
        }
      : {}
  return (
    <g>
      {marks.map((mark, index) => {
        if (mark.mark === 'text') {
          // The text open in the box is shown there instead.
          if (mark === editing) return null
          const handler = onErase ?? onEditText
          const offset = moving?.mark === mark ? moving.offset : [0, 0]
          return (
            <text
              key={index}
              x={mark.x + offset[0]}
              y={mark.y + offset[1]}
              transform={textRotation(mark.angle, mark.x + offset[0], mark.y + offset[1] - mark.size * TEXT_BASELINE)}
              fill={mark.color}
              fontSize={mark.size}
              fontFamily={MARK_FONT}
              fontWeight={mark.weight ?? 'bold'}
              // Inline too: the page's own font rules would otherwise win over SVG attributes.
              style={{ fontFamily: MARK_FONT, fontWeight: mark.weight ?? 'bold', fontSize: `${mark.size}px` }}
              pointerEvents={handler ? 'visiblePainted' : 'none'}
              {...(onErase ? pick(mark, onErase) : movable(mark))}
            >
              {onErase ? <title>Click to rub out this text</title> : onEditText ? <title>Drag to move this text, or click to change it</title> : null}
              {mark.text}
            </text>
          )
        }
        const d = strokePath(mark.points)
        return (
          <g key={index}>
            <path d={d} fill="none" stroke={mark.color} strokeWidth={mark.width} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
            {onErase ? (
              // A wider invisible line, so a thin stroke is easy to click.
              <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(mark.width * 3, 6)} strokeLinecap="round" pointerEvents="stroke" {...pick(mark, onErase)}>
                <title>Click to rub out this stroke</title>
              </path>
            ) : null}
          </g>
        )
      })}
      {live ? (
        <path d={strokePath(live.points)} fill="none" stroke={live.color} strokeWidth={live.width} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
      ) : null}
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
  // The map tab ('whole', 'phase-2-east', ...) its legend colors are saved under, with projectCode.
  paletteSlot = '',
  // A map tab's name ('Phase 2', 'Whole Map'), so legend colors say which phase they belong to.
  slotName = (slot) => slot,
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
   * How an annotated lot is colored: like a paint bucket (the default) — its
   * whole colour flooded out to the printed lot lines — or following those
   * lines only near its outline, or exactly inside its polygon. Clicked lots
   * are always bucket-filled.
   */
  const [shapeMode, setShapeMode] = useState('bucket')
  // Statuses this project marks with a red ring rather than a colour (ERHD's Sold), and how thick the rings are.
  const circled = lotTermsFor(projectCode).circled
  const [ringThickness, setRingThickness] = useState(1)
  const [ringColor, setRingColor] = useState(LOT_RING_COLOR)
  const [reserveType, setReserveType] = useState(initialPaints.at(-1)?.reserveType ?? RESERVE_TYPES[0].value)
  // Whether a painted lot is covered whole, its lettering too, rather than keeping its words.
  const [coverText, setCoverText] = useState(false)
  // The colour a circled lot (ERHD's Sold) is filled with under its ring: Regular white by default.
  const [ringBackground, setRingBackground] = useState(REGULAR_BACKGROUND)
  // What a click paints: the brush's colour, for Reserved who it is held for, a circled lot's background, and whether it covers the words.
  const brushPaint = useMemo(
    () => ({
      status: brush,
      ...(brush === 'reserved' ? { reserveType } : {}),
      ...(circled.includes(brush) ? { background: ringBackground } : {}),
      ...(coverText ? { solid: true } : {}),
    }),
    [brush, reserveType, coverText, circled, ringBackground],
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
  // Edit colors: null, or the palette being set by hand, and the status open on the wheel.
  const [colorDraft, setColorDraft] = useState(null)
  const [colorStatus, setColorStatus] = useState(MAP_LOT_FILL[0].value)
  const palette = legendDraft ?? colorDraft ?? savedPalette
  const [picking, setPicking] = useState([])
  const pickingRef = useRef(false)
  pickingRef.current = picking.length > 0
  /*
   * The colours are saved in Supabase per project map (map_legend_colors), so
   * every user and browser shares them. This browser's copy shows at once and
   * stands in when the database cannot be reached; the saved row then wins —
   * unless the colours were changed here before it arrived.
   */
  const paletteChanged = useRef(false)
  useEffect(() => {
    if (!open || !paletteSlot) return undefined
    let live = true
    paletteChanged.current = false
    fetchLegendColors({ projectCode, slot: paletteSlot }).then(
      (stored) => {
        if (!live || !stored || paletteChanged.current) return
        setSavedPalette(stored)
        savePalette(paletteKey, stored)
      },
      (err) => console.warn('[annotated preview] legend colors not loaded from the database:', err),
    )
    return () => {
      live = false
    }
  }, [open, projectCode, paletteSlot, paletteKey])
  /*
   * Every map of this project with its own colours — offered in the Legend
   * colors dropdown and listed in Edit colors under its phase, so one phase's
   * colours can be reused on another. Loaded when the preview opens and again
   * each time Edit colors opens, so colours saved meanwhile elsewhere show up.
   */
  const [projectPalettes, setProjectPalettes] = useState([])
  const editingColors = Boolean(colorDraft)
  useEffect(() => {
    if (!open || !projectCode) return undefined
    let live = true
    fetchProjectLegendColors(projectCode).then(
      (maps) => live && setProjectPalettes(maps),
      (err) => console.warn('[annotated preview] other phases\' legend colors not loaded:', err),
    )
    return () => {
      live = false
    }
  }, [open, editingColors, projectCode])
  // The other phases' saved colours, named as their map tabs are.
  const otherPhasePalettes = projectPalettes
    .filter((map) => map.slot !== paletteSlot)
    .map((map) => ({ ...map, name: slotName(map.slot) }))
  // This map's own colours from before another phase's were copied on, so
  // "Don't use other phase colors" can put them back (Default when not known).
  const [paletteBeforePhase, setPaletteBeforePhase] = useState(null)
  // The phase last picked from "Use colors from", so of two phases with the
  // same colours (Phase 2A and 2B) the one chosen is the one shown selected.
  const [chosenPhaseSlot, setChosenPhaseSlot] = useState('')
  function changePalette(next) {
    paletteChanged.current = true
    setSavedPalette(next)
    savePalette(paletteKey, next)
    if (!paletteSlot) return
    saveLegendColors({ projectCode, slot: paletteSlot, palette: next }).catch((err) => {
      console.error('[annotated preview] legend colors not saved to the database:', err)
      notifyFailed('Legend colors not saved online', err)
    })
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
  /*
   * One status's colour read off the legend on its own: matching starts (or
   * goes on) with only that swatch to click next — or it moves to the front of
   * the ones still to read — and the review follows as for all of them.
   */
  function pickLegendStatus(status) {
    setPaintMessage('')
    setColorDraft(null)
    setLegendDraft((draft) => draft ?? { ...savedPalette })
    setPicking((queue) => [status, ...queue.filter((value) => value !== status)])
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
  function applyLots(byKey) {
    setLotsByKey(byKey)
    setLotOptions(
      [...byKey.values()]
        .flat()
        .map((lot) => ({ ...lot, key: String(lot.lotNo).toLowerCase().replace(/[^a-z0-9]/g, '') }))
        .sort((a, b) => String(a.lotNo).localeCompare(String(b.lotNo), undefined, { numeric: true })),
    )
  }
  function ensureLots() {
    if (!fetchLots || lotsRequested.current) return
    lotsRequested.current = true
    fetchLots().then(applyLots, (err) => {
      lotsRequested.current = false
      setLotsError(err.message)
    })
  }

  // The annotations list is coloured by each lot's status, so the lots load as soon as the preview opens.
  useEffect(() => {
    if (open) ensureLots()
  })

  /*
   * Live while open: a lot changed anywhere — this portal, another browser, the
   * Supabase dashboard — reloads the lots, so the selected lot's card, the
   * outline colours, and the annotations list follow it without a reload. A
   * burst of changes (an import, a bulk save) reloads once, after it settles.
   */
  const fetchLotsRef = useRef(fetchLots)
  fetchLotsRef.current = fetchLots
  const hasLotSource = Boolean(fetchLots)
  useEffect(() => {
    if (!open || !hasLotSource) return undefined
    let timer = null
    let live = true
    const unsubscribe = subscribeToLots(projectCode, () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        fetchLotsRef.current?.().then(
          (byKey) => live && applyLots(byKey),
          (err) => console.error('[annotated preview] lots not refreshed:', err),
        )
      }, 400)
    })
    return () => {
      live = false
      clearTimeout(timer)
      unsubscribe()
    }
  }, [open, hasLotSource, projectCode])

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
  const allPaints = useMemo(() => (paintState.url === url ? paintState.paints : []), [paintState, url])
  const paints = useMemo(() => allPaints.filter((paint) => !isMark(paint)), [allPaints])
  const marks = useMemo(() => allPaints.filter(isMark), [allPaints])
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
    circled,
    ringThickness,
    ringColor,
    marks,
  })
  // The painter as last rendered, for a save that waits for a change to be drawn first.
  const painterRef = useRef(painter)
  painterRef.current = painter
  const updatePaints = (update) => setPaintState((prev) => withLotPaints(prev, url, update))
  const updateMarks = (update) => setPaintState((prev) => withMarks(prev, url, update))

  /*
   * Marking up the map: freehand strokes (Draw) and text (Text), in the colour
   * and size picked, saved over everything. The Original brush rubs a mark out.
   */
  const [markColor, setMarkColor] = useState(MARK_COLORS[0])
  const [markSize, setMarkSize] = useState(MARK_SIZE_DEFAULT)
  const [markWeight, setMarkWeight] = useState('bold')
  const markUnit = (canvas.width || 1) * MARK_UNIT
  const strokeRef = useRef(null)
  const [liveStroke, setLiveStroke] = useState(null)
  // The text being typed: { x, y (its middle), value, color, size, replaces? }.
  const [textDraft, setTextDraft] = useState(null)
  const textDraftRef = useRef(null)
  textDraftRef.current = textDraft
  const svgPoint = (svg, event) => {
    const matrix = svg.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return [point.x, point.y]
  }
  function onDrawPointerDown(event) {
    if (!painting || !marking(brush) || pickingMark || event.button !== 0 || spaceHeld.current || picking.length) return
    if (brush === TEXT) {
      onTextBoxDown(event)
      return
    }
    const point = svgPoint(event.currentTarget, event)
    if (!point) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    strokeRef.current = [point]
    setLiveStroke([point])
  }
  function onDrawPointerMove(event) {
    if (brush === DRAW) moveBrushCursor(event)
    if (textBoxDragRef.current) {
      onTextBoxMove(event)
      return
    }
    const points = strokeRef.current
    if (!points) return
    const point = svgPoint(event.currentTarget, event)
    const last = points.at(-1)
    if (!point || Math.hypot(point[0] - last[0], point[1] - last[1]) < markUnit * 0.75) return
    points.push(point)
    setLiveStroke([...points])
  }
  function onDrawPointerUp() {
    if (textBoxDragRef.current) {
      onTextBoxUp()
      return
    }
    const points = strokeRef.current
    strokeRef.current = null
    setLiveStroke(null)
    if (!points) return
    updateMarks((list) => [...list, { mark: 'stroke', points, color: markColor, width: markSize * markUnit * 1.5 }])
  }
  /** Keep the text being typed (an empty one is dropped), replacing the text it was opened from. */
  function commitText() {
    const draft = textDraftRef.current
    textDraftRef.current = null
    setTextDraft(null)
    if (!draft) return
    const text = draft.value.trim()
    updateMarks((list) => {
      const rest = draft.replaces ? list.filter((mark) => mark !== draft.replaces) : list
      if (!text) return rest
      return [
        ...rest,
        {
          mark: 'text',
          x: draft.x,
          y: draft.y + draft.size * TEXT_BASELINE,
          text,
          color: draft.color,
          size: draft.size,
          weight: draft.weight,
          ...(draft.angle ? { angle: draft.angle } : {}),
        },
      ]
    })
  }
  function openText(x, y) {
    commitText()
    setMarkColor(TEXT_DEFAULT_COLOR)
    setTextDraft({ x, y, value: '', color: TEXT_DEFAULT_COLOR, size: markSize * markUnit * TEXT_SCALE, weight: markWeight })
  }
  // The colour and size picked are the next mark's — and the open text's, which changes with them.
  function chooseMarkColor(color) {
    setMarkColor(color)
    setTextDraft((draft) => (draft ? { ...draft, color } : draft))
  }
  function chooseMarkWeight(weight) {
    setMarkWeight(weight)
    setTextDraft((draft) => (draft ? { ...draft, weight } : draft))
  }
  function chooseMarkSize(size) {
    setMarkSize(size)
    setTextDraft((draft) => (draft ? { ...draft, size: size * markUnit * TEXT_SCALE } : draft))
  }
  function editText(mark) {
    commitText()
    setMarkColor(mark.color)
    setMarkWeight(mark.weight ?? 'bold')
    setMarkSize(Math.min(MARK_SIZE_MAX, Math.max(MARK_SIZE_MIN, Math.round(mark.size / (markUnit * TEXT_SCALE)))))
    setTextDraft({
      x: mark.x,
      y: mark.y - mark.size * TEXT_BASELINE,
      value: mark.text,
      color: mark.color,
      size: mark.size,
      weight: mark.weight ?? 'bold',
      angle: mark.angle ?? 0,
      replaces: mark,
    })
  }
  // The open box, turned by its rotate handle about the left end of its middle line.
  const textRotateRef = useRef(false)
  function onTextRotateDown(event) {
    if (event.button !== 0 || !textDraft) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    textRotateRef.current = true
  }
  function onTextRotateMove(event) {
    if (!textRotateRef.current) return
    event.stopPropagation()
    const point = pointIn(event.currentTarget.ownerSVGElement, event)
    if (!point) return
    setTextDraft((draft) => {
      if (!draft) return draft
      let angle = (Math.atan2(point[1] - draft.y, point[0] - draft.x) * 180) / Math.PI
      if (event.shiftKey) angle = Math.round(angle / 15) * 15
      else {
        const square = Math.round(angle / 90) * 90
        if (Math.abs(angle - square) <= TEXT_ANGLE_SNAP) angle = square
      }
      // -180 and 180 are the same turn: kept as one.
      return { ...draft, angle: angle === -180 ? 180 : angle }
    })
  }
  function onTextRotateUp(event) {
    if (!textRotateRef.current) return
    event.stopPropagation()
    textRotateRef.current = false
    dragged.current = true
  }
  const textResizeRef = useRef(null) // { startY, startSize } while the corner is dragged
  function onTextResizeDown(event) {
    if (event.button !== 0 || !textDraft) return
    // Keeps the text box focused, and the press off the map.
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = svgPoint(event.currentTarget.ownerSVGElement, event)
    if (point) textResizeRef.current = { startY: point[1], startSize: textDraft.size }
  }
  function onTextResizeMove(event) {
    const start = textResizeRef.current
    if (!start) return
    event.stopPropagation()
    const point = svgPoint(event.currentTarget.ownerSVGElement, event)
    if (!point) return
    // The box is 1.6 sizes tall, so the corner follows the pointer down and up.
    const size = Math.min(TEXT_SIZE_MAX * markUnit, Math.max(TEXT_SIZE_MIN * markUnit, start.startSize + (point[1] - start.startY) / 1.6))
    setTextDraft((draft) => (draft ? { ...draft, size } : draft))
  }
  function onTextResizeUp(event) {
    if (!textResizeRef.current) return
    event.stopPropagation()
    textResizeRef.current = null
    // The click that ends the drag is not one on the map.
    dragged.current = true
  }
  // A text dragged to a new place: moved by (dx, dy), one step Undo can take back.
  const moveText = (mark, dx, dy) =>
    updateMarks((list) => list.map((item) => (item === mark ? { ...item, x: item.x + dx, y: item.y + dy } : item)))
  // The open box, dragged by its move handle.
  const textMoveRef = useRef(null) // { start: [x, y], origin: [x, y] }
  function onTextMoveDown(event) {
    if (event.button !== 0 || !textDraft) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointIn(event.currentTarget.ownerSVGElement, event)
    if (point) textMoveRef.current = { start: point, origin: [textDraft.x, textDraft.y] }
  }
  function onTextMoveMove(event) {
    const current = textMoveRef.current
    if (!current) return
    event.stopPropagation()
    const point = pointIn(event.currentTarget.ownerSVGElement, event)
    if (!point) return
    const x = current.origin[0] + point[0] - current.start[0]
    const y = current.origin[1] + point[1] - current.start[1]
    setTextDraft((draft) => (draft ? { ...draft, x, y } : draft))
  }
  function onTextMoveUp(event) {
    if (!textMoveRef.current) return
    event.stopPropagation()
    textMoveRef.current = null
    dragged.current = true
  }
  const eraseMark = (mark) => updateMarks((list) => list.filter((item) => item !== mark))

  /*
   * The eyedropper: the browser's own where it has one (it reads the screen, so
   * a lot already recoloured gives its new colour); elsewhere the next click on
   * the map reads the map's colour there. It picks for the brush and text
   * ('mark') or for the rings of circled lots ('ring'); `pickingMark` is which,
   * while a click is awaited.
   */
  const [pickingMark, setPickingMark] = useState(null)
  const choosePicked = (target, hex) => (target === 'ring' ? setRingColor(hex) : chooseMarkColor(hex))
  async function pickColor(target) {
    if (typeof window !== 'undefined' && 'EyeDropper' in window) {
      setPickingMark(null)
      try {
        const { sRGBHex } = await new window.EyeDropper().open()
        if (/^#[0-9a-f]{6}$/i.test(sRGBHex)) choosePicked(target, sRGBHex.toUpperCase())
      } catch {
        // Closed with Escape: the colour stays as it was.
      }
      return
    }
    setPickingMark((on) => (on === target ? null : target))
  }
  const pickMarkColor = () => pickColor('mark')
  const pickRingColor = () => pickColor('ring')
  /*
   * Alt-click: the eyedropper at once, for the colour the brush in hand uses —
   * Brush and Text take the mark colour, a ringed status (Sold) the ring
   * colour, any other status its legend colour (reviewed before it is used,
   * as Custom's are). While the legend is being read, it reads the swatch due.
   * The press is taken here, before it can draw, paint, or pan, and so is the
   * click that ends it.
   */
  const altTarget = picking.length
    ? 'legend'
    : marking(brush)
      ? 'mark'
      : circled.includes(brush)
        ? 'ring'
        : FILL_BY_STATUS[brush]
          ? 'legend'
          : null
  const altPicked = useRef(false)
  function onAltPick(event) {
    altPicked.current = false
    if (!painting || !event.altKey || !altTarget || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    altPicked.current = true
    const point = svgPoint(event.currentTarget, event)
    const hex = point && painter.ready ? painter.sampleColor(...point) : null
    setPickingMark(null)
    if (!hex) return
    if (altTarget !== 'legend') {
      choosePicked(altTarget, hex)
      return
    }
    // The swatch due while the legend is read, else the brush's own status; the review shows once none are left.
    setPaintMessage('')
    setColorDraft(null)
    setDraftColor(picking[0] ?? brush, hex)
    if (picking.length) setPicking((queue) => queue.slice(1))
  }
  function onAltClick(event) {
    if (!altPicked.current) return
    altPicked.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  /*
   * While drawing, the pointer is a circle as wide as the brush, drawn on the
   * map itself so it keeps its true size at any zoom. It is moved directly,
   * not through React, so following the pointer re-renders nothing.
   */
  const brushCursorRef = useRef(null)
  function moveBrushCursor(event) {
    const cursor = brushCursorRef.current
    if (!cursor) return
    const point = svgPoint(event.currentTarget, event)
    if (!point || pickingMark || spaceHeld.current || event.altKey) {
      cursor.setAttribute('visibility', 'hidden')
      return
    }
    cursor.setAttribute('transform', `translate(${point[0]} ${point[1]})`)
    cursor.setAttribute('visibility', 'visible')
  }
  const hideBrushCursor = () => brushCursorRef.current?.setAttribute('visibility', 'hidden')

  /*
   * With Text, dragging on the map draws the text's box: its height sets the
   * text's size, its width the box's. A click without a drag opens a box of
   * the size picked, there.
   */
  const textBoxDragRef = useRef(null) // { start: [x, y], end: [x, y] }
  const [textBoxDrag, setTextBoxDrag] = useState(null)
  function onTextBoxDown(event) {
    const point = svgPoint(event.currentTarget, event)
    if (!point) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    textBoxDragRef.current = { start: point, end: point }
    setTextBoxDrag(textBoxDragRef.current)
  }
  function onTextBoxMove(event) {
    const current = textBoxDragRef.current
    if (!current) return
    const point = svgPoint(event.currentTarget, event)
    if (!point) return
    textBoxDragRef.current = { ...current, end: point }
    setTextBoxDrag(textBoxDragRef.current)
  }
  function onTextBoxUp() {
    const current = textBoxDragRef.current
    textBoxDragRef.current = null
    setTextBoxDrag(null)
    if (!current) return
    const [x0, y0] = current.start
    const [x1, y1] = current.end
    const width = Math.abs(x1 - x0)
    const height = Math.abs(y1 - y0)
    // Too small to be a box (a click, or a slip of the hand): a box of the size picked.
    if (Math.max(width, height) < 6 * screenPixel) {
      openText(x0, y0)
      return
    }
    const size = Math.min(TEXT_SIZE_MAX * markUnit, Math.max(TEXT_SIZE_MIN * markUnit, height / 1.6))
    commitText()
    setMarkColor(TEXT_DEFAULT_COLOR)
    setTextDraft({
      x: Math.min(x0, x1),
      y: Math.min(y0, y1) + (size * 1.6) / 2,
      value: '',
      color: TEXT_DEFAULT_COLOR,
      size,
      weight: markWeight,
      boxWidth: width,
    })
    setMarkSize(Math.min(MARK_SIZE_MAX, Math.max(MARK_SIZE_MIN, Math.round(size / (markUnit * TEXT_SCALE)))))
  }
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
  // (An area cleared of its printed ring is linked too: its lot turns Available.)
  const clickedPaints = paints.filter((paint) => paint.shapeId === undefined && (paint.status || paint.eraseRing))
  const linkingPaint = linking ? (clickedPaints.find((paint) => samePoint(paint, linking)) ?? null) : null
  const linkedIds = new Set(clickedPaints.filter((paint) => paint.lot).map((paint) => paint.lot.id))

  // Stable per brush, so the memoised polygons are not rebuilt on every pan frame.
  const paintShape = useCallback(
    (id) => {
      // Drawing and writing on the map never colour the lot underneath; with no brush in hand, nothing does.
      if (!brush || marking(brush)) return
      setPaintMessage('')
      setPaintState((prev) =>
        withLotPaints(prev, url, (list) => {
          const rest = list.filter((paint) => paint.shapeId !== id)
          const current = list.filter((paint) => paint.shapeId === id).at(-1)
          // The lot keeps whatever it was painted (or nothing); only the printed ring goes.
          if (brush === ERASE_RING) return [...rest, { ...(current ?? { shapeId: id }), eraseRing: true }]
          // Repainting keeps a removed circle removed.
          return brush === ORIGINAL ? rest : [...rest, { shapeId: id, ...brushPaint, ...(current?.eraseRing ? { eraseRing: true } : {}) }]
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
    if (!brush) return
    const { found, index } = painter.locatePoint(x, y)
    setPaintMessage('')
    // A click off every lot — on a road, a line, the margin — simply does nothing.
    if (!found) return
    // Coloring an area again keeps the lot it was linked to.
    const lot = index >= 0 ? paints[index]?.lot : undefined
    // Repainting keeps a removed circle removed.
    const erased = index >= 0 && paints[index]?.eraseRing ? { eraseRing: true } : {}
    if (brush === ERASE_RING) {
      updatePaints((list) => {
        const current = index >= 0 ? list[index] : null
        return [...list.filter((_, n) => n !== index), { ...(current ?? { x, y }), eraseRing: true }]
      })
      // Its lot turns Available on saving, so a clicked area needs to know which lot it is.
      if (canLink && !lot) openLinker(index >= 0 ? paints[index] : { x, y })
      return
    }
    updatePaints((list) => {
      const rest = list.filter((_, n) => n !== index)
      return brush === ORIGINAL ? rest : [...rest, { x, y, ...brushPaint, ...erased, ...(lot ? { lot } : {}) }]
    })
    if (brush === ORIGINAL) setLinking(null)
    else if (canLink && !lot) openLinker({ x, y })
  }
  /** A click on the map itself, off every annotation: colour the lot under it. */
  function onDrawingClick(event) {
    // Every pointer-up resets `dragged`, so reading it is enough to skip the end of a pan.
    if (!painting || dragged.current || spaceHeld.current) return
    // The eyedropper (where the browser has none of its own): this click reads the map's colour.
    if (pickingMark) {
      const point = svgPoint(event.currentTarget, event)
      const hex = point && painter.ready ? painter.sampleColor(...point) : null
      if (hex) choosePicked(pickingMark, hex)
      setPickingMark(null)
      return
    }
    // Text goes where the map is clicked; a stroke was drawn by the press itself.
    // Text boxes and strokes are made by the press itself, not the click after it.
    if (marking(brush) && !picking.length) return
    if (!painter.ready) return
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

  /*
   * Moving a ring: dragged by its line, it follows the pointer but never leaves
   * its lot, and on release its place is kept on the paint as `ringOffset` (from
   * the lot's middle) — one step Undo can take back. A press that does not move
   * is a click on the lot under it, which repaints it with another status.
   */
  const ringDragRef = useRef(null) // { ring, startX, startY, moved, cx, cy }
  const [ringDrag, setRingDrag] = useState(null) // { key, cx, cy } while a ring is being moved
  const drawingPoint = (event) => {
    const svg = event.currentTarget.ownerSVGElement
    const matrix = svg?.getScreenCTM()
    if (!matrix) return [0, 0]
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return [point.x, point.y]
  }
  function onRingPointerDown(event, ring) {
    // Space or the middle button still moves the map; reading the legend still samples.
    if (event.button !== 0 || spaceHeld.current || picking.length || !painter.ready) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const [x, y] = drawingPoint(event)
    ringDragRef.current = { ring, startX: event.clientX, startY: event.clientY, x, y, moved: false, cx: ring.cx, cy: ring.cy }
  }
  function onRingPointerMove(event) {
    const current = ringDragRef.current
    if (!current) return
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <= DRAG_SLOP) return
    current.moved = true
    const [x, y] = drawingPoint(event)
    const { ring } = current
    ;[current.cx, current.cy] = clampRingCenter([ring.cx + x - current.x, ring.cy + y - current.y], ring.r, ring.bounds)
    setRingDrag({ key: ring.key, cx: current.cx, cy: current.cy, r: ring.r })
  }
  function onRingPointerUp(event) {
    const current = ringDragRef.current
    ringDragRef.current = null
    if (!current) return
    event.stopPropagation()
    // The click that follows is the end of this press, not a click on the map.
    dragged.current = true
    setRingDrag(null)
    const { ring } = current
    if (current.moved) {
      const { x0, y0, x1, y1 } = ring.bounds
      const ringOffset = { dx: current.cx - (x0 + x1) / 2, dy: current.cy - (y0 + y1) / 2 }
      updatePaints((list) => list.map((paint) => (paint === ring.paint ? { ...paint, ringOffset } : paint)))
    } else if (brush && brush !== ring.paint.status) {
      if (ring.paint.shapeId !== undefined) paintShape(ring.paint.shapeId)
      else paintPoint(ring.paint.x, ring.paint.y)
    }
  }

  /*
   * Resizing a ring: its round handle, shown while the pointer is on the ring,
   * is dragged out or in — the ring's edge follows the pointer, about its
   * centre — and on release its size is kept on the paint as `ringSize` (times
   * its default), one step Undo can take back. A double-click sets it back.
   */
  const [hoverRing, setHoverRing] = useState(null) // the key of the ring the pointer is on
  // The handle sits on the ring's lower right, as large as the ring is thick (and never too small to grab).
  const ringHandle = (at, ring) => ({
    x: at.cx + at.r * Math.SQRT1_2,
    y: at.cy + at.r * Math.SQRT1_2,
    r: Math.max(ring.strokeWidth * 0.8, 5 * screenPixel),
  })
  const ringResizeRef = useRef(null) // { ring, cx, cy, r }
  const setRingSize = (ring, ringSize) =>
    updatePaints((list) =>
      list.map((paint) => {
        if (paint !== ring.paint) return paint
        const rest = { ...paint }
        delete rest.ringSize
        return Math.abs(ringSize - 1) < 0.02 ? rest : { ...rest, ringSize: +ringSize.toFixed(3) }
      }),
    )
  function onRingResizeDown(event, ring) {
    if (event.button !== 0 || spaceHeld.current || picking.length || !painter.ready) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    ringResizeRef.current = { ring, cx: ring.cx, cy: ring.cy, r: ring.r }
  }
  function onRingResizeMove(event) {
    const current = ringResizeRef.current
    if (!current) return
    event.stopPropagation()
    const [x, y] = drawingPoint(event)
    const { ring } = current
    current.r = Math.min(RING_SIZE_MAX, Math.max(RING_SIZE_MIN, Math.hypot(x - ring.cx, y - ring.cy) / ring.base)) * ring.base
    ;[current.cx, current.cy] = clampRingCenter([ring.cx, ring.cy], current.r, ring.bounds)
    setRingDrag({ key: ring.key, cx: current.cx, cy: current.cy, r: current.r })
  }
  function onRingResizeUp(event) {
    const current = ringResizeRef.current
    ringResizeRef.current = null
    if (!current) return
    event.stopPropagation()
    dragged.current = true
    setRingDrag(null)
    if (current.r !== current.ring.r) setRingSize(current.ring, current.r / current.ring.base)
  }

  const fileNameBase = `${(title || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'}-colored`
  const svgFileName = `${fileNameBase}.svg`
  const pngFileName = `${fileNameBase}.png`

  async function saveImage() {
    try {
      // Text still being typed is kept first, and the download waits for it to be drawn in.
      if (textDraftRef.current) {
        commitText()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      // PNG is lossless and uses the painter's full working dimensions, not the scaled preview.
      const href = URL.createObjectURL(await painterRef.current.toPngBlob())
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
    // Text still being typed goes onto the map that will be saved.
    commitText()
    setPaintMessage('')
    setReview({ loading: true })
    try {
      // Every annotated lot's newest colour, as the saved map will show it.
      const labels = new Map(shapes.map((shape) => [shape.id, shape.label]))
      // A lot cleared of its printed (sold) circle turns Available in the table.
      const statusPaints = paints.filter((paint) => paint.status || paint.eraseRing)
      const newest = new Map(statusPaints.filter((paint) => paint.shapeId !== undefined).map((paint) => [paint.shapeId, paint]))
      const linkedPaints = new Map(statusPaints.filter((paint) => paint.shapeId === undefined && paint.lot).map((paint) => [paint.lot.id, paint]))
      const painted = [
        ...[...newest].map(([id, paint]) => ({ label: labels.get(id) ?? `Annotation ${id}`, fill: paint.status ?? 'open', paint })),
        ...[...linkedPaints.values()].map((paint) => ({ label: paint.lot.lotNo, fill: paint.status ?? 'open', paint })),
      ]
      setReview({ plan: planStatusUpdate(shapes, statusPaints, await loadLots()), painted })
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
  // Map units per screen pixel: the map is fitted to the frame, then zoomed by a CSS transform.
  const screenPixel =
    1 /
    (Math.min((drawingRef.current?.offsetWidth || 1) / (canvas.width || 1), (drawingRef.current?.offsetHeight || 1) / (canvas.height || 1)) *
      view.zoom)

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
  // Alt held: a click on the map picks a colour instead (see onAltPick).
  const [altHeld, setAltHeld] = useState(false)
  useEffect(() => {
    if (!open || !painting) return undefined
    const typing = (target) =>
      target?.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target?.tagName) || (target?.tagName === 'INPUT' && target.type !== 'range')
    const release = () => {
      spaceHeld.current = false
      setPanKey(false)
      setAltHeld(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Alt') {
        // Nor does Alt alone open the browser's menu bar.
        event.preventDefault()
        setAltHeld(true)
        return
      }
      if (event.code !== 'Space' || typing(event.target)) return
      // Nor does Space press whatever button last had focus.
      event.preventDefault()
      if (spaceHeld.current) return
      spaceHeld.current = true
      setPanKey(true)
    }
    function onKeyUp(event) {
      if (event.key === 'Alt') {
        event.preventDefault()
        setAltHeld(false)
        return
      }
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
                    cursor={
                      dragging
                        ? 'grabbing'
                        : painting && !panKey
                          ? pickingMark || (altHeld && altTarget) || picking.length
                            ? EYEDROPPER_CURSOR
                            : brush === DRAW
                              ? 'none'
                              : brush
                                ? 'crosshair'
                                : 'default'
                          : 'grab'
                    }
                    // While moving the map, drawing, or picking a colour, the lots' own pointer cursor gives way;
                    // with Text, only the lots' does — the text box keeps its I-beam and its handles theirs.
                    css={
                      painting && (panKey || dragging || brush === DRAW || pickingMark || (altHeld && altTarget) || picking.length)
                        ? { '& *': { cursor: 'inherit !important' } }
                        : painting && (brush === TEXT || !brush)
                          ? { '& polygon': { cursor: 'inherit !important' } }
                          : undefined
                    }
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
                      // Alt-click picks a colour, ahead of anything a press would otherwise start.
                      onPointerDownCapture={onAltPick}
                      onClickCapture={onAltClick}
                      onPointerDown={onDrawPointerDown}
                      onPointerMove={onDrawPointerMove}
                      onPointerUp={onDrawPointerUp}
                      onPointerCancel={onDrawPointerUp}
                      onPointerLeave={hideBrushCursor}
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
                      {/* Printed red rings erased: flat patches of each lot's colour over them. */}
                      {painting && !showOriginal
                        ? painter.patches.map((patch) => (
                            <path
                              key={patch.key}
                              d={patch.d}
                              fill={patch.fill}
                              transform={`scale(${1 / patch.scale[0]} ${1 / patch.scale[1]})`}
                              shapeRendering="crispEdges"
                              pointerEvents="none"
                            />
                          ))
                        : null}
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
                      {/*
                        * Rings over circled lots, above the outlines so they can be
                        * grabbed: by a wide invisible band along the line, so the
                        * inside of the ring still clicks through to the lot.
                        */}
                      {painting && !showOriginal
                        ? painter.circles.map((ring) => {
                            const at = ringDrag?.key === ring.key ? ringDrag : ring
                            const handle = ringHandle(at, ring)
                            return (
                              <g
                                key={ring.key}
                                onPointerEnter={() => setHoverRing(ring.key)}
                                onPointerLeave={() => setHoverRing((key) => (key === ring.key ? null : key))}
                              >
                                {/* The ring itself is drawn after the strokes and text, over them. */}
                                <circle
                                  cx={at.cx}
                                  cy={at.cy}
                                  r={at.r}
                                  fill="none"
                                  stroke="transparent"
                                  strokeWidth={Math.max(ring.strokeWidth * 2.5, ring.r * 0.3)}
                                  // Drawing and writing go straight through to the map.
                                  pointerEvents={marking(brush) ? 'none' : 'stroke'}
                                  cursor="move"
                                  onPointerDown={(event) => onRingPointerDown(event, ring)}
                                  onPointerMove={onRingPointerMove}
                                  onPointerUp={onRingPointerUp}
                                  onPointerCancel={onRingPointerUp}
                                >
                                  <title>Drag to move this ring within its lot</title>
                                </circle>
                                {/* The resize handle's grip: wider than it shows, drawn over the ring below. */}
                                {hoverRing === ring.key || ringDrag?.key === ring.key ? (
                                  <circle
                                    cx={handle.x}
                                    cy={handle.y}
                                    r={handle.r * 1.8}
                                    fill="transparent"
                                    pointerEvents={marking(brush) ? 'none' : 'all'}
                                    cursor="nwse-resize"
                                    onPointerDown={(event) => onRingResizeDown(event, ring)}
                                    onPointerMove={onRingResizeMove}
                                    onPointerUp={onRingResizeUp}
                                    onPointerCancel={onRingResizeUp}
                                    onClick={(event) => event.stopPropagation()}
                                    onDoubleClick={(event) => {
                                      event.stopPropagation()
                                      setRingSize(ring, 1)
                                    }}
                                  >
                                    <title>Drag to resize this ring · double-click for its default size</title>
                                  </circle>
                                ) : null}
                              </g>
                            )
                          })
                        : null}
                      {painting && !showOriginal ? (
                        <MarksLayer
                          marks={marks}
                          live={liveStroke ? { points: liveStroke, color: markColor, width: markSize * markUnit * 1.5 } : null}
                          editing={textDraft?.replaces ?? null}
                          onErase={brush === ORIGINAL ? eraseMark : null}
                          onEditText={brush === TEXT ? editText : null}
                          onMoveText={brush === TEXT ? moveText : null}
                        />
                      ) : null}
                      {/* Rings over circled lots, on top of the strokes and text; grabbed by their bands above. */}
                      {painting && !showOriginal
                        ? painter.circles.map((ring) => {
                            const at = ringDrag?.key === ring.key ? ringDrag : ring
                            const handle = ringHandle(at, ring)
                            return (
                              <g key={ring.key} pointerEvents="none">
                                <circle cx={at.cx} cy={at.cy} r={at.r} fill="none" stroke={ringColor} strokeWidth={ring.strokeWidth} />
                                {(hoverRing === ring.key || ringDrag?.key === ring.key) && !marking(brush) ? (
                                  <circle cx={handle.x} cy={handle.y} r={handle.r} fill="#FFFFFF" stroke="#1D4ED8" strokeWidth={2 * screenPixel} />
                                ) : null}
                              </g>
                            )
                          })
                        : null}
                      {textBoxDrag ? (
                        <rect
                          x={Math.min(textBoxDrag.start[0], textBoxDrag.end[0])}
                          y={Math.min(textBoxDrag.start[1], textBoxDrag.end[1])}
                          width={Math.abs(textBoxDrag.end[0] - textBoxDrag.start[0])}
                          height={Math.abs(textBoxDrag.end[1] - textBoxDrag.start[1])}
                          fill="rgba(29,78,216,0.06)"
                          stroke="#1D4ED8"
                          strokeWidth={screenPixel}
                          strokeDasharray={`${4 * screenPixel} ${3 * screenPixel}`}
                          pointerEvents="none"
                        />
                      ) : null}
                      {/* The brush, as wide as it draws: one thin ring. */}
                      {painting && brush === DRAW ? (
                        <g ref={brushCursorRef} visibility="hidden" pointerEvents="none">
                          <circle
                            r={(markSize * markUnit * 1.5) / 2}
                            fill="none"
                            stroke={BRUSH_CURSOR_COLOR}
                            strokeWidth={BRUSH_CURSOR_WIDTH * screenPixel}
                          />
                        </g>
                      ) : null}
                      {painting && textDraft ? (
                        <g transform={textRotation(textDraft.angle, textDraft.x, textDraft.y)}>
                        <foreignObject
                          x={textDraft.x}
                          y={textDraft.y - textDraft.size * 0.8}
                          width={textBoxWidth(textDraft)}
                          height={textDraft.size * 1.6}
                        >
                          <input
                            // Focused as it opens, so typing starts at once.
                            autoFocus
                            value={textDraft.value}
                            placeholder={TEXT_HINT}
                            aria-label="Text to add to the map"
                            onChange={(event) => setTextDraft((draft) => (draft ? { ...draft, value: event.target.value } : draft))}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') commitText()
                              else if (event.key === 'Escape') {
                                textDraftRef.current = null
                                setTextDraft(null)
                              }
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            style={{
                              width: '100%',
                              height: '100%',
                              boxSizing: 'border-box',
                              padding: 0,
                              // Inside the box, the I-beam of typing; outside it, the map's plus.
                              cursor: 'text',
                              border: `${screenPixel}px dashed #1D4ED8`,
                              outline: 'none',
                              background: isLightColor(textDraft.color) ? 'rgba(17,24,39,0.7)' : 'rgba(255,255,255,0.85)',
                              color: textDraft.color,
                              font: `${textDraft.weight ?? 'bold'} ${textDraft.size}px ${MARK_FONT}`,
                            }}
                          />
                        </foreignObject>
                        {/* Drag the top-left handle to move the box. */}
                        <rect
                          x={textDraft.x - textDraft.size * 0.25}
                          y={textDraft.y - textDraft.size * 0.8 - textDraft.size * 0.25}
                          width={textDraft.size * 0.5}
                          height={textDraft.size * 0.5}
                          fill="#1D4ED8"
                          stroke="#FFFFFF"
                          strokeWidth={textDraft.size * 0.06}
                          cursor="move"
                          onPointerDown={onTextMoveDown}
                          onPointerMove={onTextMoveMove}
                          onPointerUp={onTextMoveUp}
                          onPointerCancel={onTextMoveUp}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <title>Drag to move the text</title>
                        </rect>
                        {/* Drag the corner to make the text larger or smaller. */}
                        <rect
                          x={textDraft.x + textBoxWidth(textDraft) - textDraft.size * 0.25}
                          y={textDraft.y + textDraft.size * 0.8 - textDraft.size * 0.25}
                          width={textDraft.size * 0.5}
                          height={textDraft.size * 0.5}
                          fill="#FFFFFF"
                          stroke="#1D4ED8"
                          strokeWidth={textDraft.size * 0.06}
                          cursor="nwse-resize"
                          onPointerDown={onTextResizeDown}
                          onPointerMove={onTextResizeMove}
                          onPointerUp={onTextResizeUp}
                          onPointerCancel={onTextResizeUp}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <title>Drag to resize the text</title>
                        </rect>
                        {/* Drag the round handle off the box's right end to turn the text; double-click sets it level. */}
                        <line
                          x1={textDraft.x + textBoxWidth(textDraft)}
                          y1={textDraft.y}
                          x2={textDraft.x + textBoxWidth(textDraft) + textDraft.size * 0.9}
                          y2={textDraft.y}
                          stroke="#1D4ED8"
                          strokeWidth={screenPixel}
                          pointerEvents="none"
                        />
                        <circle
                          cx={textDraft.x + textBoxWidth(textDraft) + textDraft.size * 0.9}
                          cy={textDraft.y}
                          r={textDraft.size * 0.28}
                          fill="#FFFFFF"
                          stroke="#1D4ED8"
                          strokeWidth={textDraft.size * 0.06}
                          cursor="grab"
                          onPointerDown={onTextRotateDown}
                          onPointerMove={onTextRotateMove}
                          onPointerUp={onTextRotateUp}
                          onPointerCancel={onTextRotateUp}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => {
                            event.stopPropagation()
                            setTextDraft((draft) => (draft ? { ...draft, angle: 0 } : draft))
                          }}
                        >
                          <title>Drag to rotate the text (Shift snaps to 15°) · double-click to level it</title>
                        </circle>
                        </g>
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
                        onJump={pickLegendStatus}
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
                      onBrush={(value) => {
                        commitText()
                        setPickingMark(null)
                        // The brush in hand, clicked again, is put down: then a click on the map does nothing.
                        setBrush((current) => (current === value ? null : value))
                      }}
                      pickingMarkColor={pickingMark === 'mark'}
                      pickingRingColor={pickingMark === 'ring'}
                      onPickRingColor={pickRingColor}
                      onPickMarkColor={pickMarkColor}
                      markColor={markColor}
                      onMarkColor={chooseMarkColor}
                      markSize={markSize}
                      onMarkSize={chooseMarkSize}
                      markWeight={markWeight}
                      onMarkWeight={chooseMarkWeight}
                      reserveType={reserveType}
                      onReserveType={pickReserveType}
                      palette={palette}
                      matching={Boolean(legendDraft)}
                      onMatchLegend={() => {
                        setPaintMessage('')
                        setColorDraft(null)
                        setLegendDraft({ ...savedPalette })
                        setPicking(MAP_LOT_FILL.map(({ value }) => value))
                      }}
                      pickingLegendStatus={picking[0] ?? null}
                      onPickLegendStatus={pickLegendStatus}
                      onDefaultPalette={() => {
                        endMatching(false)
                        setColorDraft(null)
                        changePalette(DEFAULT_PALETTE)
                      }}
                      editingColors={editingColors}
                      paletteFor={paletteSlot ? slotName(paletteSlot) : ''}
                      otherPhases={paletteSlot ? otherPhasePalettes : []}
                      onUsePhase={(other) => {
                        endMatching(false)
                        setColorDraft(null)
                        // Keep the map's own colours only the first time, not another phase's.
                        if (!otherPhasePalettes.some((map) => samePalette(map.palette, savedPalette))) {
                          setPaletteBeforePhase({ ...savedPalette })
                        }
                        changePalette({ ...other.palette })
                        setChosenPhaseSlot(other.slot)
                      }}
                      chosenPhaseSlot={chosenPhaseSlot}
                      onStopUsingPhase={() => {
                        endMatching(false)
                        setColorDraft(null)
                        const own =
                          paletteBeforePhase && !otherPhasePalettes.some((map) => samePalette(map.palette, paletteBeforePhase))
                            ? paletteBeforePhase
                            : DEFAULT_PALETTE
                        changePalette({ ...own })
                        setPaletteBeforePhase(null)
                        setChosenPhaseSlot('')
                      }}
                      onEditColors={() => {
                        if (colorDraft) {
                          setColorDraft(null)
                          return
                        }
                        endMatching(false)
                        setColorDraft({ ...savedPalette })
                      }}
                      colorEditor={
                        colorDraft ? (
                          <PaletteEditor
                            hidden={circled}
                            draft={colorDraft}
                            saved={savedPalette}
                            status={colorStatus}
                            onStatus={setColorStatus}
                            mapName={paletteSlot ? slotName(paletteSlot) : ''}
                            otherMaps={otherPhasePalettes}
                            onUseMap={(other) => setColorDraft({ ...other })}
                            onChange={(status, hex) => setColorDraft((draft) => ({ ...draft, [status]: hex }))}
                            onSave={() => {
                              changePalette(colorDraft)
                              setColorDraft(null)
                            }}
                            onCancel={() => setColorDraft(null)}
                          />
                        ) : null
                      }
                      tolerance={tolerance}
                      onTolerance={setTolerance}
                      circled={circled}
                      ringThickness={ringThickness}
                      onRingThickness={setRingThickness}
                      ringColor={ringColor}
                      onRingColor={setRingColor}
                      coverText={coverText}
                      onCoverText={setCoverText}
                      ringBackground={ringBackground}
                      onRingBackground={setRingBackground}
                      shapeMode={shapes.length ? shapeMode : null}
                      onShapeMode={setShapeMode}
                      count={paints.length + marks.length}
                      ready={painter.ready}
                      loadError={painter.error}
                      message={paintMessage}
                      saving={saving || Boolean(review?.loading)}
                      controlStyle={controlStyle}
                      onReset={() => setPaintState((prev) => withPaints(prev, url, () => []))}
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
const PANEL_BUTTON_BASE = {
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
/** The colour panels' buttons: the green one that commits, and the plain one beside it. */
const PANEL_BUTTONS = {
  primary: { ...PANEL_BUTTON_BASE, bg: COLORS.brandGreen, color: '#FFFFFF', _hover: { bg: '#00541F' } },
  secondary: {
    ...PANEL_BUTTON_BASE,
    bg: COLORS.surface,
    color: COLORS.heading,
    border: '1px solid',
    borderColor: COLORS.border,
    _hover: { bg: COLORS.hoverBg },
  },
}

/**
 * Edit colors: every status's colour set by hand — on the wheel, or as a hex or
 * RGB code — from the Color lots toolbar, without matching the map's legend.
 * `draft` is the palette being edited; painted lots preview it as it changes,
 * and only Save colors keeps it.
 */
function PaletteEditor({ draft, saved, status, onStatus, onChange, onSave, onCancel, mapName = '', otherMaps = [], onUseMap, hidden = [] }) {
  // A ringed status (ERHD's Sold) paints no colour, so it has none to edit here.
  const statuses = MAP_LOT_FILL.filter(({ value }) => !hidden.includes(value))
  const current = statuses.find((option) => option.value === status) ?? statuses[0]
  const changed = statuses.filter(({ value }) => draft[value] !== saved[value]).length
  return (
    <Flex mt="8px" direction="column" gap="8px" role="group" aria-label={mapName ? `Edit legend colors for ${mapName}` : 'Edit legend colors'}>
      <Flex gap="6px" flexWrap="wrap" role="tablist" aria-label="Status to edit">
        {statuses.map(({ value, label }) => {
          const now = value === current.value
          return (
            <Flex
              key={value}
              as="button"
              type="button"
              role="tab"
              aria-selected={now}
              align="center"
              gap="6px"
              h="28px"
              px="10px"
              borderRadius="999px"
              border="1px solid"
              borderColor={now ? COLORS.heading : COLORS.border}
              bg={now ? COLORS.hoverBg : COLORS.surface}
              fontFamily={FONT}
              fontSize="12px"
              fontWeight={now ? '700' : '500'}
              color={COLORS.heading}
              cursor="pointer"
              onClick={() => onStatus(value)}
            >
              <Swatch color={draft[value]} />
              {label}
              {draft[value] !== saved[value] ? <Box boxSize="6px" borderRadius="999px" bg={COLORS.brandGreen} title="Changed" /> : null}
            </Flex>
          )
        })}
      </Flex>
      <ManualColorPanel
        key={current.value}
        label={current.label}
        value={draft[current.value]}
        original={saved[current.value]}
        button={PANEL_BUTTONS}
        useLabel={changed ? `Save colors (${changed})` : 'Save colors'}
        onChange={(hex) => onChange(current.value, hex)}
        onUse={onSave}
        onCancel={onCancel}
      />
      <OtherPhaseColors maps={otherMaps} draft={draft} current={current} onPick={(hex) => onChange(current.value, hex)} onUseMap={onUseMap} />
    </Flex>
  )
}

/** Which map tab ('Phase 2', 'Whole Map') a set of legend colours belongs to. */
function PhaseBadge({ name, title }) {
  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      h="22px"
      px="8px"
      borderRadius="999px"
      bg={COLORS.hoverBg}
      border="1px solid"
      borderColor={COLORS.border}
      fontFamily={FONT}
      fontSize="11.5px"
      fontWeight="700"
      color={COLORS.heading}
      whiteSpace="nowrap"
      title={title}
    >
      {name}
    </Box>
  )
}

/**
 * The colours the project's other maps are saved with, one row per phase. A
 * swatch sets the status being edited to that colour; Use all copies the whole
 * row into the draft. A swatch this map's draft already uses is outlined.
 */
function OtherPhaseColors({ maps, draft, current, onPick, onUseMap }) {
  return (
    <Flex direction="column" gap="6px" p="10px" borderRadius="10px" bg={COLORS.canvas} border="1px solid" borderColor={COLORS.border}>
      <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle}>
        Colors from other phases — click one to use it for {current.label}
      </Text>
      {maps.length === 0 ? (
        <Text fontFamily={FONT} fontSize="11.5px" color={COLORS.subtle}>
          No other phase of this project has its own colors yet.
        </Text>
      ) : (
        maps.map((map) => (
          <Flex key={map.slot} align="center" gap="6px" flexWrap="wrap">
            <Box minW="96px">
              <PhaseBadge name={map.name} />
            </Box>
            {MAP_LOT_FILL.map(({ value, label }) => {
              const hex = map.palette[value]
              return (
                <Flex
                  key={value}
                  as="button"
                  type="button"
                  align="center"
                  gap="4px"
                  h="26px"
                  px="6px"
                  borderRadius="6px"
                  border="1px solid"
                  borderColor={draft[current.value] === hex ? COLORS.heading : COLORS.border}
                  bg={COLORS.surface}
                  fontFamily={FONT}
                  fontSize="11px"
                  color={COLORS.heading}
                  cursor="pointer"
                  title={`${map.name} ${label}: ${hex}`}
                  aria-label={`Use ${map.name} ${label} color ${hex} for ${current.label}`}
                  onClick={() => onPick(hex)}
                  _hover={{ bg: COLORS.hoverBg }}
                >
                  <Swatch color={hex} size="14px" />
                  {label}
                </Flex>
              )
            })}
            <Box
              as="button"
              type="button"
              h="26px"
              px="8px"
              borderRadius="6px"
              fontFamily={FONT}
              fontSize="11.5px"
              fontWeight="700"
              color={COLORS.brandGreen}
              cursor="pointer"
              _hover={{ bg: COLORS.hoverBg }}
              title={`Copy all of ${map.name}'s colors; Save colors keeps them`}
              onClick={() => onUseMap(map.palette)}
            >
              Use all
            </Box>
          </Flex>
        ))
      )}
    </Flex>
  )
}

function ManualColorPanel({ label, value, original, onChange, onUse, onCancel, button, useLabel = 'Use this color' }) {
  // What is typed, kept apart from `value` so a half-typed code is not overwritten.
  const [text, setText] = useState(value)
  const [rgb, setRgb] = useState(() => (hexToRgb(value) ?? [0, 0, 0]).map(String))
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(value)
    setRgb((hexToRgb(value) ?? [0, 0, 0]).map(String))
  }
  const field = {
    as: 'input',
    onPointerDown: (event) => event.stopPropagation(),
    h: '32px',
    px: '8px',
    borderRadius: '8px',
    border: '1px solid',
    borderColor: COLORS.border,
    bg: COLORS.surface,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '13px',
    color: COLORS.heading,
  }
  function changeChannel(index, raw) {
    const digits = raw.replace(/\D/g, '').slice(0, 3)
    const next = rgb.map((channel, i) => (i === index ? digits : channel))
    setRgb(next)
    const numbers = next.map(Number)
    if (next.every((channel) => channel !== '') && numbers.every((channel) => channel <= 255)) onChange(rgbToHex(numbers))
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
        </Flex>
        {/* The same colour as a code: hex (#RRGGBB, #RGB, or rgb(…) pasted in) or red, green and blue. */}
        <Flex align="flex-end" gap="8px" flexWrap="wrap">
          <Flex direction="column" gap="3px">
            <Text as="span" fontFamily={FONT} fontSize="11px" fontWeight="600" color={COLORS.subtle}>
              HEX
            </Text>
            <Box
              {...field}
              value={text}
              aria-label={`${label} color code (hex or rgb)`}
              placeholder="#RRGGBB"
              maxLength={20}
              w="96px"
              onChange={(event) => {
                setText(event.target.value)
                const parsed = parseColorCode(event.target.value)
                if (parsed) onChange(parsed)
              }}
              onBlur={() => setText(value)}
            />
          </Flex>
          {['R', 'G', 'B'].map((channel, index) => (
            <Flex key={channel} direction="column" gap="3px">
              <Text as="span" fontFamily={FONT} fontSize="11px" fontWeight="600" color={COLORS.subtle}>
                {channel}
              </Text>
              <Box
                {...field}
                value={rgb[index]}
                aria-label={`${label} ${['red', 'green', 'blue'][index]} (0–255)`}
                inputMode="numeric"
                w="52px"
                onChange={(event) => changeChannel(index, event.target.value)}
                onBlur={() => setRgb((hexToRgb(value) ?? [0, 0, 0]).map(String))}
              />
            </Flex>
          ))}
        </Flex>
        <Text fontFamily={FONT} fontSize="11.5px" color={COLORS.subtle}>
          Lots already colored {label} show the new color on the map as you pick.
        </Text>
        <Flex gap="6px">
          <Box {...button.primary} onClick={onUse}>
            {useLabel}
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
function LegendPickBanner({ picking, palette, saved, onSkip, onDone, onPreview, onUse, onRepick, onJump, onApply, onCancel }) {
  const confirming = picking.length === 0
  const current = MAP_LOT_FILL.find((option) => option.value === picking[0])
  // The status open on the colour wheel, with its colour from before the wheel moved it.
  const [manual, setManual] = useState(null) // null | { status, original }
  const manualOpen = Boolean(current && manual?.status === current.value)
  const button = PANEL_BUTTONS
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
                  // Any status can be read next, done or not: its own eyedropper.
                  as="button"
                  type="button"
                  cursor={now ? 'default' : 'pointer'}
                  title={now ? undefined : `Pick ${label} now`}
                  onClick={() => !now && onJump?.(value)}
                  _hover={now ? undefined : { bg: COLORS.statusBg }}
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
  const status = paint.status ? (FILL_BY_STATUS[paint.status]?.label ?? paint.status) : 'Available (circle removed)'
  return (
    <Box mt="10px" p="10px" border="1px solid" borderColor={COLORS.activeBg} borderRadius="10px" bg={COLORS.surface}>
      <Flex align="center" gap="8px" flexWrap="wrap" mb="8px">
        <Box boxSize="12px" borderRadius="3px" bg={palette[paint.status ?? 'open']} border="1px solid rgba(0,0,0,0.25)" />
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
  // One status's eyedropper: the status whose swatch is to be clicked now, and the picker for one.
  pickingLegendStatus = null,
  onPickLegendStatus,
  onDefaultPalette,
  // Edit colors: whether the wheel is open, its toggle, and the editor shown below the legend row.
  editingColors = false,
  onEditColors,
  colorEditor = null,
  // The map tab ('Phase 2') whose colours these are; shown beside the legend chips.
  paletteFor = '',
  // The project's other maps with saved colours ({ slot, name, palette }), for the
  // "Use colors from" dropdown; picking one copies its colours onto this map.
  otherPhases = [],
  onUsePhase,
  // The phase last picked there, preferred when several match these colours.
  chosenPhaseSlot = '',
  // Stop using another phase's colours: back to this map's own, or the defaults.
  onStopUsingPhase,
  tolerance,
  onTolerance,
  // Drawing and writing on the map: the colour and size marks are made in.
  markColor = MARK_COLORS[0],
  onMarkColor,
  markSize = MARK_SIZE_DEFAULT,
  onMarkSize,
  // How heavy text is written: 'normal' or 'bold'.
  markWeight = 'bold',
  onMarkWeight,
  // The eyedropper for the mark colour: whether it is waiting for a click on the map, and its button.
  pickingMarkColor = false,
  onPickMarkColor,
  // Statuses painted as a ring rather than a colour (ERHD's Sold), and the rings' thickness and colour.
  circled = [],
  ringThickness = 1,
  onRingThickness,
  ringColor = LOT_RING_COLOR,
  onRingColor,
  // The eyedropper for the ring colour, and whether it waits for a click on the map.
  pickingRingColor = false,
  onPickRingColor,
  // Whether painted lots are covered whole, lettering too, and its toggle.
  coverText = false,
  onCoverText,
  // The colour a circled lot is filled with under its ring, and its picker.
  ringBackground = REGULAR_BACKGROUND,
  onRingBackground,
  // 'bucket' | 'polygon' | 'lines' for a map with annotations; null hides the choice.
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
  /*
   * The other phase whose colours this map now paints with — the one picked from
   * "Use colors from", or any that happens to match — so the dropdown can show
   * it as selected. Worked out from the colours, so it holds after a reload.
   */
  const matchingPhases = matching || editingColors ? [] : otherPhases.filter((map) => samePalette(map.palette, palette))
  const fromPhase = matchingPhases.find((map) => map.slot === chosenPhaseSlot) ?? matchingPhases[0] ?? null
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
  const ringId = `${baseId}-ring`
  // The ringed statuses by name: "Sold ring".
  const ringName = `${MAP_LOT_FILL.filter(({ value }) => circled.includes(value))
    .map(({ label }) => label)
    .join(' / ')} ring`
  const legendStatuses = MAP_LOT_FILL.filter(({ value }) => !circled.includes(value))
  const moreId = `${baseId}-more`
  const [moreOpen, setMoreOpen] = useState(false)
  // Settings behind More options that are off their default.
  const changedCount = tolerance !== TOLERANCE_DEFAULT ? 1 : 0
  // The ring and legend settings, hidden until asked for — or shown while in use.
  const hasRings = circled.length > 0 && Boolean(onRingThickness)
  const ringSectionId = `${baseId}-rings`
  const legendId = `${baseId}-legend`
  const [ringOpen, setRingOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const ringShown = ringOpen || pickingRingColor
  const legendShown = legendOpen || matching || editingColors
  // How the legend colours are set, said on its button.
  const legendSummary = matching
    ? 'picking…'
    : editingColors
      ? 'editing…'
      : fromPhase
        ? `from ${fromPhase.name}`
        : isDefaultPalette(palette)
          ? 'Default'
          : 'From map legend'
  // An open section, set in under its button row.
  const sectionPanel = { mt: '8px', pl: '10px', borderLeft: '2px solid', borderColor: COLORS.border }
  const sectionToggle = ({ id, open, onToggle, icon, label, summary }) => (
    <Flex
      key={id}
      as="button"
      type="button"
      align="center"
      gap="6px"
      h="30px"
      px="10px"
      borderRadius="999px"
      border="1px solid"
      borderColor={open ? COLORS.heading : COLORS.border}
      bg={open ? COLORS.hoverBg : COLORS.surface}
      fontFamily={FONT}
      fontSize="12px"
      fontWeight="600"
      color={COLORS.heading}
      cursor="pointer"
      aria-expanded={open}
      aria-controls={id}
      title={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
      onClick={onToggle}
      _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
    >
      {icon}
      {label}
      {summary && !open ? (
        <Text as="span" fontWeight="500" color={COLORS.subtle}>
          · {summary}
        </Text>
      ) : null}
      <Icon as={LuChevronDown} boxSize="13px" transform={open ? 'rotate(180deg)' : undefined} transition="transform 120ms ease" />
    </Flex>
  )
  const busy = !ready || saving
  const action = (props) => ({
    ...controlStyle,
    opacity: busy || count === 0 ? 0.55 : 1,
    cursor: busy || count === 0 ? 'not-allowed' : 'pointer',
    'aria-disabled': busy || count === 0,
    ...props,
    onClick: busy || count === 0 ? undefined : props.onClick,
  })
  // Another phase's legend colours, copied onto this map.
  const legendPhaseSelect =
    onUsePhase && otherPhases.length ? (
      <NativeSelect.Root size="sm" w="auto">
        <NativeSelect.Field
          value={fromPhase?.slot ?? ''}
          onChange={(event) => {
            const other = otherPhases.find((map) => map.slot === event.target.value)
            if (other) onUsePhase(other)
            else if (!event.target.value) onStopUsingPhase?.()
          }}
          aria-label={paletteFor ? `Use another phase's legend colors for ${paletteFor}` : "Use another phase's legend colors"}
          title={fromPhase ? `This map uses ${fromPhase.name}'s legend colors` : "Copy another phase's legend colors onto this map"}
          h="30px"
          pr="28px"
          bg={fromPhase ? COLORS.hoverBg : COLORS.surface}
          border="1px solid"
          borderColor={fromPhase ? COLORS.heading : COLORS.border}
          borderRadius="999px"
          fontFamily={FONT}
          fontWeight={fromPhase ? '700' : '500'}
          fontSize="12px"
          color={COLORS.heading}
          cursor="pointer"
          _focusVisible={{ borderColor: COLORS.activeBg, outline: 'none' }}
        >
          {/* While another phase's colours are in use, the empty choice turns them off. */}
          <option value="" disabled={!fromPhase || !onStopUsingPhase}>
            {fromPhase && onStopUsingPhase ? "Don't use other phase colors" : 'Use colors from…'}
          </option>
          {otherPhases.map((map) => (
            <option key={map.slot} value={map.slot}>
              {map.slot === fromPhase?.slot ? `✓ Colors from ${map.name}` : map.name}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator color={COLORS.subtle} />
      </NativeSelect.Root>
    ) : null

  return (
    <Box mt="10px" p="10px" border="1px solid" borderColor={COLORS.border} borderRadius="10px" bg={COLORS.canvas}>
      <Flex align="center" gap="6px" flexWrap="wrap">
        <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
          Color as
        </Text>
        {MAP_LOT_FILL.map(({ value, label }) =>
          chip(
            value,
            label,
            // A circled status shows the ring it draws, not a colour.
            circled.includes(value) ? (
              <Box boxSize="13px" borderRadius="full" border="2.5px solid" borderColor={ringColor} title="Marked with a ring" />
            ) : (
              <Box boxSize="12px" borderRadius="3px" bg={palette[value]} border="1px solid rgba(0,0,0,0.25)" />
            ),
          ),
        )}
        {chip(ORIGINAL, 'Original', <Icon as={LuEraser} boxSize="13px" />)}
        {/* Circles printed into the map picture itself (ERHD's sold marks) are taken off with this brush. */}
        {circled.length
          ? chip(
              ERASE_RING,
              'Remove Sold',
              <Box position="relative" boxSize="13px" borderRadius="full" border="2px solid" borderColor={LOT_RING_COLOR} opacity={0.8}>
                <Box position="absolute" left="50%" top="-3px" bottom="-3px" w="2px" bg={COLORS.heading} transform="translateX(-50%) rotate(45deg)" />
              </Box>,
            )
          : null}
      </Flex>
      {/* Marking up the map: freehand strokes and text, saved with it. */}
      {onMarkColor ? (
        <Flex mt="8px" align="center" gap="6px" flexWrap="wrap" role="group" aria-label="Draw and write on the map">
          <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
            Mark up
          </Text>
          {chip(DRAW, 'Brush', <Icon as={LuPencil} boxSize="13px" />)}
          {chip(TEXT, 'Text', <Icon as={LuType} boxSize="13px" />)}
          {marking(brush) ? (
            <>
              <Flex align="center" gap="4px" ml="6px" role="radiogroup" aria-label="Mark color">
                {MARK_COLORS.map((color) => (
                  <Box
                    key={color}
                    as="button"
                    type="button"
                    role="radio"
                    aria-checked={markColor === color}
                    aria-label={`Color ${color}`}
                    boxSize="20px"
                    borderRadius="full"
                    bg={color}
                    border="2px solid"
                    borderColor={markColor === color ? COLORS.heading : 'rgba(0,0,0,0.2)'}
                    boxShadow={markColor === color ? `0 0 0 2px ${COLORS.surface} inset` : 'none'}
                    cursor="pointer"
                    onClick={() => onMarkColor(color)}
                  />
                ))}
                <Box
                  as="label"
                  position="relative"
                  boxSize="20px"
                  borderRadius="full"
                  overflow="hidden"
                  border="2px solid"
                  borderColor={MARK_COLORS.includes(markColor) ? 'rgba(0,0,0,0.2)' : COLORS.heading}
                  bg={MARK_COLORS.includes(markColor) ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : markColor}
                  cursor="pointer"
                  title="Any color"
                >
                  <input
                    type="color"
                    value={markColor}
                    onChange={(event) => onMarkColor(event.target.value.toUpperCase())}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                  />
                </Box>
                {onPickMarkColor ? (
                  <Flex
                    as="button"
                    type="button"
                    align="center"
                    justify="center"
                    boxSize="26px"
                    ml="2px"
                    borderRadius="full"
                    border="1px solid"
                    borderColor={pickingMarkColor ? COLORS.heading : COLORS.border}
                    bg={pickingMarkColor ? COLORS.hoverBg : COLORS.surface}
                    color={COLORS.heading}
                    cursor="pointer"
                    aria-pressed={pickingMarkColor}
                    aria-label="Pick a color from the map"
                    title="Eyedropper: pick a color from the map (or hold Alt and click the map)"
                    onClick={onPickMarkColor}
                    _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
                  >
                    <Icon as={LuPipette} boxSize="13px" />
                  </Flex>
                ) : null}
              </Flex>
              <Flex as="label" align="center" gap="6px" ml="8px" fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle}>
                Size
                <input
                  type="range"
                  min={MARK_SIZE_MIN}
                  max={MARK_SIZE_MAX}
                  step={1}
                  value={markSize}
                  onChange={(event) => onMarkSize(Number(event.target.value))}
                  style={{ width: '120px', accentColor: markColor, cursor: 'pointer' }}
                />
                <Text as="span" color={COLORS.heading} minW="14px">
                  {markSize}
                </Text>
              </Flex>
              {brush === TEXT && onMarkWeight ? (
                <Flex align="center" gap="4px" ml="8px" role="radiogroup" aria-label="Font weight">
                  <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="2px">
                    Weight
                  </Text>
                  {TEXT_WEIGHTS.map(({ value, label }) =>
                    chip(`weight-${value}`, <Text as="span" fontWeight={value === 'bold' ? '800' : '400'}>{label}</Text>, null, markWeight === value, () => onMarkWeight(value)),
                  )}
                </Flex>
              ) : null}
            </>
          ) : null}
        </Flex>
      ) : null}
      {!brush ? (
        <Text mt="8px" fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
          Nothing selected — clicks on the map paint nothing. Choose a color or tool above to start.
        </Text>
      ) : null}
      {brush === ERASE_RING ? (
        <Text mt="8px" fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
          Click a lot to remove the red circle printed on the map without changing its status. Painting a lot with any color also removes its printed circle, in the lot&apos;s new color. Undo brings it back.
        </Text>
      ) : null}
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
      {/* A circled lot's background: Regular (white), Prime (the map's yellow), or any colour. */}
      {onRingBackground && circled.includes(brush) ? (
        <Flex mt="8px" align="center" gap="6px" flexWrap="wrap" role="group" aria-label="Background">
          <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
            Background
          </Text>
          {[
            { value: REGULAR_BACKGROUND, label: 'Regular' },
            { value: palette.prime ?? PRIME_BACKGROUND, label: 'Prime' },
          ].map(({ value, label }) =>
            chip(`background-${label}`, label, <Swatch color={value} />, ringBackground.toUpperCase() === value.toUpperCase(), () => onRingBackground(value)),
          )}
          <Flex as="label" align="center" gap="6px" ml="4px" fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} cursor="pointer">
            Custom
            <input
              type="color"
              value={ringBackground.toLowerCase()}
              onChange={(event) => onRingBackground(event.target.value.toUpperCase())}
              aria-label="Custom background color"
              style={{ width: '30px', height: '24px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
            />
          </Flex>
        </Flex>
      ) : null}
      {/* A colour brush (not a mark or eraser) can cover the lot's words too. */}
      {onCoverText && palette[brush] ? (
        <Flex mt="8px" align="center" gap="6px" flexWrap="wrap" role="group" aria-label="Lettering">
          <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
            Lettering
          </Text>
          {chip('keep-text', 'Keep words', null, !coverText, () => onCoverText(false))}
          {chip('cover-text', 'Color over words', <Icon as={LuPaintBucket} boxSize="13px" />, coverText, () => onCoverText(true))}
        </Flex>
      ) : null}
      {/*
        * The settings that are not needed on every click — the rings, the legend
        * colours, and the finer options — each behind a show/hide button, with a
        * word on how each is set so nothing hidden is forgotten. A section opens
        * by itself while it is in use (an eyedropper waiting, colours being read).
        */}
      <Flex mt="10px" pt="10px" borderTop="1px solid" borderColor={COLORS.border} align="center" gap="6px" flexWrap="wrap">
        {hasRings
          ? sectionToggle({
              id: ringSectionId,
              open: ringShown,
              onToggle: () => setRingOpen((open) => !open),
              icon: <Box boxSize="12px" borderRadius="full" border={`${Math.min(4, 1.5 + ringThickness)}px solid`} borderColor={ringColor} />,
              label: ringName,
              summary: ringThickness !== 1 ? `${Math.round(ringThickness * 100)}%` : '',
            })
          : null}
        {sectionToggle({
          id: legendId,
          open: legendShown,
          onToggle: () => setLegendOpen((open) => !open),
          icon: <Icon as={LuPalette} boxSize="13px" />,
          label: 'Legend colors',
          summary: legendSummary,
        })}
        {sectionToggle({
          id: moreId,
          open: moreOpen,
          onToggle: () => setMoreOpen((open) => !open),
          icon: <Icon as={LuSlidersHorizontal} boxSize="13px" />,
          label: 'More options',
          summary: changedCount ? `${changedCount} changed` : '',
        })}
      </Flex>
      {/*
        * How thick the rings of circled lots are; painted rings follow at once.
        * A ring is moved by dragging its line on the map.
        */}
      {hasRings && ringShown ? (
        <Flex id={ringSectionId} {...sectionPanel} direction="column" gap="4px" role="group" aria-label={ringName}>
        <Flex align="center" gap="8px" flexWrap="wrap">
          <Text as="label" htmlFor={ringId} fontFamily={FONT} fontSize="12px" color={COLORS.subtle}>
            Thickness
          </Text>
          <input
            id={ringId}
            type="range"
            min={Math.round(RING_THICKNESS_MIN * 100)}
            max={Math.round(RING_THICKNESS_MAX * 100)}
            step={10}
            value={Math.round(ringThickness * 100)}
            aria-valuetext={`${Math.round(ringThickness * 100)}%${ringThickness === 1 ? ', default' : ''}`}
            onChange={(event) => onRingThickness(Number(event.target.value) / 100)}
            style={{ width: '140px', accentColor: ringColor, cursor: 'pointer' }}
          />
          <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.heading} minW="38px">
            {Math.round(ringThickness * 100)}%
          </Text>
          {ringThickness !== 1 ? chip('ring-default', 'Reset', null, false, () => onRingThickness(1)) : null}
          {onRingColor ? (
            <Flex align="center" gap="4px" role="radiogroup" aria-label="Ring color">
              <Box w="1px" h="20px" bg={COLORS.border} mx="6px" aria-hidden />
              <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle} mr="2px">
                Color
              </Text>
              {RING_COLORS.map((color) => (
                <Box
                  key={color}
                  as="button"
                  type="button"
                  role="radio"
                  aria-checked={ringColor === color}
                  aria-label={`Ring color ${color}${color === LOT_RING_COLOR ? ', default' : ''}`}
                  title={color === LOT_RING_COLOR ? 'Red (default)' : color}
                  boxSize="20px"
                  borderRadius="full"
                  bg="transparent"
                  border="4px solid"
                  borderColor={color}
                  boxShadow={ringColor === color ? `0 0 0 2px ${COLORS.surface}, 0 0 0 4px ${COLORS.heading}` : 'none'}
                  cursor="pointer"
                  onClick={() => onRingColor(color)}
                />
              ))}
              <Box
                as="label"
                position="relative"
                boxSize="20px"
                borderRadius="full"
                overflow="hidden"
                border="2px solid"
                borderColor={RING_COLORS.includes(ringColor) ? 'rgba(0,0,0,0.2)' : COLORS.heading}
                bg={RING_COLORS.includes(ringColor) ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : ringColor}
                cursor="pointer"
                title="Any color"
              >
                <input
                  type="color"
                  aria-label="Any ring color"
                  value={ringColor}
                  onChange={(event) => onRingColor(event.target.value.toUpperCase())}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                />
              </Box>
              {onPickRingColor ? (
                <Flex
                  as="button"
                  type="button"
                  align="center"
                  justify="center"
                  boxSize="26px"
                  ml="2px"
                  borderRadius="full"
                  border="1px solid"
                  borderColor={pickingRingColor ? COLORS.heading : COLORS.border}
                  bg={pickingRingColor ? COLORS.hoverBg : COLORS.surface}
                  color={COLORS.heading}
                  cursor="pointer"
                  aria-pressed={pickingRingColor}
                  aria-label="Pick the ring color from the map"
                  title="Eyedropper: pick the ring color from the map (or, with the Sold brush, hold Alt and click the map)"
                  onClick={onPickRingColor}
                  _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
                >
                  <Icon as={LuPipette} boxSize="13px" />
                </Flex>
              ) : null}
            </Flex>
          ) : null}
        </Flex>
        <Text fontFamily={FONT} fontSize="12px" color={pickingRingColor ? COLORS.heading : COLORS.subtle}>
          {pickingRingColor
            ? 'Click the map to pick the ring color.'
            : 'On the map, drag a ring to move it, or point at it and drag its round handle to resize it.'}
        </Text>
        </Flex>
      ) : null}
      {/*
        * Which colours the statuses paint: the default legend, or the colours of
        * the legend printed on this map, read by clicking each of its swatches.
        */}
      {legendShown ? (
      <Flex id={legendId} {...sectionPanel} direction="column" gap="6px" role="group" aria-label="Legend colors">
      <Flex align="center" gap="6px" flexWrap="wrap">
        <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
          Legend colors
        </Text>
        {chip('palette-default', 'Default', null, !matching && !editingColors && isDefaultPalette(palette), onDefaultPalette)}
        <Box as="span" title="Click each status's swatch in the map's legend, one after another" display="contents">
          {chip(
            'palette-legend',
            'From map legend',
            <Icon as={LuPipette} boxSize="13px" />,
            matching || (!editingColors && !fromPhase && !isDefaultPalette(palette)),
            onMatchLegend,
          )}
        </Box>
        {onEditColors ? chip('palette-wheel', 'Edit by hand', <Icon as={LuPalette} boxSize="13px" />, editingColors, onEditColors) : null}
        {paletteFor ? <PhaseBadge name={paletteFor} title={`These colors are saved for ${paletteFor} only`} /> : null}
        {legendPhaseSelect}
      </Flex>
        {/*
          * An eyedropper per status, to read just that swatch off the map's legend.
          * Not for a ringed status (ERHD's Sold): it is drawn as a ring, whose colour has its own eyedropper.
          */}
        {onPickLegendStatus && !editingColors ? (
          <Flex align="center" gap="4px" flexWrap="wrap" role="group" aria-label="Pick one legend color">
            <Text fontFamily={FONT} fontSize="12px" color={COLORS.subtle} mr="4px">
              Or pick just one from the legend:
            </Text>
            {legendStatuses.map(({ value, label }) => {
              const now = pickingLegendStatus === value
              return (
                <Flex
                  key={value}
                  as="button"
                  type="button"
                  align="center"
                  gap="4px"
                  h="26px"
                  px="7px"
                  borderRadius="999px"
                  border="1px solid"
                  borderColor={now ? '#1D4ED8' : COLORS.border}
                  bg={now ? '#1D4ED8' : COLORS.surface}
                  color={now ? '#FFFFFF' : COLORS.heading}
                  fontFamily={FONT}
                  fontSize="12px"
                  fontWeight="600"
                  cursor="pointer"
                  aria-pressed={now}
                  aria-label={`Pick the ${label} color from the map's legend`}
                  title={`Eyedropper: click the ${label} swatch in the map's legend (or, with the ${label} brush, hold Alt and click it)`}
                  onClick={() => onPickLegendStatus(value)}
                  _hover={now ? undefined : { bg: COLORS.hoverBg }}
                  _focusVisible={{ outline: '2px solid', outlineColor: COLORS.activeBg, outlineOffset: '2px' }}
                >
                  <Swatch color={palette[value]} />
                  {label}
                  <Icon as={LuPipette} boxSize="12px" />
                </Flex>
              )
            })}
          </Flex>
        ) : null}
      {colorEditor}
      </Flex>
      ) : null}
      {/* The finer settings — annotated-lot shapes and tolerance. */}
      <Box id={moreId} hidden={!moreOpen} {...sectionPanel}>
      {shapeMode ? (
        <Flex align="center" gap="6px" flexWrap="wrap" role="group" aria-label="Annotated lots">
          <Text fontFamily={FONT} fontSize="12px" fontWeight="600" color={COLORS.subtle} mr="4px">
            Annotated lots (optional)
          </Text>
          {chip('bucket', 'Bucket fill', <Icon as={LuPaintBucket} boxSize="13px" />, shapeMode === 'bucket', onShapeMode)}
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
