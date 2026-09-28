import { describe, expect, it } from 'vitest'
import { frameMisfit, lotShapes, parseTransform, pictureSvg, shadeColor } from './svgMaps'

// The start of the MVLC Phase 2 East map as exported: one picture at a rounded scale.
const PHASE_2_EAST = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="Layer_1" version="1.1" viewBox="0 0 2048 1448" width="2048" height="1448"><metadata>
</metadata>

  <image width="7016" height="4961" transform="translate(.1) scale(.29)" xlink:href="data:image/jpeg;base64,/9j/4AAQ`

describe('parseTransform', () => {
  it('reads translate then scale in order', () => {
    expect(parseTransform('translate(.1) scale(.29)')).toEqual({ a: 0.29, d: 0.29, e: 0.1, f: 0 })
  })
  it('reads a matrix without rotation, and refuses a rotation', () => {
    expect(parseTransform('matrix(2 0 0 3 5 6)')).toEqual({ a: 2, d: 3, e: 5, f: 6 })
    expect(parseTransform('rotate(90)')).toBeNull()
    expect(parseTransform('matrix(0 1 -1 0 0 0)')).toBeNull()
  })
  it('treats no transform as none', () => {
    expect(parseTransform(null)).toEqual({ a: 1, d: 1, e: 0, f: 0 })
  })
})

describe('frameMisfit', () => {
  it('spots a picture drawn slightly smaller than its frame', () => {
    expect(frameMisfit(PHASE_2_EAST)).toEqual({
      frame: { width: 2048, height: 1448 },
      picture: { width: 2034.6, height: 1438.7 },
    })
  })
  it('passes a picture that fills its frame', () => {
    const exact = PHASE_2_EAST.replace('translate(.1) scale(.29)', 'scale(0.291904 0.291877)')
    expect(frameMisfit(exact)).toBeNull()
  })
  it('leaves a deliberate layout alone — a picture far from filling the frame', () => {
    const inset = PHASE_2_EAST.replace('translate(.1) scale(.29)', 'translate(200 150) scale(.2)')
    expect(frameMisfit(inset)).toBeNull()
  })
  it('only looks at a picture drawn first', () => {
    const drawnFirst = PHASE_2_EAST.replace('<image', '<rect width="10" height="10"/><image')
    expect(frameMisfit(drawnFirst)).toBeNull()
  })
})

describe('shadeColor', () => {
  it('paints the fill flat, steps soft edges, and leaves text as drawn', () => {
    expect(shadeColor([0, 128, 0], 1.04)).toEqual([0, 128, 0])
    expect(shadeColor([0, 128, 0], 0.5)).toEqual([0, 64, 0])
    expect(shadeColor([0, 128, 0], 0.1)).toBeNull()
  })
  it('fades toward white lettering, and leaves the white itself as drawn', () => {
    expect(shadeColor([0, 128, 0], 2.5)).toEqual([127.5, 191.5, 127.5])
    expect(shadeColor([0, 128, 0], 2.95)).toBeNull()
  })
})

describe('lotShapes', () => {
  it('traces a lot as one flat path per colour, around its lettering', () => {
    // A 4 × 2 lot on a 10-wide canvas; pixel 13 is a black letter stroke, 14 its soft edge.
    const region = {
      seed: 11,
      pixels: Int32Array.from([11, 12, 13, 14, 21, 22, 23, 24]),
      shades: Float32Array.from([1, 1, 0, 0.5, 1, 1, 1, 1]),
    }
    const shapes = lotShapes(region, 10, [0, 128, 0])
    expect(shapes).toEqual([
      { fill: '#008000', d: 'M1 1h2v1h-2zM1 2h4v1h-4z' },
      { fill: '#004000', d: 'M4 1h1v1h-1z' },
    ])
  })
})

describe('pictureSvg', () => {
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQ'

  it('embeds the picture as given, once, over the annotations size', () => {
    const text = pictureSvg(jpeg, 2048, 1448)
    expect(text).toMatch(/^<svg [^>]*width="2048" height="1448" viewBox="0 0 2048 1448">/)
    expect(text).toContain(`<image x="0" y="0" width="2048" height="1448" preserveAspectRatio="none" xlink:href="${jpeg}"/>`)
    expect(text.split(jpeg).length - 1).toBe(1)
  })

  it('refuses anything but an embedded picture', () => {
    expect(() => pictureSvg('https://example.com/map.png', 10, 10)).toThrow()
    expect(() => pictureSvg(jpeg, 0, 10)).toThrow()
  })
})
