/*
 * SVG site maps: kept as vectors from upload to recoloured save, so a map stays
 * sharp at any zoom instead of being flattened to a fixed-size picture.
 *
 * Browser only — parsing, sanitising, and hit-testing all need the DOM.
 */
import DOMPurify from 'dompurify'
import { WHITE_BLEND, regionContains } from '@/components/projects/lotRecolor'

export const SVG_TYPE = 'image/svg+xml'
const SVG_NS = 'http://www.w3.org/2000/svg'

export const isSvgFile = (file) => file?.type === SVG_TYPE || /\.svg$/i.test(file?.name ?? '')
export const isSvgUrl = (url) => /^data:image\/svg\+xml/i.test(url ?? '') || /\.svg(?:$|[?#])/i.test(url ?? '')

/**
 * The markup with anything that could run or phone home removed. The map
 * buckets are public, and an SVG opened directly in a browser runs its scripts,
 * so every stored SVG passes through this — uploads and recoloured saves alike.
 */
export function sanitizeSvg(text) {
  const clean = DOMPurify.sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // CAD exports colour their fills through a <style> block of classes.
    ADD_TAGS: ['style', 'use'],
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'embed', 'object'],
  })
  const doc = parse(clean)
  // Only links inside the file (#id) or embedded pictures survive; nothing is fetched from elsewhere.
  for (const el of doc.querySelectorAll('*')) {
    for (const name of ['href', 'xlink:href']) {
      const value = el.getAttribute(name)
      if (value && !value.startsWith('#') && !/^data:image\/(png|jpe?g|webp|gif);/i.test(value)) el.removeAttribute(name)
    }
  }
  return serialize(doc)
}

function parse(text) {
  const doc = new DOMParser().parseFromString(text, SVG_TYPE)
  const root = doc.documentElement
  if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('The file is not a readable SVG image.')
  }
  return doc
}

const serialize = (doc) => new XMLSerializer().serializeToString(doc)

/** A length attribute in user units, or 0 for a missing or relative one ("100%"). */
const length = (value) => (value && !/%$/.test(value.trim()) ? parseFloat(value) || 0 : 0)

/** The root's viewBox, adding one from its width and height when it has none. */
function ensureViewBox(root) {
  const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) return box
  const width = length(root.getAttribute('width'))
  const height = length(root.getAttribute('height'))
  if (!width || !height) throw new Error('The SVG has no size — it needs a viewBox, or a width and a height.')
  root.setAttribute('viewBox', `0 0 ${width} ${height}`)
  return [0, 0, width, height]
}

/**
 * An SVG `transform` as { a, d, e, f } — scale and offset — for the translate,
 * scale, and matrix forms an export writes. Null for a rotation or skew.
 */
export function parseTransform(value) {
  let m = { a: 1, d: 1, e: 0, f: 0 }
  const pattern = /(translate|scale|matrix)\s*\(([^)]*)\)|(rotate|skew[XY]?)\s*\(/g
  for (const match of String(value ?? '').matchAll(pattern)) {
    if (match[3]) return null
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)
    let t
    if (match[1] === 'translate') t = { a: 1, d: 1, e: args[0] ?? 0, f: args[1] ?? 0 }
    else if (match[1] === 'scale') t = { a: args[0] ?? 1, d: args[1] ?? args[0] ?? 1, e: 0, f: 0 }
    else {
      if (Math.abs(args[1] ?? 0) > 1e-9 || Math.abs(args[2] ?? 0) > 1e-9) return null
      t = { a: args[0] ?? 1, d: args[3] ?? 1, e: args[4] ?? 0, f: args[5] ?? 0 }
    }
    // Applied in order: the new step acts first on the picture's own units.
    m = { a: m.a * t.a, d: m.d * t.d, e: m.a * t.e + m.e, f: m.d * t.f + m.f }
  }
  return m
}

/** How far a picture may miss its frame and still be taken as meant to fill it: 5%. */
const NEAR_FILL = 0.05

/** The frame [x, y, w, h] and the picture's box [left, top, right, bottom], or null. */
function pictureInFrame(frame, image) {
  const w = length(image.width)
  const h = length(image.height)
  const m = parseTransform(image.transform)
  if (!w || !h || !m) return null
  const x = length(image.x)
  const y = length(image.y)
  return { frame, box: [m.a * x + m.e, m.d * y + m.f, m.a * (x + w) + m.e, m.d * (y + h) + m.f] }
}

/** How far, in the SVG's units, the picture's edges sit from the frame's. */
const misfitOf = ({ frame: [fx, fy, fw, fh], box: [l, t, r, b] }) =>
  Math.max(Math.abs(l - fx), Math.abs(t - fy), Math.abs(r - (fx + fw)), Math.abs(b - (fy + fh)))

/**
 * An export that wraps one picture in an SVG can round its scale — the MVLC
 * Phase 2 East map places a 7016 × 4961 picture at scale .29, which draws it
 * 2034.6 × 1438.7 inside a 2048 × 1448 frame. Annotations drawn on the picture
 * at the full frame size then drift, more toward the right and bottom.
 *
 * From the start of an SVG file alone, returns { frame, picture } in the SVG's
 * units when that is so — a picture close to filling the frame, but off by more
 * than half a unit — or null.
 */
export function frameMisfit(head) {
  const svgTag = /<svg\b[^>]*>/i.exec(head)?.[0]
  if (!svgTag) return null
  const attr = (tag, name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]
  let frame = (attr(svgTag, 'viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (frame.length !== 4 || !frame.every(Number.isFinite)) {
    const w = length(attr(svgTag, 'width'))
    const h = length(attr(svgTag, 'height'))
    if (!w || !h) return null
    frame = [0, 0, w, h]
  }
  // The first thing drawn must be the picture. Its tag may run past the end of
  // `head` — the picture's data follows its size — so it need not be closed.
  const body = head.slice(head.indexOf(svgTag) + svgTag.length)
  const first = /<(?!\/|!|\?|metadata\b|defs\b|style\b|title\b|desc\b)([a-zA-Z][\w:-]*)\b[^>]*(?:>|$)/.exec(
    body.replace(/<(metadata|defs|style|title|desc)\b[\s\S]*?<\/\1>/gi, ''),
  )
  if (!first || first[1].toLowerCase() !== 'image') return null
  const tag = first[0]
  const found = pictureInFrame(frame, {
    width: attr(tag, 'width'),
    height: attr(tag, 'height'),
    x: attr(tag, 'x'),
    y: attr(tag, 'y'),
    transform: attr(tag, 'transform'),
  })
  if (!found) return null
  const off = misfitOf(found)
  if (off < 0.5 || off > NEAR_FILL * Math.max(frame[2], frame[3])) return null
  const [l, t, r, b] = found.box
  return { frame: { width: frame[2], height: frame[3] }, picture: { width: +(r - l).toFixed(1), height: +(b - t).toFixed(1) } }
}

/**
 * A lone embedded picture that nearly fills the SVG's frame (see frameMisfit)
 * made to fill it exactly. True when it changed anything.
 */
function fillFrame(root) {
  const frame = ensureViewBox(root)
  const drawn = [...root.children].filter((el) => !NOT_DRAWN.has(el.localName))
  if (drawn.length !== 1 || drawn[0].localName !== 'image') return false
  const image = drawn[0]
  const found = pictureInFrame(frame, {
    width: image.getAttribute('width'),
    height: image.getAttribute('height'),
    x: image.getAttribute('x'),
    y: image.getAttribute('y'),
    transform: image.getAttribute('transform'),
  })
  if (!found) return false
  const off = misfitOf(found)
  if (off < 0.5 || off > NEAR_FILL * Math.max(frame[2], frame[3])) return false
  image.removeAttribute('transform')
  image.setAttribute('x', String(frame[0]))
  image.setAttribute('y', String(frame[1]))
  image.setAttribute('width', String(frame[2]))
  image.setAttribute('height', String(frame[3]))
  image.setAttribute('preserveAspectRatio', 'none')
  return true
}

/**
 * The SVG drawn at `size` ({ width, height }, the annotations' pixels): the
 * vector equivalent of redrawing a picture at that size, without losing any
 * detail. Proportions that differ are stretched, as a resized picture would be.
 * A lone picture that misses its frame by a rounding error is made to fill it
 * (see frameMisfit), so annotations drawn on the picture line up. Resolves the
 * same text when nothing needs to change.
 */
export function fitSvg(text, size) {
  const doc = parse(text)
  const root = doc.documentElement
  const [, , boxWidth, boxHeight] = ensureViewBox(root)
  const filled = fillFrame(root)
  if (!size) {
    // Still give it an explicit size: a browser needs one to draw it on a canvas.
    if (!length(root.getAttribute('width')) || !length(root.getAttribute('height'))) {
      root.setAttribute('width', String(boxWidth))
      root.setAttribute('height', String(boxHeight))
    }
    return serialize(doc)
  }
  if (!filled && length(root.getAttribute('width')) === size.width && length(root.getAttribute('height')) === size.height) return text
  root.setAttribute('width', String(size.width))
  root.setAttribute('height', String(size.height))
  if (Math.abs(boxWidth / boxHeight - size.width / size.height) > 0.001) root.setAttribute('preserveAspectRatio', 'none')
  return serialize(doc)
}

/** `file` as a sanitised SVG, fitted to `size` when one is given. */
export async function prepareSvgFile(file, size = null) {
  const text = fitSvg(sanitizeSvg(await file.text()), size)
  const name = file.name ? file.name.replace(/\.[^.]+$/, '') + '.svg' : 'map.svg'
  return new File([text], name, { type: SVG_TYPE })
}

/**
 * A JPG, PNG, WebP or GIF map as an SVG: `dataUrl`, the file's own bytes,
 * drawn over `width` × `height` user units — the annotations' size, so the
 * stored map still lines up with them. The picture is embedded as uploaded,
 * never re-encoded, so it keeps every bit of its quality. Linked by
 * xlink:href, which older flutter_svg releases need and every browser reads.
 */
export function pictureSvg(dataUrl, width, height) {
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(dataUrl ?? '')) throw new Error('The map could not be saved as SVG — it is not a JPG, PNG, WebP or GIF picture.')
  if (!(width > 0 && height > 0)) throw new Error('The map has no size.')
  return (
    `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" xlink:href="${dataUrl}"/>` +
    '</svg>'
  )
}

const SHAPES = 'path, polygon, rect, circle, ellipse, polyline'
const OUTSIDE_DRAWING = 'defs, clipPath, mask, pattern, symbol, marker'
/** Root children that are not drawing. */
const NOT_DRAWN = new Set(['defs', 'style', 'title', 'desc', 'metadata'])
/** The layer of recoloured lots, drawn over the map; each lot in it is a group of its own. */
const COLORS_ATTR = 'data-bhri-lot-colors'
const LOT_ATTR = 'data-bhri-lot'
/** The same marks under the names maps were saved with before the rename to BHRI. */
const LEGACY_ATTRS = [
  ['data-vhbc-lot-colors', COLORS_ATTR],
  ['data-vhbc-lot', LOT_ATTR],
]
/** Renames the older marks in a saved map, so its earlier colours are found and replaced as usual. */
function upgradeLegacyMarks(root) {
  for (const [legacy, current] of LEGACY_ATTRS) {
    for (const el of root.querySelectorAll(`[${legacy}]`)) {
      el.setAttribute(current, el.getAttribute(legacy))
      el.removeAttribute(legacy)
    }
  }
}
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
const rgbOf = (value) => {
  const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value ?? '')
  return match ? match.slice(1, 4).map(Number) : null
}
const close = (a, b, tolerance) => a && b && (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 <= tolerance ** 2
/** How near a shape's own fill must be to the colour seen on the map. */
const FILL_MATCH = 48

/*
 * A lot's pixels become flat colours, a few shades per lot: the fill itself,
 * and the soft edges of its lettering and border lines stepped down to it.
 * Below DARK_SKIP a pixel is text or line, and the map shows through as drawn.
 */
const DARK_SKIP = 0.3
const FULL_SHADE = 0.9
const SHADE_STEP = 0.1
const WHITE_STEP = 0.25
const WHITE_SKIP = 0.9

/** The flat colour a pixel of shade `k` takes when its lot turns `rgb`, or null to leave it as drawn. */
export function shadeColor([r, g, b], k) {
  if (k >= WHITE_BLEND) {
    const t = Math.round((k - WHITE_BLEND) / WHITE_STEP) * WHITE_STEP
    if (t >= WHITE_SKIP) return null
    return [r + t * (255 - r), g + t * (255 - g), b + t * (255 - b)]
  }
  if (k < DARK_SKIP) return null
  const s = k >= FULL_SHADE ? 1 : Math.round(k / SHADE_STEP) * SHADE_STEP
  return [r * s, g * s, b * s]
}

/**
 * A lot recoloured `rgb` as vector shapes: one { fill, d } per flat colour, the
 * path in canvas pixels (`width` wide) — rectangles, runs merged row to row.
 * Plain filled paths, so every SVG reader draws them, flutter_svg included.
 */
export function lotShapes(region, width, rgb) {
  const byFill = new Map()
  const { pixels, shades } = region
  for (let n = 0; n < pixels.length; n += 1) {
    const color = shadeColor(rgb, shades[n])
    if (!color) continue
    const fill = hex(color)
    if (!byFill.has(fill)) byFill.set(fill, [])
    byFill.get(fill).push(pixels[n])
  }
  return [...byFill].map(([fill, list]) => {
    const { x0, y0, x1, y1 } = boundsOf({ pixels: list }, width)
    const w = x1 - x0
    const mask = new Uint8Array(w * (y1 - y0))
    for (const i of list) mask[(((i / width) | 0) - y0) * w + (i % width) - x0] = 1
    return { fill, d: maskPath({ x0, y0, w, h: y1 - y0, mask }) }
  })
}

/**
 * Recolour lots in an SVG map, keeping it a vector the Flutter app can draw.
 *
 * `width` × `height` is the canvas the regions were found on. Each of `lots` is
 * { region, rgb, fill, ring }: a region from lotRecolor, the new colour, the
 * lot's colour as it appears on the map, and — for a circled lot, which keeps
 * its colour — the ring drawn over it ({ cx, cy, r, strokeWidth }, see lotRing).
 *
 * A lot drawn as its own shape has that shape's fill changed. Any other lot
 * (one shape covers many lots, or the SVG wraps a picture) gets its new colour
 * as filled paths over the map (see lotShapes), traced around its lettering
 * and lines so they show through. No filters, masks, or <use> — flutter_svg
 * does not draw those.
 *
 * Returns { text, shapes, drawn } — the new markup, and how many lots went
 * each way.
 */
export function recolorSvg(text, { width, height, lots: painted }) {
  // A lot painted more than once takes its last colour only.
  const lots = []
  for (const lot of [...painted].reverse()) {
    if (!lots.some((kept) => regionContains(kept.region, lot.region.seed))) lots.unshift(lot)
  }
  const doc = parse(text)
  const root = doc.documentElement
  ensureViewBox(root)
  upgradeLegacyMarks(root)

  // Hit-testing needs it rendered: off screen, at the canvas size, so one
  // viewport unit is one canvas pixel.
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none'
  const live = document.importNode(root, true)
  live.setAttribute('width', String(width))
  live.setAttribute('height', String(height))
  host.appendChild(live)
  document.body.appendChild(host)

  try {
    // Same order in both copies, so an index found on the live one names the stored one.
    const drawn = (svg) =>
      [...svg.querySelectorAll(SHAPES)].filter((el) => !el.closest(OUTSIDE_DRAWING) && !el.closest(`[${COLORS_ATTR}]`)).reverse()
    const candidates = drawn(live) // topmost first
    const originals = drawn(root)
    const hostBox = live.getBoundingClientRect()
    const scale = hostBox.width / width || 1
    const toUser = matrixAttr(canvasToUser(live, root, width, height))

    // Lots coloured on an earlier save, each marked with the pixel it was found from.
    const earlier = [...root.querySelectorAll(`[${COLORS_ATTR}] > [${LOT_ATTR}]`)]
    let layer = root.querySelector(`:scope > g[${COLORS_ATTR}]`)
    let shapes = 0
    let paths = 0

    for (const { region, rgb, fill, ring } of lots) {
      // The map as seen already shows an earlier save's colour here: that one gives way.
      for (const group of earlier) {
        if (!group.parentNode) continue
        const [x, y] = (group.getAttribute('data-seed') ?? '').split(',').map(Number)
        // The seed is in the pixels of the copy it was found on, which may have been drawn at another size.
        const [w0, h0] = (group.getAttribute('data-canvas') ?? '').split('x').map(Number)
        if (!w0 || !h0) continue
        const cx = Math.min(width - 1, Math.round(((x + 0.5) * width) / w0 - 0.5))
        const cy = Math.min(height - 1, Math.round(((y + 0.5) * height) / h0 - 0.5))
        if (regionContains(region, cy * width + cx)) group.remove()
      }

      // A circled lot keeps its colour and gets a red ring drawn over it.
      if (ring) {
        if (!layer) {
          layer = doc.createElementNS(SVG_NS, 'g')
          layer.setAttribute(COLORS_ATTR, '')
        }
        const group = doc.createElementNS(SVG_NS, 'g')
        group.setAttribute(LOT_ATTR, '')
        group.setAttribute('transform', toUser)
        group.setAttribute('data-seed', `${region.seed % width},${(region.seed / width) | 0}`)
        group.setAttribute('data-canvas', `${width}x${height}`)
        // Worked out by the painter, with the ring's thickness and where it was dragged to.
        const { cx, cy, r, strokeWidth } = ring
        const circle = doc.createElementNS(SVG_NS, 'circle')
        circle.setAttribute('cx', String(+cx.toFixed(2)))
        circle.setAttribute('cy', String(+cy.toFixed(2)))
        circle.setAttribute('r', String(+r.toFixed(2)))
        circle.setAttribute('fill', 'none')
        circle.setAttribute('stroke', LOT_RING_COLOR)
        circle.setAttribute('stroke-width', String(+strokeWidth.toFixed(2)))
        group.appendChild(circle)
        layer.appendChild(group)
        paths += 1
        continue
      }

      const bounds = boundsOf(region, width)
      const point = live.createSVGPoint()
      point.x = (region.seed % width) + 0.5
      point.y = ((region.seed / width) | 0) + 0.5
      const pad = Math.max(6, 0.05 * Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0))

      const index = candidates.findIndex((el) => {
        if (!close(rgbOf(getComputedStyle(el).fill), fill, FILL_MATCH)) return false
        const matrix = el.getCTM()
        if (!matrix || typeof el.isPointInFill !== 'function') return false
        if (!el.isPointInFill(point.matrixTransform(matrix.inverse()))) return false
        // A shape reaching well past the lot is shared with its neighbours.
        const box = el.getBoundingClientRect()
        return (
          (box.left - hostBox.left) / scale >= bounds.x0 - pad &&
          (box.top - hostBox.top) / scale >= bounds.y0 - pad &&
          (box.right - hostBox.left) / scale <= bounds.x1 + pad &&
          (box.bottom - hostBox.top) / scale <= bounds.y1 + pad
        )
      })

      if (index >= 0) {
        // The attribute is what flutter_svg reads; the inline style wins over any class fill in a browser.
        for (const el of [originals[index], candidates[index]]) {
          el.setAttribute('fill', hex(rgb))
          el.style.fill = hex(rgb)
        }
        shapes += 1
        continue
      }

      if (!layer) {
        layer = doc.createElementNS(SVG_NS, 'g')
        layer.setAttribute(COLORS_ATTR, '')
      }
      const group = doc.createElementNS(SVG_NS, 'g')
      group.setAttribute(LOT_ATTR, '')
      group.setAttribute('transform', toUser)
      group.setAttribute('data-seed', `${region.seed % width},${(region.seed / width) | 0}`)
      group.setAttribute('data-canvas', `${width}x${height}`)
      for (const shape of lotShapes(region, width, rgb)) {
        const path = doc.createElementNS(SVG_NS, 'path')
        path.setAttribute('fill', shape.fill)
        path.setAttribute('d', shape.d)
        group.appendChild(path)
      }
      layer.appendChild(group)
      paths += 1
    }

    if (layer) {
      if (layer.childNodes.length) root.appendChild(layer) // always last, so on top
      else layer.remove()
    }
    return { text: serialize(doc), shapes, drawn: paths }
  } finally {
    host.remove()
  }
}

/** Canvas pixels → the SVG's own units, as an SVG matrix, measured on the live copy at canvas size. */
function canvasToUser(live, root, width, height) {
  const probe = document.createElementNS(SVG_NS, 'g')
  live.appendChild(probe)
  const m = probe.getCTM()?.inverse()
  probe.remove()
  if (m) return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }
  const [boxX, boxY, boxWidth, boxHeight] = ensureViewBox(root)
  return { a: boxWidth / width, b: 0, c: 0, d: boxHeight / height, e: boxX, f: boxY }
}
const matrixAttr = (m) => `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`

/**
 * feColorMatrix values taking `base` to `next`: each pixel becomes the new
 * colour times its brightness against the old fill — k = 1 on the fill, 0 on
 * black text, in between on soft edges — the same rule lotRecolor paints by.
 *
 * Its opacity is how much of the old colour's tint the pixel carries: 1 on the
 * fill, 0 on anything white, grey, or black. So only the lot's own colour
 * changes — text and border lines show through as drawn, and should the clip
 * touch the road or a white margin, those stay white rather than turning into
 * the new colour.
 */
export function recolorMatrix(base, next) {
  const o = base.map((v) => v / 255)
  const n = next.map((v) => v / 255)
  const norm = o[0] ** 2 + o[1] ** 2 + o[2] ** 2 || 1
  const rows = n.map((c) => [(c * o[0]) / norm, (c * o[1]) / norm, (c * o[2]) / norm, 0, 0])
  // The fill's tint: its colour less its own grey. Zero for any grey, 1 on the fill.
  const mean = (o[0] + o[1] + o[2]) / 3
  const tint = o.map((v) => v - mean)
  const strength = tint[0] ** 2 + tint[1] ** 2 + tint[2] ** 2
  // A grey lot has no tint to go by, so every pixel in its clip is recoloured.
  const alpha = strength > 1e-4 ? [...tint.map((v) => v / strength), 0, 0] : [0, 0, 0, 1, 0]
  return [...rows.flat(), ...alpha].map((v) => +v.toFixed(6)).join(' ')
}

/** The red of the ring a circled lot (ERHD's Sold) is marked with. */
export const LOT_RING_COLOR = '#E11D1D'

/** How thick a ring can be set, as a multiple of its default thickness. */
export const RING_THICKNESS_MIN = 0.5
export const RING_THICKNESS_MAX = 3

/**
 * A ring's centre `[cx, cy]` kept inside its lot's `bounds`: the whole ring
 * stays within the lot along each side it fits, and sits in the middle along
 * one too short for it to move.
 */
export function clampRingCenter([cx, cy], r, { x0, y0, x1, y1 }) {
  const clamp = (value, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, value)))
  return [clamp(cx, x0 + r, x1 - r), clamp(cy, y0 + r, y1 - r)]
}

/**
 * The ring marking a circled lot, in canvas pixels: just inside the lot's
 * shorter side, so it rings the lot number and area as the printed maps do.
 * It is centred on the lot's own fill, moved by `offset` (canvas pixels) when it
 * has been dragged — never out of the lot — and `thickness` times as thick as
 * the default. `bounds` is the lot's box, which the ring is kept inside.
 */
export function lotRing(region, width, { thickness = 1, offset = null } = {}) {
  const bounds = boundsOf({ pixels: region.fill ?? region.pixels }, width)
  const { x0, y0, x1, y1 } = bounds
  const r = 0.44 * Math.min(x1 - x0, y1 - y0)
  const [cx, cy] = clampRingCenter([(x0 + x1) / 2 + (offset?.[0] ?? 0), (y0 + y1) / 2 + (offset?.[1] ?? 0)], r, bounds)
  return { cx, cy, r, strokeWidth: Math.max(2.5, r * 0.14) * thickness, bounds }
}

function boundsOf(region, width) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const i of region.pixels) {
    const x = i % width
    const y = (i / width) | 0
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/**
 * The area a lot's recolour is clipped to, at canvas resolution: never past its
 * own border line. It is the lot's flooded fill, every hole in it (the
 * lettering, whole), and the edge pixels sharing a side with the fill — the
 * inside edge of the border line. The fill was flooded side-to-side, so a pixel
 * sharing a side with it cannot lie across a line; the pixels beyond the line,
 * even of the same colour, are left out, and a neighbouring lot or the road is
 * never tinted.
 *
 * Returns { x0, y0, w, h, mask } — mask is 1 inside, row by row.
 */
export function lotMask(region, width, height) {
  const bounds = boundsOf(region, width)
  const pad = 1
  const x0 = Math.max(0, bounds.x0 - pad)
  const y0 = Math.max(0, bounds.y0 - pad)
  const w = Math.min(width, bounds.x1 + pad) - x0
  const h = Math.min(height, bounds.y1 + pad) - y0
  const mask = new Uint8Array(w * h)
  const cell = (i) => (((i / width) | 0) - y0) * w + (i % width) - x0
  // Older regions carry no separate fill; their pixels stand in for it.
  for (const i of region.fill ?? region.pixels) mask[cell(i)] = 1
  // The border line's soft inside edge: region pixels sharing a side with the fill.
  const edge = []
  region.pixels.forEach((i) => {
    const c = cell(i)
    const x = c % w
    if ((x > 0 && mask[c - 1] === 1) || (x < w - 1 && mask[c + 1] === 1) || mask[c - w] === 1 || mask[c + w] === 1) edge.push(c)
  })
  for (const c of edge) mask[c] = 1

  // Holes: anything the border of the box cannot reach without crossing the lot.
  const OUT = 2
  const queue = []
  const reach = (c) => {
    if (mask[c] === 0) {
      mask[c] = OUT
      queue.push(c)
    }
  }
  for (let x = 0; x < w; x += 1) { reach(x); reach((h - 1) * w + x) }
  for (let y = 0; y < h; y += 1) { reach(y * w); reach(y * w + w - 1) }
  for (let head = 0; head < queue.length; head += 1) {
    const c = queue[head]
    const x = c % w
    if (x > 0) reach(c - 1)
    if (x < w - 1) reach(c + 1)
    if (c >= w) reach(c - w)
    if (c < (h - 1) * w) reach(c + w)
  }
  for (let c = 0; c < mask.length; c += 1) mask[c] = mask[c] === OUT ? 0 : 1
  return { x0, y0, w, h, mask }
}

/**
 * A mask as one path of rectangles, in canvas pixels: each row's runs, with
 * identical runs on consecutive rows merged.
 */
export function maskPath({ x0, y0, w, h, mask }) {
  const parts = []
  const flush = (key, top, bottom) => {
    const [a, b] = key.split(',').map(Number)
    parts.push(`M${x0 + a} ${y0 + top}h${b - a}v${bottom - top}h${a - b}z`)
  }
  let open = new Map() // "a,b" → first row of the rectangle still growing
  for (let y = 0; y <= h; y += 1) {
    const keys = new Set()
    if (y < h) {
      let start = -1
      for (let x = 0; x <= w; x += 1) {
        const inside = x < w && mask[y * w + x] === 1
        if (inside && start < 0) start = x
        if (!inside && start >= 0) {
          keys.add(`${start},${x}`)
          start = -1
        }
      }
    }
    const next = new Map()
    for (const [key, top] of open) {
      if (keys.has(key)) next.set(key, top)
      else flush(key, top, y)
    }
    for (const key of keys) if (!next.has(key)) next.set(key, y)
    open = next
  }
  return parts.join('')
}
