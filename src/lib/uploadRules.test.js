import { describe, expect, it } from 'vitest'
import { acceptFor, checkUpload, describeUpload, isSvgText, uploadProblem } from './uploadRules'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]

const file = (bytes, name, type) => new File([new Uint8Array(bytes)], name, { type })
const sized = (size, name, type) => ({ name, type, size })

describe('uploadProblem', () => {
  it('accepts JPG, PNG and WebP photos', () => {
    expect(uploadProblem('photo', sized(1000, 'a.jpg', 'image/jpeg'))).toBe('')
    expect(uploadProblem('photo', sized(1000, 'a.PNG', 'image/png'))).toBe('')
    expect(uploadProblem('photo', sized(1000, 'a.webp', 'image/webp'))).toBe('')
  })

  it('refuses other image formats', () => {
    expect(uploadProblem('photo', sized(1000, 'a.gif', 'image/gif'))).toMatch(/not an accepted file/)
    expect(uploadProblem('photo', sized(1000, 'a.svg', 'image/svg+xml'))).toMatch(/not an accepted file/)
    expect(uploadProblem('photo', sized(1000, 'a.heic', 'image/heic'))).toMatch(/not an accepted file/)
  })

  it('refuses empty and oversized files, naming the limit', () => {
    expect(uploadProblem('photo', sized(0, 'a.jpg', 'image/jpeg'))).toMatch(/empty/)
    expect(uploadProblem('photo', sized(11 * 1024 * 1024, 'a.jpg', 'image/jpeg'))).toMatch(/limit is 10 MB/)
    expect(uploadProblem('map', sized(11 * 1024 * 1024, 'a.png', 'image/png'))).toBe('')
    expect(uploadProblem('map', sized(26 * 1024 * 1024, 'a.png', 'image/png'))).toMatch(/limit is 25 MB/)
  })

  it('takes a .csv however Windows reports it, but not a workbook', () => {
    expect(uploadProblem('csv', sized(100, 'lots.csv', 'application/vnd.ms-excel'))).toBe('')
    expect(uploadProblem('csv', sized(100, 'lots.csv', ''))).toBe('')
    expect(uploadProblem('csv', sized(100, 'lots.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toMatch(/CSV/)
  })

  it('takes a .json with no reported type', () => {
    expect(uploadProblem('coco', sized(100, 'map.json', ''))).toBe('')
    expect(uploadProblem('coco', sized(100, 'map.txt', 'text/plain'))).toMatch(/COCO JSON/)
  })

  it('judges an unnamed Blob by its type', () => {
    expect(uploadProblem('map', { type: 'image/jpeg', size: 10 })).toBe('')
    expect(uploadProblem('map', { type: '', size: 10 })).toMatch(/not an accepted file/)
  })
})

describe('checkUpload', () => {
  it('accepts real JPEG, PNG and WebP content', async () => {
    await expect(checkUpload('photo', file(JPEG, 'a.jpg', 'image/jpeg'))).resolves.toBeUndefined()
    await expect(checkUpload('photo', file(PNG, 'a.png', 'image/png'))).resolves.toBeUndefined()
    await expect(checkUpload('map', file(WEBP, 'a.webp', 'image/webp'))).resolves.toBeUndefined()
  })

  it('refuses a GIF or SVG renamed to .png', async () => {
    await expect(checkUpload('photo', file(GIF, 'a.png', 'image/png'))).rejects.toThrow(/not a real/)
    const svg = [...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')]
    await expect(checkUpload('map', file(svg, 'a.png', 'image/png'))).rejects.toThrow(/not a real/)
  })

  it('refuses a binary file renamed to .csv', async () => {
    await expect(checkUpload('csv', file([0x50, 0x4b, 0x03, 0x04, 0, 0], 'lots.csv', 'text/csv'))).rejects.toThrow(/plain-text/)
    await expect(checkUpload('csv', file([...new TextEncoder().encode('lot_no,phase\n1,2\n')], 'lots.csv', 'text/csv'))).resolves.toBeUndefined()
  })
})

describe('SVG maps', () => {
  const svgFile = (text, name = 'map.svg') => file([...new TextEncoder().encode(text)], name, 'image/svg+xml')

  it('accepts SVG for maps only', () => {
    expect(uploadProblem('map', sized(1000, 'site.svg', 'image/svg+xml'))).toBe('')
    expect(uploadProblem('photo', sized(1000, 'site.svg', 'image/svg+xml'))).toMatch(/not an accepted file/)
  })

  it('recognises an SVG after a declaration, doctype, or comment', () => {
    expect(isSvgText('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(true)
    expect(isSvgText('﻿<?xml version="1.0"?>\n<!-- CAD export -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg>')).toBe(true)
    expect(isSvgText('<html><svg></svg></html>')).toBe(false)
    expect(isSvgText('not an svg')).toBe(false)
  })

  it('checks what an SVG holds, not what it is called', async () => {
    await expect(checkUpload('map', svgFile('<?xml version="1.0"?><svg viewBox="0 0 10 10"></svg>'))).resolves.toBeUndefined()
    await expect(checkUpload('map', svgFile('<html><body>hi</body></html>'))).rejects.toThrow(/not a real SVG/)
    await expect(checkUpload('map', file(PNG, 'map.svg', 'image/svg+xml'))).rejects.toThrow(/not a real SVG/)
  })
})

describe('picker helpers', () => {
  it('builds the accept attribute and hint', () => {
    expect(acceptFor('photo')).toBe('.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp')
    expect(describeUpload('map')).toBe('JPG, PNG, WebP or SVG · up to 25 MB')
    expect(describeUpload('csv')).toBe('CSV (.csv) · up to 5 MB')
  })
})
