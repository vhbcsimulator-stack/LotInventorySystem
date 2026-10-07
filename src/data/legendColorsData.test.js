import { describe, expect, it } from 'vitest'
import { paletteToRow, rowToMapColors, rowToPalette } from './legendColorsData'
import { DEFAULT_PALETTE } from '@/components/projects/legendPalette'

describe('paletteToRow / rowToPalette', () => {
  it('stores one upper-case column per status and reads it back', () => {
    const palette = { ...DEFAULT_PALETTE, sold: '#12ab34' }
    const row = paletteToRow(palette)
    expect(row).toEqual({
      sold_color: '#12AB34',
      reserved_color: DEFAULT_PALETTE.reserved,
      hold_color: DEFAULT_PALETTE.hold,
      prime_color: DEFAULT_PALETTE.prime,
      open_color: DEFAULT_PALETTE.open,
    })
    expect(rowToPalette(row)).toEqual({ ...DEFAULT_PALETTE, sold: '#12AB34' })
  })

  it('falls back to the default for a missing or malformed colour', () => {
    expect(rowToPalette({ sold_color: 'green', hold_color: '#abcdef' })).toEqual({ ...DEFAULT_PALETTE, hold: '#ABCDEF' })
    expect(rowToPalette(null)).toEqual({ ...DEFAULT_PALETTE })
  })
})

describe('rowToMapColors', () => {
  it('reads a row as its map tab, phase, section and palette', () => {
    expect(rowToMapColors({ slot: 'phase-2-east', phase: 2, map_section: 'East', sold_color: '#112233' })).toEqual({
      slot: 'phase-2-east',
      phase: 2,
      section: 'East',
      palette: { ...DEFAULT_PALETTE, sold: '#112233' },
    })
    expect(rowToMapColors({ slot: 'whole', phase: null, map_section: null })).toEqual({
      slot: 'whole',
      phase: null,
      section: null,
      palette: { ...DEFAULT_PALETTE },
    })
  })
})
