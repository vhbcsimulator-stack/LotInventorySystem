import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRegionFinder, hexToRgb, paintRegion, regionContains } from './lotRecolor'
import { MAP_LOT_FILL } from '@/theme/colors'

const FILL_RGB = Object.fromEntries(MAP_LOT_FILL.map(({ value, color }) => [value, hexToRgb(color)]))

/** The map drawn at the annotations' size, so polygon coordinates are pixel coordinates. */
function loadPixels(url, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Storage serves public files with CORS headers, which lets the canvas read them.
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.imageSmoothingQuality = 'high'
        context.drawImage(img, 0, 0, width, height)
        const image = context.getImageData(0, 0, width, height)
        resolve({ image, finder: createRegionFinder(image), regions: new Map() })
      } catch {
        reject(new Error('This map image cannot be recolored — its host does not allow reading its pixels.'))
      }
    }
    img.onerror = () => reject(new Error('The map image could not be loaded for coloring.'))
    img.src = url
  })
}

const keyOf = (paint) => (paint.shapeId !== undefined ? `s:${paint.shapeId}` : `p:${paint.x.toFixed(1)},${paint.y.toFixed(1)}`)

/**
 * Repaints lots of the map at `url` onto `canvasRef`, a <canvas width height>
 * the caller renders at the annotations' size.
 *
 * `paints` is [{ shapeId, status }] for an annotated lot (its outline comes from
 * `shapes`) or [{ x, y, status }] for a lot clicked outside any annotation, in
 * the same coordinates. Later entries win where two cover the same lot.
 *
 * Returns { ready, error, locatePoint(x, y), toBlob() }: locatePoint says whether
 * a point is inside a lot and which point-paint (if any) already covers it.
 */
export default function useLotPainter({ enabled, url, width, height, shapes, paints, canvasRef }) {
  const [loaded, setLoaded] = useState(null) // { key, pixels }
  const [failed, setFailed] = useState(null) // { key, message }
  const output = useRef(null)
  const loadKey = `${url}|${width}x${height}`
  const rings = useMemo(() => new Map(shapes.map((shape) => [shape.id, shape.rings])), [shapes])

  useEffect(() => {
    if (!enabled || !url || !width || !height) return undefined
    let live = true
    loadPixels(url, width, height).then(
      (pixels) => live && setLoaded({ key: loadKey, pixels }),
      (err) => live && setFailed({ key: loadKey, message: err.message }),
    )
    return () => {
      live = false
    }
  }, [enabled, url, width, height, loadKey])

  const pixels = loaded?.key === loadKey ? loaded.pixels : null

  /** The pixels a paint covers, worked out once from the untouched original. */
  const regionOf = useCallback(
    (paint) => {
      const key = keyOf(paint)
      if (!pixels.regions.has(key)) {
        const region =
          paint.shapeId !== undefined
            ? rings.has(paint.shapeId)
              ? pixels.finder.inPolygon(rings.get(paint.shapeId))
              : null
            : pixels.finder.at(paint.x / (width - 1), paint.y / (height - 1))
        pixels.regions.set(key, region)
      }
      return pixels.regions.get(key)
    },
    [pixels, rings, width, height],
  )

  // Layout effect, so the canvas never shows unpainted for a frame.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!enabled || !pixels || !canvas) return
    const { image } = pixels
    if (output.current?.width !== image.width || output.current?.height !== image.height) {
      output.current = new ImageData(image.width, image.height)
    }
    const out = output.current
    out.data.set(image.data)
    for (const paint of paints) {
      const region = regionOf(paint)
      if (region && FILL_RGB[paint.status]) paintRegion(out.data, region, FILL_RGB[paint.status])
    }
    canvas.getContext('2d').putImageData(out, 0, 0)
  }, [enabled, pixels, paints, regionOf, canvasRef])

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

  const toBlob = useCallback(
    () =>
      new Promise((resolve, reject) => {
        const canvas = canvasRef.current
        if (!canvas) return reject(new Error('Nothing to save yet.'))
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not export the image.'))), 'image/png')
      }),
    [canvasRef],
  )

  return {
    ready: enabled && Boolean(pixels),
    error: enabled && failed?.key === loadKey ? failed.message : '',
    locatePoint,
    toBlob,
  }
}
