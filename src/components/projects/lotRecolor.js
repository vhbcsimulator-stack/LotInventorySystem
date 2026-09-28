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
 * Returns { at(fx, fy, { tolerance }), inPolygon(rings, { tolerance }),
 * inPolygonExact(rings, { tolerance }) }, the
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

  /**
   * The lot grown from `seeds`, all of fill colour [br, bg, bb]: the fill itself,
   * the text it encloses, and its anti-aliased edge. `allowed(i)` fences the
   * flood in; past `limit` pixels it gives up (the click was not in a lot).
   */
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

    /*
     * 1b. Islands: patches of the lot's own colour cut off from it by lines
     * drawn over the lot — the hollow insides of large outlined lettering, say
     * a "BLK 27" label written across the lot's border. Each is taken in if it
     * lies nearer this lot than any other patch of the same colour that runs on
     * past the search box (a neighbouring lot), so the letters' insides on the
     * far side of the border line stay with the lot there.
     */
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
  function inPolygon(rings, { tolerance = TOLERANCE_DEFAULT } = {}) {
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

    const allowed = (i) => {
      const c = (i % width) - x0
      const r = ((i / width) | 0) - y0
      return c >= 0 && r >= 0 && c < bw && r < bh && outer[r * bw + c] === 1
    }
    return grow(seeds, color, { allowed, minPixels: 1, tolerance })
  }

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

  return { at, inPolygon, inPolygonExact }
}

/** Whether pixel index `i` belongs to a region from createRegionFinder. */
export function regionContains(region, i) {
  const { pixels } = region
  let lo = 0
  let hi = pixels.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (pixels[mid] === i) return true
    if (pixels[mid] < i) lo = mid + 1
    else hi = mid - 1
  }
  return false
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
