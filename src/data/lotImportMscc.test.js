import { describe, expect, it, vi } from 'vitest'

// Unit 202 is already in the MSCC table as a 2 Bedroom Deluxe; the others are new.
vi.mock('./supabase', () => ({
  supabase: {},
  fetchAllRows: vi.fn(async () => [{ id: 7, lot_no: '202', phase: 1, category: '2_bedroom_deluxe' }]),
  uiStatus: (status) => status,
  unwrap: (value) => value,
}))
vi.mock('./pricesData', () => ({ fetchPriceLookup: async () => () => null }))
vi.mock('@/lib/uploadRules', () => ({ checkUpload: async () => {} }))

const { bedroomCategory, floorLevelFromCell, previewLotImport } = await import('./lotImportData')

// Papa.parse reads a string the same way as a chosen file, which Node cannot hand it.
const sheet = [
  'BUILDING,FLOOR,UNIT,STATUS,CLIENT NAME,RA #,YEAR,MONTH,RSV DATE,SD/SM/REALTY,LOT AREA',
  'TOWER 1,2F,202,RSV,COMPANY,,,,,,54',
  'TOWER 1,2F (1 BR),203,SOLD,"Tolentino, F",UNKNOWN,2024,DECEMBER,12/19/2024,DRS-Madel,27',
  'TOWER 1,2F (2 BR),204,RSV,UNKNOWN,UNKNOWN,2025,JANUARY,UNKNOWN,UNKNOWN,54',
  'TOWER 1,2F (2 BR-DE,205,OPEN,,,,,,,75.28',
  'TOWER 1,,206,OPEN,,,,,,,27',
].join('\n')

describe('importing the MSCC status sheet', () => {
  it('reads UNIT and BUILDING, takes the category from the FLOOR bedrooms, and treats UNKNOWN as blank', async () => {
    const { rows, errors, missingHeaders, counts } = await previewLotImport('MSCC', sheet)
    expect(missingHeaders).toEqual([])
    expect(errors).toEqual([])
    expect(counts).toEqual({ total: 5, insert: 4, update: 1 })

    const [held, sold, unknown, deluxe, blank] = rows
    expect(held).toMatchObject({ id: 7, lot_no: '202', phase: 1, category: '2_bedroom_deluxe', status: 'reserved', reserve_type: 'company' })
    expect(sold).toMatchObject({ id: null, lot_no: '203', category: '1_bedroom', status: 'sold', reserved_for: 'Tolentino, F', sold_by: 'DRS-Madel', date: '2024-12-19' })
    expect(unknown).toMatchObject({ lot_no: '204', category: '2_bedroom', reserved_for: null, sold_by: null, date: '2025-01-01', precision: 'month' })
    expect(deluxe).toMatchObject({ category: '2_bedroom_deluxe', floor_level: '2nd Floor', unit_type: '2 Bedroom Deluxe' })
    expect(held).toMatchObject({ floor_level: '2nd Floor', unit_type: null })
    expect(blank).toMatchObject({ floor_level: null, unit_type: null })
    // No bedrooms on a new unit: the default category.
    expect(blank.category).toBe('1_bedroom')
  })

  it('reads the bedrooms however the sheet spells them', () => {
    expect(bedroomCategory('2F (1 BR)')).toBe('1_bedroom')
    expect(bedroomCategory('2 Bedroom')).toBe('2_bedroom')
    expect(bedroomCategory('2F (2 BR DELUXE)')).toBe('2_bedroom_deluxe')
    expect(bedroomCategory('2 Bedroom Deluxe')).toBe('2_bedroom_deluxe')
    expect(bedroomCategory('2F')).toBe('')
  })

  it('reads the floor from outside the parentheses', () => {
    expect(floorLevelFromCell('2F (2 BR)')).toBe('2nd Floor')
    expect(floorLevelFromCell('3F (1 BR)')).toBe('3rd Floor')
    expect(floorLevelFromCell('11 FLR (1 BR)')).toBe('11th Floor')
    expect(floorLevelFromCell('21F')).toBe('21st Floor')
    // The "2" inside the parentheses is the bedroom count, not a floor.
    expect(floorLevelFromCell('(2 BR)')).toBe('')
  })
})
