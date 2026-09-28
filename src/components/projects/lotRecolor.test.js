import { describe, expect, it } from 'vitest'
import { TOLERANCE_DEFAULT, createRegionFinder, paintRegion, regionContains, sampleColor } from './lotRecolor'

const YELLOW = [250, 247, 166]
const GREY = [90, 90, 90]
const BLACK = [0, 0, 0]
const WOOD = [215, 180, 130]

/**
 * 200×120 picture: wood background, two yellow lots split by a grey border line,
 * and a black "letter" block plus a half-tone (anti-aliased) pixel in lot A.
 */
function makeMap() {
  const width = 200
  const height = 120
  const data = new Uint8ClampedArray(width * height * 4)
  const set = (x, y, [r, g, b]) => {
    const o = (y * width + x) * 4
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    data[o + 3] = 255
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) set(x, y, WOOD)
  for (let y = 5; y < 35; y += 1) {
    for (let x = 5; x < 55; x += 1) set(x, y, x === 30 || y === 5 || y === 34 || x === 5 || x === 54 ? GREY : YELLOW)
  }
  for (let y = 15; y < 20; y += 1) for (let x = 12; x < 18; x += 1) set(x, y, BLACK)
  set(18, 17, YELLOW.map((c) => c * 0.5))
  return { data, width, height }
}

const pixelAt = (image, x, y) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3))

describe('lot recolouring', () => {
  it('repaints only the clicked lot, keeping text black and borders untouched', () => {
    const image = makeMap()
    const region = createRegionFinder(image).at(10 / 199, 25 / 119)
    expect(region).not.toBeNull()

    const out = new Uint8ClampedArray(image.data)
    paintRegion(out, region, [0, 100, 200])
    const painted = { ...image, data: out }

    expect(pixelAt(painted, 8, 25)).toEqual([0, 100, 200]) // fill → new colour
    expect(pixelAt(painted, 14, 17)).toEqual([0, 0, 0]) // text stays black
    expect(pixelAt(painted, 18, 17)).toEqual([0, 50, 100]) // anti-aliased edge keeps its shade
    expect(pixelAt(painted, 30, 20)).toEqual(GREY) // border line untouched
    expect(pixelAt(painted, 40, 20)).toEqual(YELLOW) // neighbouring lot untouched
    expect(pixelAt(painted, 2, 2)).toEqual(WOOD) // background untouched
  })

  it('still finds the lot when the click lands on its text', () => {
    const image = makeMap()
    const region = createRegionFinder(image).at(14 / 199, 17 / 119)
    expect(region).not.toBeNull()
    expect(regionContains(region, 25 * image.width + 8)).toBe(true)
    expect(regionContains(region, 20 * image.width + 40)).toBe(false)
  })

  it('refuses a click outside any lot', () => {
    const image = makeMap()
    // The wood background floods far more than a lot's share of the picture.
    expect(createRegionFinder(image).at(150 / 199, 100 / 119)).toBeNull()
  })

  describe('tolerance', () => {
    /**
     * Lot A with a faded strip along its bottom edge — 60 RGB steps off the fill,
     * past the default reach. It runs to the border line, so it is not enclosed
     * by the fill the way lettering is.
     */
    function fadedMap() {
      const image = makeMap()
      const faded = [YELLOW[0] - 35, YELLOW[1] - 35, YELLOW[2] - 35]
      for (let y = 25; y < 34; y += 1) {
        for (let x = 6; x < 29; x += 1) image.data.set(faded, (y * image.width + x) * 4)
      }
      return image
    }
    const fadedPixel = (image) => 29 * image.width + 10

    it('defaults to what colouring always used', () => {
      const image = makeMap()
      const plain = createRegionFinder(image).at(10 / 199, 10 / 119)
      const explicit = createRegionFinder(image).at(10 / 199, 10 / 119, { tolerance: TOLERANCE_DEFAULT })
      expect(Array.from(explicit.pixels)).toEqual(Array.from(plain.pixels))
    })

    it('leaves a faded strip out at the default, and takes it in when looser', () => {
      const image = fadedMap()
      const normal = createRegionFinder(image).at(10 / 199, 10 / 119)
      const loose = createRegionFinder(image).at(10 / 199, 10 / 119, { tolerance: 2 })
      expect(regionContains(normal, fadedPixel(image))).toBe(false)
      expect(regionContains(loose, fadedPixel(image))).toBe(true)
      // Looser still stops at the border line and the lot next door.
      expect(regionContains(loose, 20 * image.width + 30)).toBe(false)
      expect(regionContains(loose, 20 * image.width + 40)).toBe(false)
    })

    it('still finds the lot when tighter', () => {
      const image = makeMap()
      const tight = createRegionFinder(image).at(10 / 199, 10 / 119, { tolerance: 0.5 })
      expect(regionContains(tight, 25 * image.width + 8)).toBe(true)
    })
  })

  it('takes in its side of an outlined letter drawn across the border line, and only its side', () => {
    const image = makeMap()
    const width = image.width
    // A hollow black box (an outlined letter) straddling the grey line between lots A and B.
    for (let x = 24; x <= 36; x += 1) {
      for (let y = 12; y <= 24; y += 1) {
        if (x === 24 || x === 36 || y === 12 || y === 24) image.data.set([...BLACK, 255], (y * width + x) * 4)
      }
    }
    const region = createRegionFinder(image).at(10 / 199, 28 / 119)
    expect(regionContains(region, 18 * width + 27)).toBe(true) // inside the letter, lot A's side
    expect(regionContains(region, 18 * width + 33)).toBe(false) // inside the letter, lot B's side
    expect(regionContains(region, 20 * width + 40)).toBe(false) // lot B itself

    const out = new Uint8ClampedArray(image.data)
    paintRegion(out, region, [0, 100, 200])
    expect(pixelAt({ ...image, data: out }, 27, 18)).toEqual([0, 100, 200])
    expect(pixelAt({ ...image, data: out }, 33, 18)).toEqual(YELLOW)
  })

  it('keeps white lettering white and recolours its soft edge', () => {
    const image = makeMap()
    const width = image.width
    const WHITE = [255, 255, 255]
    for (let y = 26; y <= 28; y += 1) for (let x = 20; x <= 22; x += 1) image.data.set([...WHITE, 255], (y * width + x) * 4)
    // Half-way between the fill and white: the letter's anti-aliased edge.
    image.data.set([...YELLOW.map((c) => Math.round((c + 255) / 2)), 255], (27 * width + 19) * 4)
    const region = createRegionFinder(image).at(10 / 199, 10 / 119)

    const out = new Uint8ClampedArray(image.data)
    paintRegion(out, region, [0, 100, 200])
    const painted = { ...image, data: out }
    expect(pixelAt(painted, 21, 27)).toEqual(WHITE) // the letter stays white
    const edge = pixelAt(painted, 19, 27) // halfway between the new colour and white
    ;[128, 178, 228].forEach((value, channel) => expect(Math.abs(edge[channel] - value)).toBeLessThanOrEqual(2))
  })

  it('fills the whole lot in one go when its annotation sits well inside the printed lines', () => {
    // One 100×80 lot inside a black border, beside a white road — annotated 12 px in from every line.
    const width = 200
    const height = 120
    const data = new Uint8ClampedArray(width * height * 4)
    const set = (x, y, [r, g, b]) => data.set([r, g, b, 255], (y * width + x) * 4)
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) set(x, y, [255, 255, 255])
    for (let y = 10; y <= 91; y += 1) {
      for (let x = 10; x <= 111; x += 1) set(x, y, x <= 11 || x >= 110 || y <= 11 || y >= 90 ? BLACK : YELLOW)
    }
    const image = { data, width, height }
    const region = createRegionFinder(image).inPolygon([[[24, 24], [98, 24], [98, 78], [24, 78]]])
    expect(region).not.toBeNull()
    // Right up to the line on every side — no strip of the old colour left.
    for (const [x, y] of [[12, 50], [109, 50], [60, 12], [60, 89], [12, 12], [109, 89]]) {
      expect(regionContains(region, y * width + x)).toBe(true)
    }
    // And not past it: the line and the road stay out.
    expect(regionContains(region, 50 * width + 5)).toBe(false)
    expect(regionContains(region, 50 * width + 115)).toBe(false)
  })

  it('paints an annotated lot from its outline, even one drawn slightly off', () => {
    const image = makeMap()
    // Lot A spans x 6–29; this outline stops short on the left and overshoots the
    // border line on the right, as a hand-drawn annotation might.
    const region = createRegionFinder(image).inPolygon([
      [
        [9, 8],
        [31.5, 8],
        [31.5, 31],
        [9, 31],
      ],
    ])
    expect(region).not.toBeNull()
    const out = new Uint8ClampedArray(image.data)
    paintRegion(out, region, [0, 100, 200])
    const painted = { ...image, data: out }

    expect(pixelAt(painted, 6, 20)).toEqual([0, 100, 200]) // fill just outside the outline still painted
    expect(pixelAt(painted, 29, 32)).toEqual([0, 100, 200]) // corner outside the outline, within the pad
    expect(pixelAt(painted, 14, 17)).toEqual([0, 0, 0]) // text stays black
    expect(pixelAt(painted, 30, 20)).toEqual(GREY) // border line untouched
    expect(pixelAt(painted, 31, 20)).toEqual(YELLOW) // the next lot is not bled into
  })
})

describe('inPolygonExact', () => {
  const outline = [
    [
      [9, 8],
      [31.5, 8],
      [31.5, 31],
      [9, 31],
    ],
  ]

  it('colors only inside the polygon, keeping text and the border line', () => {
    const image = makeMap()
    const region = createRegionFinder(image).inPolygonExact(outline)
    expect(region).not.toBeNull()
    const out = new Uint8ClampedArray(image.data)
    paintRegion(out, region, [0, 100, 200])
    const painted = { ...image, data: out }

    expect(pixelAt(painted, 20, 20)).toEqual([0, 100, 200]) // inside: recolored
    expect(pixelAt(painted, 6, 20)).toEqual(YELLOW) // fill left of the outline: untouched
    expect(pixelAt(painted, 14, 17)).toEqual([0, 0, 0]) // text stays black
    expect(pixelAt(painted, 30, 20)).toEqual(GREY) // border line inside the outline: untouched
    // The outline overshoots the line by a pixel: in this mode that pixel follows the polygon too, and no further.
    expect(pixelAt(painted, 31, 20)).toEqual([0, 100, 200])
    expect(pixelAt(painted, 32, 20)).toEqual(YELLOW)
  })

  it('returns pixels sorted, so regionContains works on them', () => {
    const region = createRegionFinder(makeMap()).inPolygonExact(outline)
    for (let n = 1; n < region.pixels.length; n += 1) expect(region.pixels[n]).toBeGreaterThan(region.pixels[n - 1])
    expect(regionContains(region, 20 * makeMap().width + 20)).toBe(true)
  })

  it('finds nothing in an outline over dark pixels only', () => {
    const image = makeMap()
    for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) image.data.set([0, 0, 0, 255], (y * image.width + x) * 4)
    expect(createRegionFinder(image).inPolygonExact(outline)).toBeNull()
  })
})

describe('sampleColor', () => {
  it('reads the median colour around a point, ignoring a stray dark pixel', () => {
    const width = 9
    const height = 9
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i += 1) data.set([140, 196, 138, 255], i * 4)
    data.set([0, 0, 0, 255], (4 * width + 4) * 4) // a letter pixel right under the click
    expect(sampleColor({ data, width, height }, 4, 4)).toBe('#8CC48A')
  })

  it('returns null off the image', () => {
    const data = new Uint8ClampedArray(4)
    expect(sampleColor({ data, width: 1, height: 1 }, 5, 0)).toBeNull()
  })
})
