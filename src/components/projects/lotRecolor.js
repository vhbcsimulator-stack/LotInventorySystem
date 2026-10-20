/*
 * Recolouring lots on a flat map image without touching anything drawn on them.
 *
 * A lot on these maps is a flat fill (pale yellow, blue, green…) with black text,
 * dark border lines, and tree icons drawn over it. A lot is found either from its
 * annotated outline or from a click, by flooding the pixels that share its fill
 * colour, then picking up the text enclosed by that fill and the one-pixel
 * anti-aliased edge around it. Every one of those pixels is re-expressed as "the
 * old fill times a brightness factor k" — k = 1 for the fill itself, k ≈ 0 for
 * black text, in between for the soft edges of letters — and repainted as the
 * new colour times the same k. Text therefore stays black and crisp, and anything
 * that is not a darker shade of the fill (grey border lines, trees, red labels)
 * is left exactly as it was.
 */

/** RGB distance still counted as the lot's own fill (absorbs JPEG noise). */
const FILL_TOLERANCE = 42
/** How far a text or edge pixel may stray from "a darker shade of the fill". */
const SHADE_TOLERANCE = 22

/**
 * The tolerance a user can set scales FILL_TOLERANCE: 1 is the default, below
 * it only colours very close to the fill count as the lot, above it faded,
 * noisy, or unevenly printed fills are taken in whole. SHADE_TOLERANCE stays
 * put — loosening it only lets thin grey border lines pass for "a darker shade
 * of the fill" and be repainted.
 */
export const TOLERANCE_DEFAULT = 1
export const TOLERANCE_MIN = 0.5
export const TOLERANCE_MAX = 2
/** A click that floods more than this share of the picture is not inside a lot. */
const MAX_REGION_SHARE = 0.15
/** Fewer pixels than this is a speck (a letter's inside, a line), not a lot. */
const MIN_REGION_PIXELS = 150
/** How far from the click to look for fill when the click lands on text. */
const SEED_SEARCH_RADIUS = 14
/**
 * How far past an annotated outline a lot's own fill may still be picked up:
 * never less than POLYGON_PAD pixels, and otherwise POLYGON_REACH of the lot's
 * size (its area over its perimeter — a quarter of the side of a square lot),
 * scaled by the tolerance. Annotations are often drawn well inside the printed
 * lines; a fixed few pixels left a strip of the old colour along the border.
 * The flood itself still stops at the border line, since it only follows the
 * lot's own colour; the reach only bounds a leak through a gap in a line.
 */
const POLYGON_PAD = 4
const POLYGON_REACH = 1
/**
 * How far past a lot a cut-off patch of its colour (inside outlined lettering)
 * may sit and still be counted as the lot's, and how far to look for which lot
 * it is nearer.
 */
const ISLAND_REACH = 8
/** A cut-off patch larger than this share of the lot is a lot of its own, not lettering. */
const ISLAND_MAX_SHARE = 0.2
/**
 * A region's shade is normally k, the brightness factor against the fill. A
 * value of WHITE_BLEND + t instead marks a pixel fading from the fill into
 * white by t — the soft edge of white lettering.
 */
export const WHITE_BLEND = 2

export function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
}

export const rgbToHex = (rgb) => `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`

/**
 * The colour at (px, py) of an image ({ data, width, height }), as a hex string:
 * the per-channel median of the square `radius` pixels around it, so a click on
 * a legend swatch reads its fill even across JPEG noise or a stray letter edge.
 * Null when the point is off the image.
 */
export function sampleColor({ data, width, height }, px, py, radius = 3) {
  const cx = Math.round(px)
  const cy = Math.round(py)
  if (cx < 0 || cy < 0 || cx >= width || cy >= height) return null
  const channels = [[], [], []]
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x += 1) {
      const o = (y * width + x) * 4
      for (let c = 0; c < 3; c += 1) channels[c].push(data[o + c])
    }
  }
  return rgbToHex(channels.map((values) => values.sort((a, b) => a - b)[values.length >> 1]))
}

const luminance = (data, o) => 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
/** A colour bucket (16 levels per channel), for finding a lot's commonest colour. */
const bucket = (data, o) => ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4)

/**
 * A pixel's shade against the fill [br, bg, bb]: the brightness factor k that
 * makes it "the fill times k", or WHITE_BLEND + t for the fill fading into
 * white by t. With `strict`, a pixel that is neither (a grey line, a tree, red
 * lettering) is not a shade of the fill at all, and null is returned.
 */
function shadeOf(data, o, [br, bg, bb], strict) {
  const r = data[o]
  const g = data[o + 1]
  const b = data[o + 2]
  const fillNorm = br * br + bg * bg + bb * bb || 1
  const k = Math.min(1.15, Math.max(0, (r * br + g * bg + b * bb) / fillNorm))
  if (!strict) return k
  const er = r - k * br
  const eg = g - k * bg
  const eb = b - k * bb
  const shadeTol2 = SHADE_TOLERANCE * SHADE_TOLERANCE
  if (er * er + eg * eg + eb * eb <= shadeTol2) return k
  // Not a darker shade — perhaps the fill fading into white text.
  const [wr, wg, wb] = [255 - br, 255 - bg, 255 - bb]
  const whiteNorm = wr * wr + wg * wg + wb * wb
  if (!whiteNorm) return null
  const t = Math.min(1, Math.max(0, ((r - br) * wr + (g - bg) * wg + (b - bb) * wb) / whiteNorm))
  const fr = r - (br + t * wr)
  const fg = g - (bg + t * wg)
  const fb = b - (bb + t * wb)
  return fr * fr + fg * fg + fb * fb > shadeTol2 ? null : WHITE_BLEND + t
}

/**
 * `rings` ([[x, y], …] lists) scanline-filled, even-odd, at pixel centres, over
 * the box x0, y0, bw × bh: a mask of 1 inside, row by row.
 */
function rasterizeRings(rings, x0, y0, bw, bh) {
  const inner = new Uint8Array(bw * bh)
  for (let r = 0; r < bh; r += 1) {
    const yc = y0 + r + 0.5
    const crossings = []
    for (const ring of rings) {
      for (let n = 0; n < ring.length; n += 1) {
        const [ax, ay] = ring[n]
        const [bx, by] = ring[(n + 1) % ring.length]
        if (ay <= yc !== by <= yc) crossings.push(ax + ((yc - ay) * (bx - ax)) / (by - ay))
      }
    }
    crossings.sort((a, b) => a - b)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5 - x0))
      const to = Math.min(bw - 1, Math.floor(crossings[k + 1] - 0.5 - x0))
      for (let c = from; c <= to; c += 1) inner[r * bw + c] = 1
    }
  }
  return inner
}

/**
 * Builds a region finder for one image ({ data, width, height }, as from
 * getImageData). It keeps scratch buffers between calls, so finding every lot
 * on a large map costs no large allocations after the first.
 *
 * Returns { at(fx, fy, { tolerance }), bucket(rings, { tolerance }),
 * inPolygon(rings, { tolerance }), inPolygonExact(rings, { tolerance }) }, the
 * tolerance defaulting to TOLERANCE_DEFAULT. Each resolves the lot as
 * { seed, pixels: Int32Array (sorted), shades: Float32Array } — the pixel
 * indices to repaint and each one's brightness factor k — or null when there is
 * no flat-coloured lot there.
 */
export function createRegionFinder(image, { scale = 1 } = {}) {
  const { data, width, height } = image
  // Pixel distances are set for a map drawn at its annotations' size; a sharper
  // copy drawn `scale` times larger needs them that much larger too.
  const seedRadius = Math.round(SEED_SEARCH_RADIUS * scale)
  const minRegionPixels = Math.round(MIN_REGION_PIXELS * scale * scale)
  const polygonPad = Math.round(POLYGON_PAD * scale)
  const islandReach = Math.round(ISLAND_REACH * scale)
  const total = width * height
  // Stamps rather than booleans, so the buffer never has to be cleared.
  const stamp = new Uint32Array(total)
  let generation = 0

  /** The nearest light pixel to the click, so a click on a letter still works. */
  function seedNear(px, py) {
    for (let r = 0; r <= seedRadius; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = px + dx
          const y = py + dy
          if (x < 0 || y < 0 || x >= width || y >= height) continue
          const i = y * width + x
          if (luminance(data, i * 4) >= 110) return i
        }
      }
    }
    return -1
  }

  function grow(seeds, [br, bg, bb], { allowed = null, limit = Infinity, minPixels = minRegionPixels, tolerance = TOLERANCE_DEFAULT } = {}) {
    generation += 1
    const FILL = generation * 4 + 1
    const OUTSIDE = generation * 4 + 2
    const EDGE = generation * 4 + 3

    const fillTol2 = (FILL_TOLERANCE * tolerance) ** 2
    const isFill = (i) => {
      const o = i * 4
      const dr = data[o] - br
      const dg = data[o + 1] - bg
      const db = data[o + 2] - bb
      return dr * dr + dg * dg + db * db <= fillTol2
    }
    const take = (i) => stamp[i] !== FILL && (!allowed || allowed(i)) && isFill(i)

    // 1. Flood the lot's fill colour (4-connected, so thin lines stop it).
    const fill = []
    for (const seed of seeds) {
      if (stamp[seed] === FILL) continue
      stamp[seed] = FILL
      fill.push(seed)
    }
    if (!fill.length) return null
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    for (let head = 0; head < fill.length; head += 1) {
      if (fill.length > limit) return null
      const i = fill[head]
      const x = i % width
      const y = (i / width) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && take(i - 1)) { stamp[i - 1] = FILL; fill.push(i - 1) }
      if (x < width - 1 && take(i + 1)) { stamp[i + 1] = FILL; fill.push(i + 1) }
      if (y > 0 && take(i - width)) { stamp[i - width] = FILL; fill.push(i - width) }
      if (y < height - 1 && take(i + width)) { stamp[i + width] = FILL; fill.push(i + width) }
    }
    if (fill.length < minPixels) return null

    const mainSize = fill.length
    const bx0 = Math.max(0, minX - islandReach)
    const bx1 = Math.min(width - 1, maxX + islandReach)
    const by0 = Math.max(0, minY - islandReach)
    const by1 = Math.min(height - 1, maxY + islandReach)
    const bw = bx1 - bx0 + 1
    const bh = by1 - by0 + 1
    const OURS = -1
    const FOREIGN = -2
    const label = new Int32Array(bw * bh) // 0 unseen, OURS, FOREIGN, or an island's number
    const cellOf = (i) => (((i / width) | 0) - by0) * bw + (i % width) - bx0
    const pixelOf = (c) => (by0 + ((c / bw) | 0)) * width + bx0 + (c % bw)
    for (const i of fill) label[cellOf(i)] = OURS
    const islands = []
    for (let c = 0; c < label.length; c += 1) {
      if (label[c] !== 0 || !isFill(pixelOf(c))) continue
      const id = islands.length + 1
      const members = [c]
      let touchesEdge = false
      label[c] = id
      for (let head = 0; head < members.length; head += 1) {
        const m = members[head]
        const mx = m % bw
        const my = (m / bw) | 0
        if (mx === 0 || my === 0 || mx === bw - 1 || my === bh - 1) touchesEdge = true
        for (const n of [mx > 0 ? m - 1 : -1, mx < bw - 1 ? m + 1 : -1, my > 0 ? m - bw : -1, my < bh - 1 ? m + bw : -1]) {
          if (n < 0 || label[n] !== 0 || !isFill(pixelOf(n))) continue
          label[n] = id
          members.push(n)
        }
      }
      // Running on past the box, or as big as a lot of its own: a neighbouring lot.
      if (touchesEdge || members.length > mainSize * ISLAND_MAX_SHARE) for (const m of members) label[m] = FOREIGN
      else islands.push({ id, members })
    }
    if (islands.length) {
      const seen = new Int32Array(bw * bh)
      for (const { id, members } of islands) {
        // Grow outward ring by ring until this lot or another one is met.
        let ring = members
        for (const m of members) seen[m] = id
        let verdict = 0 // 1 ours, -1 another lot's, 0 undecided
        for (let step = 0; step < islandReach && !verdict && ring.length; step += 1) {
          const next = []
          let ours = 0
          let theirs = 0
          for (const m of ring) {
            const mx = m % bw
            const my = (m / bw) | 0
            for (let dy = -1; dy <= 1; dy += 1) {
              for (let dx = -1; dx <= 1; dx += 1) {
                const nx = mx + dx
                const ny = my + dy
                if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
                const n = ny * bw + nx
                if (seen[n] === id) continue
                seen[n] = id
                if (label[n] === OURS) ours += 1
                else if (label[n] === FOREIGN) theirs += 1
                next.push(n)
              }
            }
          }
          /*
           * The first lot met decides. Met both at the same distance — a letter's
           * corner against a thin border line, say — it goes with the one it
           * touches along more of its edge; an even split is left alone.
           */
          if (ours || theirs) verdict = ours > theirs ? 1 : -1
          ring = next
        }
        if (verdict !== 1) continue
        for (const m of members) {
          const i = pixelOf(m)
          stamp[i] = FILL
          fill.push(i)
          const x = i % width
          const y = (i / width) | 0
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    // 2. Whatever the fill fully encloses (the lot's text) — everything in the
    //    bounding box that cannot reach its border without crossing the fill.
    const x0 = Math.max(0, minX - 1)
    const x1 = Math.min(width - 1, maxX + 1)
    const y0 = Math.max(0, minY - 1)
    const y1 = Math.min(height - 1, maxY + 1)
    const outside = []
    const reach = (x, y) => {
      const i = y * width + x
      if (stamp[i] === FILL || stamp[i] === OUTSIDE) return
      stamp[i] = OUTSIDE
      outside.push(i)
    }
    for (let x = x0; x <= x1; x += 1) { reach(x, y0); reach(x, y1) }
    for (let y = y0; y <= y1; y += 1) { reach(x0, y); reach(x1, y) }
    for (let head = 0; head < outside.length; head += 1) {
      const i = outside[head]
      const x = i % width
      const y = (i / width) | 0
      if (x > x0) reach(x - 1, y)
      if (x < x1) reach(x + 1, y)
      if (y > y0) reach(x, y - 1)
      if (y < y1) reach(x, y + 1)
    }
    const candidates = []
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const i = y * width + x
        if (stamp[i] !== FILL && stamp[i] !== OUTSIDE) {
          stamp[i] = EDGE
          candidates.push(i)
        }
      }
    }

    // 3. The anti-aliased pixel ring where the fill meets a border line.
    for (const i of fill) {
      const x = i % width
      const y = (i / width) | 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const n = ny * width + nx
          if (stamp[n] === FILL || stamp[n] === EDGE) continue
          stamp[n] = EDGE
          candidates.push(n)
        }
      }
    }

    // 4. Brightness factor k of each pixel against the fill. Fill pixels always
    //    repaint; text and edge pixels only when they really are a shade of it.
    const pixels = []
    const shades = []
    const add = (i, strict) => {
      const k = shadeOf(data, i * 4, [br, bg, bb], strict)
      if (k === null) return
      pixels.push(i)
      shades.push(k)
    }
    for (const i of fill) add(i, false)
    for (const i of candidates) add(i, true)

    // Sorted, so `regionContains` can binary-search it.
    const order = pixels.map((_, index) => index).sort((a, b) => pixels[a] - pixels[b])
    return {
      seed: fill[0],
      pixels: Int32Array.from(order, (index) => pixels[index]),
      shades: Float32Array.from(order, (index) => shades[index]),
      // The flooded fill alone — the lot's own area, without the text and edge
      // picked up around it. An SVG recolour clips to this (see svgMaps).
      fill: Int32Array.from(fill).sort(),
    }
  }

  /** The lot under (fx, fy), given as fractions of the image size. */
  function at(fx, fy, { tolerance = TOLERANCE_DEFAULT } = {}) {
    const px = Math.round(fx * (width - 1))
    const py = Math.round(fy * (height - 1))
    if (px < 0 || py < 0 || px >= width || py >= height) return null
    const seed = seedNear(px, py)
    if (seed < 0) return null
    const o = seed * 4
    return grow([seed], [data[o], data[o + 1], data[o + 2]], { limit: total * MAX_REGION_SHARE, tolerance })
  }

  /**
   * The lot an annotation outlines — `rings` as [[x, y], …] lists in this
   * image's pixels. Its fill is the commonest light colour inside the outline;
   * the flood may run past it by the polygon reach (see POLYGON_REACH), since
   * hand-drawn outlines rarely sit exactly on the printed lot lines.
   */
  function inPolygon(rings, { tolerance = TOLERANCE_DEFAULT, bounded = true } = {}) {
    const points = rings.flat()
    if (points.length < 3) return null
    let area = 0
    let perimeter = 0
    for (const ring of rings) {
      let ringArea = 0
      for (let n = 0; n < ring.length; n += 1) {
        const [ax, ay] = ring[n]
        const [bx, by] = ring[(n + 1) % ring.length]
        ringArea += ax * by - bx * ay
        perimeter += Math.hypot(bx - ax, by - ay)
      }
      area += Math.abs(ringArea) / 2
    }
    const pad = Math.max(polygonPad, Math.round((POLYGON_REACH * tolerance * area) / (perimeter || 1)))
    const xs0 = points.map(([x]) => x)
    const ys0 = points.map(([, y]) => y)
    const x0 = Math.max(0, Math.floor(Math.min(...xs0)) - pad)
    const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs0)) + pad)
    const y0 = Math.max(0, Math.floor(Math.min(...ys0)) - pad)
    const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys0)) + pad)
    if (x1 < x0 || y1 < y0) return null
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1

    // The outline itself, scanline-filled (even-odd) at pixel centres.
    const inner = rasterizeRings(rings, x0, y0, bw, bh)

    // The outline grown by `pad` — a square dilation, as two one-way passes per axis.
    const dilate = (source, lines, length, index) => {
      const out = new Uint8Array(bw * bh)
      for (let line = 0; line < lines; line += 1) {
        let last = -Infinity
        for (let n = 0; n < length; n += 1) {
          if (source[index(line, n)]) last = n
          if (n - last <= pad) out[index(line, n)] = 1
        }
        last = Infinity
        for (let n = length - 1; n >= 0; n -= 1) {
          if (source[index(line, n)]) last = n
          if (last - n <= pad) out[index(line, n)] = 1
        }
      }
      return out
    }
    const across = dilate(inner, bh, bw, (r, c) => r * bw + c)
    const outer = dilate(across, bw, bh, (c, r) => r * bw + c)

    // The lot's fill: the commonest light colour inside the outline.
    const counts = new Map()
    for (let r = 0; r < bh; r += 1) {
      for (let c = 0; c < bw; c += 1) {
        if (!inner[r * bw + c]) continue
        const o = ((y0 + r) * width + x0 + c) * 4
        if (luminance(data, o) < 110) continue
        const key = bucket(data, o)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    if (!counts.size) return null
    const mode = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]

    /*
     * Seed from the largest connected patch of that colour inside the outline
     * only. An outline that overshoots a border line takes in a strip of the
     * neighbouring lot, which is often the very same colour — seeding there too
     * would repaint that strip of the neighbour.
     */
    const isMode = (r, c) => inner[r * bw + c] === 1 && bucket(data, ((y0 + r) * width + x0 + c) * 4) === mode
    const patch = new Int32Array(bw * bh)
    let seeds = []
    let label = 0
    for (let r = 0; r < bh; r += 1) {
      for (let c = 0; c < bw; c += 1) {
        if (patch[r * bw + c] || !isMode(r, c)) continue
        label += 1
        patch[r * bw + c] = label
        const members = [r * bw + c]
        for (let head = 0; head < members.length; head += 1) {
          const cell = members[head]
          const mr = (cell / bw) | 0
          const mc = cell % bw
          for (const [nr, nc] of [[mr - 1, mc], [mr + 1, mc], [mr, mc - 1], [mr, mc + 1]]) {
            if (nr < 0 || nc < 0 || nr >= bh || nc >= bw || patch[nr * bw + nc] || !isMode(nr, nc)) continue
            patch[nr * bw + nc] = label
            members.push(nr * bw + nc)
          }
        }
        if (members.length > seeds.length) seeds = members
      }
    }
    seeds = seeds.map((cell) => (y0 + ((cell / bw) | 0)) * width + x0 + (cell % bw))
    const sum = [0, 0, 0]
    for (const i of seeds) {
      sum[0] += data[i * 4]
      sum[1] += data[i * 4 + 1]
      sum[2] += data[i * 4 + 2]
    }
    const color = sum.map((value) => value / seeds.length)

    /*
     * Unbounded, like a paint bucket: the flood runs through every pixel of the
     * lot's colour joined to it, however far past the outline, and stops only at
     * the printed lines. One that leaks out over the map (a gap in a line onto a
     * background of the same colour) falls back to the outline's reach.
     */
    if (!bounded) {
      const flooded = grow(seeds, color, { limit: total * MAX_REGION_SHARE, minPixels: 1, tolerance })
      if (flooded) return flooded
    }
    const allowed = (i) => {
      const c = (i % width) - x0
      const r = ((i / width) | 0) - y0
      return c >= 0 && r >= 0 && c < bw && r < bh && outer[r * bw + c] === 1
    }
    return grow(seeds, color, { allowed, minPixels: 1, tolerance })
  }

  /** The lot an annotation sits in, filled like a paint bucket from inside its outline (see inPolygon). */
  const bucketFill = (rings, { tolerance = TOLERANCE_DEFAULT } = {}) => inPolygon(rings, { tolerance, bounded: false })

  /**
   * The lot exactly as an annotation outlines it: only pixels inside the
   * polygon are touched, however the printed lines run. Its fill is the
   * commonest light colour inside; every pixel near that colour (within the
   * tolerance) is repainted, and text or soft edges only where they really are
   * a shade of it — so lettering stays crisp, and a border line, tree or road
   * crossing the outline is left as it is. Null when the outline holds no
   * light colour to call the lot's fill.
   */
  function inPolygonExact(rings, { tolerance = TOLERANCE_DEFAULT } = {}) {
    const points = rings.flat()
    if (points.length < 3) return null
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    const x0 = Math.max(0, Math.floor(Math.min(...xs)))
    const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)))
    const y0 = Math.max(0, Math.floor(Math.min(...ys)))
    const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)))
    if (x1 < x0 || y1 < y0) return null
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    const inner = rasterizeRings(rings, x0, y0, bw, bh)

    // The fill: the commonest light colour inside, averaged over its pixels.
    const counts = new Map()
    for (let r = 0; r < bh; r += 1) {
      for (let c = 0; c < bw; c += 1) {
        if (!inner[r * bw + c]) continue
        const o = ((y0 + r) * width + x0 + c) * 4
        if (luminance(data, o) < 110) continue
        const key = bucket(data, o)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    if (!counts.size) return null
    const mode = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]
    const sum = [0, 0, 0]
    let n = 0
    for (let r = 0; r < bh; r += 1) {
      for (let c = 0; c < bw; c += 1) {
        if (!inner[r * bw + c]) continue
        const o = ((y0 + r) * width + x0 + c) * 4
        if (bucket(data, o) !== mode) continue
        sum[0] += data[o]
        sum[1] += data[o + 1]
        sum[2] += data[o + 2]
        n += 1
      }
    }
    const color = sum.map((value) => value / n)

    const fillTol2 = (FILL_TOLERANCE * tolerance) ** 2
    const pixels = []
    const shades = []
    const fill = []
    // Row by row inside the box, so `pixels` comes out already sorted.
    for (let r = 0; r < bh; r += 1) {
      for (let c = 0; c < bw; c += 1) {
        if (!inner[r * bw + c]) continue
        const i = (y0 + r) * width + x0 + c
        const o = i * 4
        const dr = data[o] - color[0]
        const dg = data[o + 1] - color[1]
        const db = data[o + 2] - color[2]
        const isFill = dr * dr + dg * dg + db * db <= fillTol2
        const k = shadeOf(data, o, color, !isFill)
        if (k === null) continue
        pixels.push(i)
        shades.push(k)
        if (isFill) fill.push(i)
      }
    }
    if (!fill.length) return null
    return { seed: fill[0], pixels: Int32Array.from(pixels), shades: Float32Array.from(shades), fill: Int32Array.from(fill) }
  }

  return { at, bucket: bucketFill, inPolygon, inPolygonExact }
}

/** A pixel plainly the red of a printed ring: bright red, little green or blue. */
const isRingRed = (r, g, b) => r >= 150 && g <= 110 && b <= 110 && r - Math.max(g, b) >= 80
/** A pixel tinged with that red — the soft edge where a ring blends into the lot or white. */
const isRingFringe = (r, g) => r >= 110 && r - g >= 12
/** Plainly reddish however dark — where a ring runs under black lettering or a border line. */
const isRingDark = (r, g, b) => r >= 50 && r - g >= 30 && r - b >= 30
/** How far past the red its faintly tinged edge is followed. */
const RING_FRINGE_REACH = 2
/**
 * Past that, a halo this wide of anything not dark is filled in too: the last
 * blend of the ring into the lot is too faint to tell by colour, yet leaves a
 * trace of the circle if kept (and would tint the fill taken from it).
 */
const RING_HALO = 2
/** Darker than this, a pixel is lettering or a line, which the halo leaves alone. */
const RING_HALO_DARK = 110
/**
 * Pieces of red this close are one ring: lettering or a border line drawn over
 * a ring cuts it into pieces, which all go with the lot it rings.
 */
const RING_JOIN = 5
/** Lighter than this, a pixel is lot or white — what a ring is filled in from. */
const RING_LIGHT = 150
/**
 * A border line crossing a ring is put back across it: dark on both sides of
 * the ring, within RING_BRIDGE pixels, and running on dark for RING_LINE_RUN
 * pixels more — a line, not a speck of lettering.
 */
const RING_BRIDGE = 24
const RING_LINE_RUN = 6

/**
 * The red rings printed on a map (ERHD marks sold lots so), found once for the
 * whole image ({ data, width, height }) and painted out of it in place: each
 * ring's pixels — the plain red and its tinged edge — are filled in from the
 * colours around them, peeling inward, so the lot under a ring reads as one
 * flat lot again and is found whole, inside the ring and out.
 *
 * Returns null when there is no red, else { comp, components }: per pixel the
 * number of the ring it belongs to (0 for none), and each ring's pixels.
 */
export function findPrintedRings(image, { scale = 1 } = {}) {
  const { data, width, height } = image
  const total = width * height
  const ring = new Uint8Array(total)
  let frontier = []
  for (let i = 0; i < total; i += 1) {
    const o = i * 4
    if (isRingRed(data[o], data[o + 1], data[o + 2])) {
      ring[i] = 1
      frontier.push(i)
    }
  }
  if (!frontier.length) return null
  const neighbours = (i, visit) => {
    const x = i % width
    const y = (i / width) | 0
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) visit(ny * width + nx)
      }
    }
  }

  // Dark red, where the ring meets lettering or lines: followed as far as it runs.
  for (let head = 0; head < frontier.length; head += 1) {
    neighbours(frontier[head], (n) => {
      if (ring[n]) return
      const o = n * 4
      if (!isRingDark(data[o], data[o + 1], data[o + 2])) return
      ring[n] = 1
      frontier.push(n)
    })
  }
  // The faintly tinged edge: pixels joined to the red through more tinged pixels, a step or two out.
  const reach = Math.max(1, Math.round(RING_FRINGE_REACH * scale))
  for (let step = 0; step < reach && frontier.length; step += 1) {
    const next = []
    for (const i of frontier) {
      neighbours(i, (n) => {
        if (ring[n]) return
        const o = n * 4
        if (!isRingFringe(data[o], data[o + 1])) return
        ring[n] = 1
        next.push(n)
      })
    }
    frontier = next
  }
  // The halo: a pixel or two more all round, outside the tinged edge as well as the red.
  frontier = []
  for (let i = 0; i < total; i += 1) if (ring[i]) frontier.push(i)
  const halo = Math.max(1, Math.round(RING_HALO * scale))
  for (let step = 0; step < halo && frontier.length; step += 1) {
    const next = []
    for (const i of frontier) {
      neighbours(i, (n) => {
        if (ring[n] || luminance(data, n * 4) < RING_HALO_DARK) return
        ring[n] = 1
        next.push(n)
      })
    }
    frontier = next
  }

  // Each ring on its own — its pieces joined across lettering — so a lot takes only the rings it touches.
  const join = Math.max(2, Math.round(RING_JOIN * scale))
  const comp = new Int32Array(total)
  const components = []
  for (let i = 0; i < total; i += 1) {
    if (!ring[i] || comp[i]) continue
    const id = components.length + 1
    const members = [i]
    comp[i] = id
    for (let head = 0; head < members.length; head += 1) {
      const m = members[head]
      const mx = m % width
      const my = (m / width) | 0
      for (let ny = Math.max(0, my - join); ny <= Math.min(height - 1, my + join); ny += 1) {
        for (let nx = Math.max(0, mx - join); nx <= Math.min(width - 1, mx + join); nx += 1) {
          const n = ny * width + nx
          if (!ring[n] || comp[n]) continue
          comp[n] = id
          members.push(n)
        }
      }
    }
    components.push(Int32Array.from(members))
  }

  /*
   * Fill in, a layer at a time from the outside: each pixel takes the average
   * of its light neighbours already known, so the lot's colour closes over the
   * ring and lettering or a line beside it is not smeared into it. A pixel with
   * only dark neighbours known waits for the light to reach it.
   */
  const known = new Uint8Array(total)
  for (let i = 0; i < total; i += 1) known[i] = ring[i] ? 0 : 1
  const queued = new Uint8Array(total)
  let layer = []
  for (let i = 0; i < total; i += 1) {
    if (!ring[i]) continue
    let edge = false
    neighbours(i, (n) => {
      if (known[n]) edge = true
    })
    if (edge) {
      queued[i] = 1
      layer.push(i)
    }
  }
  const average = (i, lightOnly) => {
    const sum = [0, 0, 0]
    let count = 0
    neighbours(i, (n) => {
      if (!known[n]) return
      const o = n * 4
      if (lightOnly && luminance(data, o) < RING_LIGHT) return
      sum[0] += data[o]
      sum[1] += data[o + 1]
      sum[2] += data[o + 2]
      count += 1
    })
    return count ? sum.map((value) => value / count) : null
  }
  while (layer.length) {
    let colors = layer.map((i) => average(i, true))
    // Nothing light in reach anywhere (a ring wholly inside dark): take what there is.
    if (colors.every((color) => !color)) colors = layer.map((i) => average(i, false))
    const next = []
    const done = []
    layer.forEach((i, n) => {
      const color = colors[n]
      if (!color) {
        next.push(i)
        return
      }
      data.set(color, i * 4)
      known[i] = 1
      done.push(i)
    })
    for (const i of done) {
      neighbours(i, (n) => {
        if (known[n] || queued[n]) return
        queued[n] = 1
        next.push(n)
      })
    }
    layer = next
  }

  // Border lines the ring crossed, put back straight across it.
  const bridge = Math.round(RING_BRIDGE * scale)
  const lineRun = Math.max(3, Math.round(RING_LINE_RUN * scale))
  const isDark = (i) => !ring[i] && luminance(data, i * 4) < 110
  const endOf = (i, dx, dy) => {
    let x = i % width
    let y = (i / width) | 0
    for (let k = 0; k < bridge; k += 1) {
      x += dx
      y += dy
      if (x < 0 || y < 0 || x >= width || y >= height) return -1
      const p = y * width + x
      if (ring[p]) continue
      if (!isDark(p)) return -1
      for (let m = 1; m <= lineRun; m += 1) {
        const qx = x + m * dx
        const qy = y + m * dy
        if (qx < 0 || qy < 0 || qx >= width || qy >= height || !isDark(qy * width + qx)) return -1
      }
      return p
    }
    return -1
  }
  const bridged = []
  for (const members of components) {
    for (const i of members) {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const a = endOf(i, dx, dy)
        if (a < 0) continue
        const b = endOf(i, -dx, -dy)
        if (b < 0) continue
        bridged.push([i, a, b])
        break
      }
    }
  }
  for (const [i, a, b] of bridged) {
    data.set([0, 1, 2].map((c) => (data[a * 4 + c] + data[b * 4 + c]) / 2), i * 4)
  }
  return { comp, components }
}

/**
 * The printed rings a lot carries: every ring (from findPrintedRings) with a
 * pixel inside `lotBox` (a lotMask — the lot, its lettering, anything it
 * encloses), whole, even where it runs past the lot's border line.
 */
export function ringPixelsIn({ comp, components }, { x0, y0, w, h, mask }, width) {
  const ids = new Set()
  for (let r = 0; r < h; r += 1) {
    for (let c = 0; c < w; c += 1) {
      if (!mask[r * w + c]) continue
      const id = comp[(y0 + r) * width + x0 + c]
      if (id) ids.add(id)
    }
  }
  const out = []
  for (const id of ids) for (const i of components[id - 1]) out.push(i)
  return Int32Array.from(out)
}

/** Where pixel index `i` sits in a region's sorted pixels, or -1. */
export function regionIndexOf(region, i) {
  const { pixels } = region
  let lo = 0
  let hi = pixels.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (pixels[mid] === i) return mid
    if (pixels[mid] < i) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/** Whether pixel index `i` belongs to a region from createRegionFinder. */
export function regionContains(region, i) {
  return regionIndexOf(region, i) >= 0
}

/**
 * Paint `region` into `out` (RGBA bytes) as `rgb` scaled by each pixel's shade,
 * fully opaque — so it also works on a transparent layer over the map. A shade
 * of WHITE_BLEND + t is the new colour faded that far into white.
 */
export function paintRegion(out, region, [r, g, b]) {
  const { pixels, shades } = region
  for (let n = 0; n < pixels.length; n += 1) {
    const o = pixels[n] * 4
    const k = shades[n]
    if (k >= WHITE_BLEND) {
      const t = k - WHITE_BLEND
      out[o] = r + t * (255 - r)
      out[o + 1] = g + t * (255 - g)
      out[o + 2] = b + t * (255 - b)
    } else {
      out[o] = r * k
      out[o + 1] = g * k
      out[o + 2] = b * k
    }
    out[o + 3] = 255
  }
}
