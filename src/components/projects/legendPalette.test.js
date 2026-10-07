import { describe, expect, it } from 'vitest'
import { DEFAULT_PALETTE, hexToHsv, hexToRgb, hsvToHex, isDefaultPalette, parseColorCode, rgbToHex, samePalette } from './legendPalette'

describe('samePalette', () => {
  it('matches palettes colour for colour, ignoring case', () => {
    const lower = Object.fromEntries(Object.entries(DEFAULT_PALETTE).map(([status, hex]) => [status, hex.toLowerCase()]))
    expect(samePalette(lower, DEFAULT_PALETTE)).toBe(true)
    expect(isDefaultPalette(lower)).toBe(true)
  })

  it('tells palettes apart by any one status', () => {
    expect(samePalette({ ...DEFAULT_PALETTE, hold: '#000000' }, DEFAULT_PALETTE)).toBe(false)
    expect(samePalette({}, {})).toBe(false)
  })
})

describe('parseColorCode', () => {
  it('reads hex codes with or without #, in six or three digits', () => {
    expect(parseColorCode('#5c9df2')).toBe('#5C9DF2')
    expect(parseColorCode('5C9DF2')).toBe('#5C9DF2')
    expect(parseColorCode('#fa0')).toBe('#FFAA00')
    expect(parseColorCode('  fa0 ')).toBe('#FFAA00')
  })

  it('reads red, green and blue from 0 to 255', () => {
    expect(parseColorCode('rgb(92, 157, 242)')).toBe('#5C9DF2')
    expect(parseColorCode('92,157,242')).toBe('#5C9DF2')
    expect(parseColorCode('92 157 242')).toBe('#5C9DF2')
  })

  it('rejects anything else', () => {
    expect(parseColorCode('')).toBeNull()
    expect(parseColorCode('red')).toBeNull()
    expect(parseColorCode('#12345')).toBeNull()
    expect(parseColorCode('rgb(256, 0, 0)')).toBeNull()
  })
})

describe('hexToRgb / rgbToHex', () => {
  it('round-trips', () => {
    expect(hexToRgb('#5C9DF2')).toEqual([92, 157, 242])
    expect(rgbToHex([92, 157, 242])).toBe('#5C9DF2')
    expect(hexToRgb('#FFF')).toBeNull()
  })
})

describe('hsvToHex / hexToHsv', () => {
  it('converts the primaries', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#FF0000')
    expect(hsvToHex(120, 1, 1)).toBe('#00FF00')
    expect(hsvToHex(240, 1, 1)).toBe('#0000FF')
    expect(hsvToHex(0, 0, 1)).toBe('#FFFFFF')
    expect(hsvToHex(0, 0, 0)).toBe('#000000')
  })

  it('round-trips the default legend colors', () => {
    for (const hex of ['#8CC48A', '#5C9DF2', '#F5AC2A', '#F9F6A6', '#E4EEC6']) {
      const { h, s, v } = hexToHsv(hex)
      expect(hsvToHex(h, s, v)).toBe(hex)
    }
  })

  it('rejects anything that is not #RRGGBB', () => {
    expect(hexToHsv('red')).toBeNull()
    expect(hexToHsv('#FFF')).toBeNull()
  })
})
