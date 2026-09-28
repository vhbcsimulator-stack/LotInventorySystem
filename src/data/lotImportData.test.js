import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: null,
  fetchAllRows: vi.fn(),
  uiStatus: (status) => status,
  unwrap: (value) => value,
}))

const { reservationFromCsv } = await import('./lotImportData')

describe('CSV reservation type inference', () => {
  it('recognizes a company reservation', () => {
    expect(reservationFromCsv('RSV', 'Company')).toEqual({ reserve_type: 'company', reserved_for: null })
  })

  it('treats DD and MSD holds as company reservations but keeps the label', () => {
    expect(reservationFromCsv('RSV', 'DD')).toEqual({ reserve_type: 'company', reserved_for: 'DD' })
    expect(reservationFromCsv('RSV-P', ' dd ')).toEqual({ reserve_type: 'company', reserved_for: 'DD' })
    expect(reservationFromCsv('RSV', 'DD RESERVED')).toEqual({ reserve_type: 'company', reserved_for: 'DD' })
    expect(reservationFromCsv('RSV', 'MSD RESERVED')).toEqual({ reserve_type: 'company', reserved_for: 'MSD' })
    expect(reservationFromCsv('RSV', 'msd')).toEqual({ reserve_type: 'company', reserved_for: 'MSD' })
  })

  it('uses the default reservation when Client is empty', () => {
    expect(reservationFromCsv('RSV', '')).toEqual({ reserve_type: null, reserved_for: null })
    expect(reservationFromCsv('RSV-P', '   ')).toEqual({ reserve_type: null, reserved_for: null })
  })

  it('recognizes a client reservation and preserves the name', () => {
    expect(reservationFromCsv('RSV', 'Juan Dela Cruz')).toEqual({
      reserve_type: 'client',
      reserved_for: 'Juan Dela Cruz',
    })
  })

  it('also applies to pending RSV rows and ignores other statuses', () => {
    expect(reservationFromCsv('RSV-P', 'Maria Santos')).toEqual({
      reserve_type: 'client',
      reserved_for: 'Maria Santos',
    })
    expect(reservationFromCsv('SOLD', 'Company')).toEqual({ reserve_type: null, reserved_for: null })
  })
})
