import { describe, expect, it } from 'vitest'
import { createRegionFinder, paintRegion, regionContains } from './lotRecolor'

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
