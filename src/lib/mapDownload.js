/*
 * Map downloads: a stored map (SVG, or a JPG/PNG/WebP picture) drawn to a PNG
 * large enough to keep its lot numbers and street names sharp, optionally
 * made smaller without making it hard to read. Used by the portal's map view
 * and the public map gallery (/maps/).
 *
 * Browser only — drawing needs a canvas.
 */

/** The longest side, in pixels, an SVG map is drawn at when downloaded as PNG. */
const DOWNLOAD_MIN_SIDE = 4096
const DOWNLOAD_MAX_SIDE = 8192

/**
 * No compression level makes a map's longest side smaller than this, or than
 * the map's own size when that is already smaller: at it, a site map's lot
 * numbers stay legible when zoomed in.
 */
export const MIN_READABLE_SIDE = 4096

/**
 * How a downloaded PNG may be made smaller. Every level keeps the PNG format.
 *  - hd:       lossless, at full size.
 *  - balanced: the same pixels limited to a 256-colour palette — lines and
 *              lettering stay at full resolution, so they read exactly as before.
 *  - smallest: the palette, and the picture scaled down to 70% — but never below
 *              MIN_READABLE_SIDE on its longest side.
 */
export const COMPRESSION = {
  hd: { label: 'Original HD', colors: 0, scale: 1 },
  balanced: { label: 'Compressed', colors: 256, scale: 1 },
  smallest: { label: 'Smallest', colors: 256, scale: 0.7 },
}

/** An SVG's own size: its width and height, or failing those its viewBox. */
function svgSize(text) {
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement
  const box = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const width = parseFloat(root.getAttribute('width')) || box[2] || 0
  const height = parseFloat(root.getAttribute('height')) || box[3] || 0
  return { width, height }
}

/** Saves `blob` as `fileName` through a temporary link. */
export function saveBlob(blob, fileName) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

/** A name safe for a file: lower case, words joined by dashes. */
export const fileNameOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'

async function fetchMap(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('The map could not be loaded for download.')
  const blob = await response.blob()
  const svg = /svg/i.test(blob.type) || /\.svg(?:$|[?#])/i.test(url)
  return { blob, svg }
}

function loadImage(href) {
  return new Promise((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('The map could not be drawn for download.'))
    element.src = href
  })
}

/**
 * The map drawn on a white canvas. An SVG is drawn with its longest side
 * between DOWNLOAD_MIN_SIDE and DOWNLOAD_MAX_SIDE; a picture at its own size,
 * since enlarging it adds no detail. `scale` shrinks either, never below
 * MIN_READABLE_SIDE (or the picture's own size, if smaller).
 */
async function drawMap({ blob, svg }, scale = 1) {
  const text = svg ? await blob.text() : ''
  const href = URL.createObjectURL(svg ? new Blob([text], { type: 'image/svg+xml' }) : blob)
  try {
    const image = await loadImage(href)
    let width = image.naturalWidth || 1
    let height = image.naturalHeight || 1
    if (svg) {
      const own = svgSize(text)
      width = own.width || width
      height = own.height || height
      const side = Math.max(width, height)
      const factor = Math.min(DOWNLOAD_MAX_SIDE, Math.max(DOWNLOAD_MIN_SIDE, side)) / side
      width *= factor
      height *= factor
    }
    if (scale < 1) {
      const side = Math.max(width, height)
      const factor = Math.max(scale, Math.min(1, MIN_READABLE_SIDE / side))
      width *= factor
      height *= factor
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width)
    canvas.height = Math.round(height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The browser could not create the image.')
    context.fillStyle = '#FFFFFF'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(href)
  }
}

const canvasPng = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('The browser could not save the map as PNG.'))), 'image/png'),
  )

/** The canvas as a palette PNG of up to `colors` colours, encoded off the main thread. */
function palettePng(canvas, colors) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  const worker = new Worker(new URL('./pngCompress.worker.js', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data: reply }) => {
      worker.terminate()
      if (reply.error) reject(new Error(`The map could not be compressed: ${reply.error}`))
      else resolve(new Blob([reply.png], { type: 'image/png' }))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(`The map could not be compressed: ${event.message || 'the browser stopped it'}`))
    }
    worker.postMessage({ buffer: data.buffer, width: canvas.width, height: canvas.height, colors }, [data.buffer])
  })
}

/**
 * The map at `url` as a PNG, at the given COMPRESSION level. A compressed
 * file that comes out no smaller than the lossless one is dropped for it.
 */
export async function mapPng(url, level = 'hd') {
  const { colors, scale } = COMPRESSION[level] ?? COMPRESSION.hd
  const canvas = await drawMap(await fetchMap(url), scale)
  if (!colors) return canvasPng(canvas)
  // toBlob first: the palette step hands the canvas's pixels to the worker.
  const lossless = await canvasPng(canvas)
  const compressed = await palettePng(canvas, colors)
  return compressed.size < lossless.size ? compressed : lossless
}

/**
 * Downloads a map as a picture. A JPG, PNG or WebP map is saved as uploaded;
 * an SVG map — every colored map is one — is drawn to a PNG large enough to
 * keep its lettering sharp, since most people want a picture they can open
 * and share rather than a vector file.
 */
export async function downloadMap(url, baseName) {
  const map = await fetchMap(url)
  if (!map.svg) {
    const ext = /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.exec(url)?.[1].toLowerCase() ?? map.blob.type.split('/')[1] ?? 'png'
    saveBlob(map.blob, `${baseName}.${ext === 'jpeg' ? 'jpg' : ext}`)
    return
  }
  saveBlob(await canvasPng(await drawMap(map)), `${baseName}.png`)
}
