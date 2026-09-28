import { describe, expect, it, vi } from 'vitest'

// Only the pure phase-code parsing is under test; no database is needed.
vi.mock('./supabase', () => ({ supabase: null, unwrap: (value) => value }))

const { CATEGORY_CODES, formatLotIdentifier, isLotIdentifierValid, parsePhaseCode } = await import('./projectsData')

describe('MVLC lot identifier format', () => {
  it.each([
    ['B1 L1', 'B1 L1'],
    ['B1L1', 'B1 L1'],
    ['B1-L1', 'B1 L1'],
    ['b 01 l 002', 'B1 L2'],
    ['21-Jan', 'B21 L1'],
    ['21-Dec', 'B21 L12'],
    ['21-13', 'B21 L13'],
    ['21-32A', 'B21 L32A'],
    ['23-B-1', 'B23-B L1'],
    ['LOT 1', 'C L1'],
    ['L1', 'C L1'],
    ['C L1', 'C L1'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(formatLotIdentifier('MVLC', input)).toBe(expected)
    expect(isLotIdentifierValid('MVLC', input)).toBe(true)
  })

  it('reads a numeric legacy block-lot pair', () => {
    expect(formatLotIdentifier('MVLC', '1-1')).toBe('B1 L1')
    expect(isLotIdentifierValid('MVLC', '1-1')).toBe(true)
  })
})

describe('parsePhaseCode with MVLC sales-sheet codes', () => {
  it.each([
    ['MV-C-1A', 1, 'A', 'commercial'],
    ['MV-1A', 1, 'A', 'regular'],
    ['MV-C-1B', 1, 'B', 'commercial'],
    ['MV-1B', 1, 'B', 'regular'],
    ['MV-1C', 1, 'C', 'regular'],
    ['MV-C-2A', 2, 'A', 'commercial'],
    ['MV-2A', 2, 'A', 'regular'],
    ['MV-2B', 2, 'B', 'regular'],
    ['MV-2B C', 2, 'B', 'regular_corner'],
    ['MV-3 C', 3, null, 'regular_corner'],
    ['MV-3', 3, null, 'regular'],
    ['MV 1 E', 1, 'East', 'regular'],
    ['MV 1 E- C', 1, 'East', 'commercial'],
    ['MV 2E-PC', 2, 'East', 'prime_corner'],
    ['MV 2E-P', 2, 'East', 'prime'],
    ['MV 2E', 2, 'East', 'regular'],
  ])('%s imports as phase %i %s and %s', (code, phase, section, category) => {
    expect(parsePhaseCode('MVLC', code)).toEqual({ phase, section, category })
  })
})

describe('parsePhaseCode with the shared category codes', () => {
  const ungrouped = { ...CATEGORY_CODES, phase: false }
  const grouped = { ...CATEGORY_CODES, phase: true }

  it('reads P, PC and C as Prime, Prime Corner and Regular Corner', () => {
    expect(parsePhaseCode('GLS', 'GLS P', ungrouped).category).toBe('prime')
    expect(parsePhaseCode('GLS', 'GLS-PC', ungrouped).category).toBe('prime_corner')
    expect(parsePhaseCode('GLS', 'GLS C', ungrouped).category).toBe('regular_corner')
  })

  it('reads a cell with no marker, only the project name, as Regular', () => {
    expect(parsePhaseCode('ERHD', 'ERHD', ungrouped).category).toBe('regular')
  })

  it('still reads the phase number for a phased project', () => {
    expect(parsePhaseCode('EBLF', '2 PC', grouped)).toEqual({ phase: 2, category: 'prime_corner' })
    expect(parsePhaseCode('EBLF', 'Phase 1', grouped)).toEqual({ phase: 1, category: 'regular' })
  })

  it('leaves a project without codes alone when none are given', () => {
    expect(parsePhaseCode('GLS', 'GLS P')).toEqual({ phase: null, category: '' })
  })
})
