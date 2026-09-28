import { describe, expect, it } from 'vitest'
import { hexToHsv, hsvToHex } from './legendPalette'

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
