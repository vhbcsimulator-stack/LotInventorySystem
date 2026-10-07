import { useCallback, useEffect, useMemo, useState } from 'react'
import { TOLERANCE_DEFAULT, createRegionFinder, hexToRgb, regionContains, sampleColor } from './lotRecolor'
import { DEFAULT_PALETTE } from './legendPalette'
import { SVG_TYPE, isSvgUrl, lotMask, lotRing, maskPath, pictureSvg, recolorMatrix, recolorSvg, sanitizeSvg } from '@/lib/svgMaps'
import { UPLOAD_RULES } from '@/lib/uploadRules'

/*
 * An SVG map can hold far more detail than its annotations' size — the MVLC
 * maps are a 7016-pixel picture drawn into a 2048-unit SVG. Lots are found on a
 * copy drawn that much sharper, within this many pixels, so thin letter strokes
 * and small white lettering are still told apart from the lot around them.
 */
const SVG_PIXEL_BUDGET = 16_000_000
const SVG_MAX_SCALE = 4

/*
 * A JPG, PNG or WebP map has its lots found at its own full resolution,
 * whatever size the annotations were drawn at — up to this many pixels, past
 * which the browser would run short of memory.
 */
const RASTER_PIXEL_BUDGET = 64_000_000

/** How much larger than the annotations' size to draw the map for finding lots. */
function detailScale(url, width, height) {
  if (!isSvgUrl(url) || !width || !height) return 1
  return Math.max(1, Math.min(SVG_MAX_SCALE, Math.sqrt(SVG_PIXEL_BUDGET / (width * height))))
}

/**
 * The map's pixels: an SVG drawn at `width` × `height` (the annotations' size)
 * times `scale`; a picture at its own size, or smaller past the budget.
 */
function loadPixels(url, width, height, scale) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Storage serves public files with CORS headers, which lets the canvas read them.
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        let W = Math.round(width * scale)
        let H = Math.round(height * scale)
        if (!isSvgUrl(url) && img.naturalWidth && img.naturalHeight) {
          const shrink = Math.min(1, Math.sqrt(RASTER_PIXEL_BUDGET / (img.naturalWidth * img.naturalHeight)))
          W = Math.round(img.naturalWidth * shrink)
          H = Math.round(img.naturalHeight * shrink)
        }
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.imageSmoothingQuality = 'high'
        context.drawImage(img, 0, 0, W, H)
        const image = context.getImageData(0, 0, W, H)
        // How much sharper than the annotations' size this copy is; lot sizes are judged by it.
        const detail = Math.sqrt((W * H) / (width * height))
        resolve({ image, finder: createRegionFinder(image, { scale: detail }), regions: new Map() })
      } catch {
        reject(new Error('This map image cannot be recolored — its host does not allow reading its pixels.'))
      }
    }
    img.onerror = () => reject(new Error('The map image could not be loaded for coloring.'))
    img.src = url
  })
}

/** The file's own bytes as a data: URL — read, not re-encoded. */
const toDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('The map could not be read for saving.'))
    reader.readAsDataURL(blob)
  })

const NO_STATUSES = []

const keyOf = (paint) => (paint.shapeId !== undefined ? `s:${paint.shapeId}` : `p:${paint.x.toFixed(1)},${paint.y.toFixed(1)}`)

/**
 * Finds and recolours lots of the map at `url`, drawn at `width` × `height`
 * (the annotations' size, so polygon coordinates are pixel coordinates).
 *
 * `paints` is [{ shapeId, status }] for an annotated lot (its outline comes from
 * `shapes`) or [{ x, y, status }] for a lot clicked outside any annotation, in
 * the same coordinates. Later entries win where two cover the same lot.
 *
 * `palette` is { status: '#RRGGBB' } — the colour each status paints; the
 * defaults, or colours read off the map's own legend.
 *
 * Returns { ready, error, isSvg, layers, locatePoint(x, y), sampleColor(x, y),
 * toSvgBlob(), toPngBlob() }. The SVG is used for stored maps; the PNG is a
 * lossless download rendered at the painter's full working dimensions. `layers`
 * is what the preview draws over the map (see PaintLayers); locatePoint says
 * whether a point is inside a lot and which point-paint (if any) already covers it.
 */
export default function useLotPainter({
  enabled,
  url,
  width,
  height,
  shapes,
  paints,
  tolerance = TOLERANCE_DEFAULT,
  palette = DEFAULT_PALETTE,
  // How an annotated lot is found: 'polygon' colors exactly inside its outline; 'lines' follows the printed lot lines from it.
  shapeMode = 'polygon',
  // Statuses marked with a red ring around the lot rather than recoloured (ERHD's Sold).
  circled = NO_STATUSES,
  // How thick those rings are, as a multiple of the default.
  ringThickness = 1,
}) {
  const [loaded, setLoaded] = useState(null) // { key, pixels }
  const [failed, setFailed] = useState(null) // { key, message }
  const scale = detailScale(url, width, height)
  const loadKey = `${url}|${width}x${height}|${scale}`
  const pixels = loaded?.key === loadKey ? loaded.pixels : null
  /*
   * Lots are found on a copy drawn W × H — a picture's own size, or the
   * annotations' size made sharper for an SVG map. Regions are in that copy's
   * pixels; outlines and clicks are scaled into it, and what the preview draws
   * is scaled back.
   */
  const W = pixels?.image.width ?? Math.round(width * scale)
  const H = pixels?.image.height ?? Math.round(height * scale)
  const sx = width ? W / width : 1
  const sy = height ? H / height : 1
  const rings = useMemo(
    () => new Map(shapes.map((shape) => [shape.id, shape.rings.map((ring) => ring.map(([x, y]) => [x * sx, y * sy]))])),
    [shapes, sx, sy],
  )

  useEffect(() => {
    if (!enabled || !url || !width || !height) return undefined
    let live = true
    loadPixels(url, width, height, scale).then(
      (pixels) => live && setLoaded({ key: loadKey, pixels }),
      (err) => live && setFailed({ key: loadKey, message: err.message }),
    )
    return () => {
      live = false
    }
  }, [enabled, url, width, height, scale, loadKey])

  const fillRgb = useMemo(() => Object.fromEntries(Object.entries(palette).map(([status, hex]) => [status, hexToRgb(hex)])), [palette])

  /**
   * The pixels a paint covers, worked out once per tolerance from the untouched
   * original — so moving the tolerance back and forth costs nothing the second time.
   */
  const regionOf = useCallback(
    (paint) => {
      const shape = paint.shapeId !== undefined
      const key = `${keyOf(paint)}@${tolerance}${shape ? `/${shapeMode}` : ''}`
      if (!pixels.regions.has(key)) {
        const findShape = shapeMode === 'lines' ? pixels.finder.inPolygon : pixels.finder.inPolygonExact
        const region =
          shape
            ? rings.has(paint.shapeId)
              ? findShape(rings.get(paint.shapeId), { tolerance })
              : null
            : pixels.finder.at(paint.x / (width - 1), paint.y / (height - 1), { tolerance })
        pixels.regions.set(key, region)
      }
      return pixels.regions.get(key)
    },
    [pixels, rings, width, height, tolerance, shapeMode],
  )

  /**
   * Each painted lot once — its last paint wins — with its new colour and the
   * colour it has on the untouched map. A circled lot carries its ring instead
   * (in canvas pixels), moved by the paint's `ringOffset` — where it was
   * dragged to, in the annotations' coordinates.
   */
  const painted = useMemo(() => {
    if (!pixels) return []
    const { data } = pixels.image
    const lots = []
    for (const paint of [...paints].reverse()) {
      const region = regionOf(paint)
      if (!region || !fillRgb[paint.status]) continue
      if (lots.some((lot) => regionContains(lot.region, region.seed))) continue
      const o = region.seed * 4
      const ring = circled.includes(paint.status)
        ? lotRing(region, W, {
            thickness: ringThickness,
            offset: paint.ringOffset ? [paint.ringOffset.dx * sx, paint.ringOffset.dy * sy] : null,
          })
        : null
      lots.unshift({ paint, region, rgb: fillRgb[paint.status], fill: [data[o], data[o + 1], data[o + 2]], ring })
    }
    return lots
  }, [pixels, paints, regionOf, fillRgb, circled, ringThickness, W, sx, sy])

  /**
   * The rings drawn over circled lots, in the preview's units: each with the
   * paint it belongs to and its lot's box, so the preview can drag it within it.
   */
  const circles = useMemo(() => {
    const s = Math.sqrt(sx * sy)
    return painted
      .filter((lot) => lot.ring)
      .map(({ paint, region, ring: { cx, cy, r, strokeWidth, bounds } }) => ({
        key: region.seed,
        paint,
        cx: cx / sx,
        cy: cy / sy,
        r: r / s,
        strokeWidth: strokeWidth / s,
        bounds: { x0: bounds.x0 / sx, y0: bounds.y0 / sy, x1: bounds.x1 / sx, y1: bounds.y1 / sy },
      }))
  }, [painted, sx, sy])

  /*
   * The preview's colour layers: per old → new colour pair, the painted lots'
   * outlines (in canvas pixels, the preview's own units), the colour matrix, and
   * the area it works over. The preview draws the map it already shows through
   * these, clipped to the lots — at full display resolution, the instant a lot
   * is painted, with no copy of the map at a lower resolution in between.
   */
  const layers = useMemo(() => {
    const byPair = new Map()
    for (const { region, rgb, fill, ring } of painted) {
      if (ring) continue
      const key = `${fill.join('-')}_${rgb.join('-')}`
      if (!byPair.has(key)) {
        byPair.set(key, { key, matrix: recolorMatrix(fill, rgb), paths: [], box: [Infinity, Infinity, -Infinity, -Infinity] })
      }
      const layer = byPair.get(key)
      const mask = lotMask(region, W, H)
      layer.paths.push(maskPath(mask))
      layer.box = [
        Math.min(layer.box[0], mask.x0),
        Math.min(layer.box[1], mask.y0),
        Math.max(layer.box[2], mask.x0 + mask.w),
        Math.max(layer.box[3], mask.y0 + mask.h),
      ]
    }
    // Outlines are in the sharper copy's pixels; `scale` takes them back to the preview's units.
    return [...byPair.values()].map(({ paths, ...layer }) => ({ ...layer, d: paths.join(''), scale: [sx, sy] }))
  }, [painted, W, H, sx, sy])

  const locatePoint = useCallback(
    (x, y) => {
      if (!pixels) return { found: false, index: -1 }
      const region = regionOf({ x, y })
      if (!region) return { found: false, index: -1 }
      const index = paints.findIndex((paint) => {
        if (paint.shapeId !== undefined) return false
        const other = regionOf(paint)
        return other && regionContains(region, other.seed)
      })
      return { found: true, index }
    },
    [pixels, paints, regionOf],
  )

  /** The untouched map's colour at (x, y), in the annotations' coordinates — for reading a legend swatch. */
  const sample = useCallback(
    (x, y) => (pixels ? sampleColor(pixels.image, x * sx, y * sy, Math.max(2, Math.round(3 * sx))) : null),
    [pixels, sx, sy],
  )

  /*
   * The recoloured map, always as SVG — the map and its coloured lots in one
   * file, with nothing re-encoded:
   *  - an SVG map is its own SVG, with each painted lot written in (see recolorSvg);
   *  - a JPG, PNG or WebP map is first wrapped, byte for byte, in an SVG of the
   *    annotations' size (see pictureSvg) — the file as uploaded, not a
   *    re-compressed copy — and the lots are written in over it.
   * Lots become plain filled paths, traced on the sharpest copy lots are found
   * on, so lettering and lines stay crisp; nothing the Flutter app's
   * flutter_svg cannot draw is used.
   */
  const toSvgBlob = useCallback(async () => {
    if (!pixels) throw new Error('Nothing to save yet.')
    const response = await fetch(url)
    if (!response.ok) throw new Error('The map could not be loaded for saving.')
    let original = await response.blob()
    const svg = isSvgUrl(url) || /svg/i.test(original.type)
    if (!svg && !/^image\//.test(original.type)) {
      // Storage served no type: go by the file's extension.
      const ext = /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.exec(url)?.[1].toLowerCase()
      original = new Blob([original], { type: `image/${ext === 'jpg' ? 'jpeg' : ext || 'png'}` })
    }
    const source = svg ? await original.text() : pictureSvg(await toDataUrl(original), width, height)
    const { text } = recolorSvg(source, { width: W, height: H, lots: painted })
    const blob = new Blob([sanitizeSvg(text)], { type: SVG_TYPE })
    if (blob.size > UPLOAD_RULES.map.maxBytes) {
      throw new Error(`The colored map comes to ${(blob.size / 1024 / 1024).toFixed(1)} MB, past the ${UPLOAD_RULES.map.maxBytes / 1024 / 1024} MB map limit.`)
    }
    return blob
  }, [pixels, url, width, height, W, H, painted])

  /** The finished SVG rasterised losslessly at the same full size used to find and colour its lots. */
  const toPngBlob = useCallback(async () => {
    const svg = await toSvgBlob()
    const href = URL.createObjectURL(svg)
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new Error('The colored map could not be rendered as PNG.'))
        element.src = href
      })
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const context = canvas.getContext('2d')
      if (!context) throw new Error('The browser could not create the PNG image.')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, W, H)
      return await new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the colored map as PNG.'))),
          'image/png',
        )
      })
    } finally {
      URL.revokeObjectURL(href)
    }
  }, [toSvgBlob, W, H])

  const ready = enabled && Boolean(pixels)
  return {
    ready,
    error: enabled && failed?.key === loadKey ? failed.message : '',
    isSvg: isSvgUrl(url),
    layers: ready ? layers : [],
    circles: ready ? circles : [],
    locatePoint,
    sampleColor: sample,
    toSvgBlob,
    toPngBlob,
  }
}
