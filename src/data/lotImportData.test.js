import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: null,
  fetchAllRows: vi.fn(),
  uiStatus: (status) => status,
  unwrap: (value) => value,
}))

const { contractTypeFromCsv, msccReportRow, paymentTypeFromCsv, reservationFromCsv } = await import('./lotImportData')

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
    expect(reservationFromCsv('available', 'Juan Dela Cruz')).toEqual({ reserve_type: null, reserved_for: null })
  })

  it('keeps the buyer of a sold lot, without a reserve type', () => {
    expect(reservationFromCsv('SOLD', 'Maria Santos')).toEqual({ reserve_type: null, reserved_for: 'Maria Santos' })
    expect(reservationFromCsv('sold', ' Ana Reyes ')).toEqual({ reserve_type: null, reserved_for: 'Ana Reyes' })
  })

  it('drops company holds and blanks on a sold lot', () => {
    expect(reservationFromCsv('SOLD', 'DD RESERVED')).toEqual({ reserve_type: null, reserved_for: null })
    expect(reservationFromCsv('SOLD', 'msd')).toEqual({ reserve_type: null, reserved_for: null })
    expect(reservationFromCsv('SOLD', '')).toEqual({ reserve_type: null, reserved_for: null })
  })
})

describe('CSV payment type', () => {
  it('reads the cash spellings', () => {
    ;['CASH', 'CSH', 'Spot Cash', 'spot', 'Full Payment', 'full'].forEach((value) => expect(paymentTypeFromCsv(value)).toBe('cash'))
  })

  it('reads the installment spellings', () => {
    ;['INSTALLMENT', 'Installment (60 mos)', 'Inst', 'INSTL', 'instlmt', 'In-house', 'Bank Financing', 'PAG-IBIG', 'IPP', 'Monthly'].forEach(
      (value) => expect(paymentTypeFromCsv(value)).toBe('installment'),
    )
  })

  it('is null when blank and undefined when unrecognised', () => {
    expect(paymentTypeFromCsv('')).toBeNull()
    expect(paymentTypeFromCsv('   ')).toBeNull()
    expect(paymentTypeFromCsv('barter')).toBeUndefined()
  })
})

describe('CSV CTS/DOAS', () => {
  it('reads CTS and DOAS in their usual spellings', () => {
    ;['CTS', 'cts', 'Contract to Sell', 'CTS - signed'].forEach((value) => expect(contractTypeFromCsv(value)).toBe('cts'))
    ;['DOAS', 'doas', 'Deed of Absolute Sale', 'Deed of Sale', 'DAS'].forEach((value) =>
      expect(contractTypeFromCsv(value)).toBe('doas'),
    )
  })

  it('is null (Unknown) when blank and undefined when unrecognised', () => {
    expect(contractTypeFromCsv('')).toBeNull()
    expect(contractTypeFromCsv('pending')).toBeUndefined()
  })
})

describe('MSCC status sheet rows', () => {
  const unit = (overrides) => ({
    phaseNo: 1,
    phase: 'Tower 1',
    lotNo: '207',
    rawStatus: 'available',
    reserveType: '',
    reservedFor: '',
    soldBy: '',
    lastUpdated: '',
    lastUpdatedPrecision: '',
    floorLevel: '2nd Floor',
    unitType: '1 Bedroom',
    areaSqm: 27,
    ...overrides,
  })

  it('leaves the reservation cells of an open unit blank', () => {
    expect(msccReportRow(unit())).toEqual(['TOWER 1', '2F (1 BR)', '207', 'OPEN', '', '', '', '', '', '', 27])
  })

  it('fills a sold unit and marks what was never recorded as UNKNOWN', () => {
    const row = msccReportRow(unit({ rawStatus: 'sold', reservedFor: 'Tolentino, F', soldBy: 'DRS-Madel', lastUpdated: '2024-12-19' }))
    expect(row).toEqual(['TOWER 1', '2F (1 BR)', '207', 'SOLD', 'Tolentino, F', 'UNKNOWN', '2024', 'DECEMBER', '12/19/2024', 'DRS-Madel', 27])
  })

  it('names company holds the way the sheet does', () => {
    expect(msccReportRow(unit({ rawStatus: 'reserved', reserveType: 'company' }))[4]).toBe('COMPANY')
    expect(msccReportRow(unit({ rawStatus: 'rsv-p', reserveType: 'company', reservedFor: 'MSD' })).slice(3, 10)).toEqual([
      'RSV',
      'MSD RESERVED',
      '',
      '',
      '',
      '',
      '',
    ])
  })

  it('falls back to the unit number and UNKNOWN when unit details are missing', () => {
    const row = msccReportRow(unit({ lotNo: '1205', floorLevel: '', unitType: '2 Bedroom Deluxe', areaSqm: 0, rawStatus: 'reserved', lastUpdated: '2025-01-01', lastUpdatedPrecision: 'month' }))
    expect(row).toEqual(['TOWER 1', '12F (2 BR DELUXE)', '1205', 'RSV', 'UNKNOWN', 'UNKNOWN', '2025', 'JANUARY', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN'])
    expect(msccReportRow(unit({ phaseNo: null, phase: '—', unitType: '' })).slice(0, 2)).toEqual(['UNKNOWN', '2F (UNKNOWN)'])
    expect(msccReportRow(unit({ unitType: '', rawCategory: '2_bedroom_deluxe' }))[1]).toBe('2F (2 BR DELUXE)')
  })
})
