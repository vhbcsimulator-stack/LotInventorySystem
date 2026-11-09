import { describe, expect, it, vi } from 'vitest'

const row = { current: null }
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row.current, error: null }) }) }),
    }),
  },
}))

const { EditConflictError, conflictFor, isEditConflict, isNewer, unlessChanged } = await import('./editConflicts')

describe('isNewer', () => {
  it('compares instants, not strings', () => {
    expect(isNewer('2026-11-07T10:00:01Z', '2026-11-07T10:00:00.000+00:00')).toBe(true)
    expect(isNewer('2026-11-07T10:00:00Z', '2026-11-07T10:00:00.000+00:00')).toBe(false)
  })
  it('is false when either version is unknown', () => {
    expect(isNewer('', '2026-11-07T10:00:00Z')).toBe(false)
    expect(isNewer('2026-11-07T10:00:00Z', undefined)).toBe(false)
  })
})

describe('unlessChanged', () => {
  it('adds the version filter only when a version is known', () => {
    const request = { eq: vi.fn(() => 'guarded') }
    expect(unlessChanged(request, '2026-11-07T10:00:00Z')).toBe('guarded')
    expect(request.eq).toHaveBeenCalledWith('updated_at', '2026-11-07T10:00:00Z')
    expect(unlessChanged(request, '')).toBe(request)
  })
})

describe('conflictFor', () => {
  it('reports a row saved since the version as changed', async () => {
    row.current = { updated_at: '2026-11-07T10:05:00Z' }
    const conflict = await conflictFor('mvlc_lots', 1, '2026-11-07T10:00:00Z', 'This lot')
    expect(isEditConflict(conflict)).toBe(true)
    expect(conflict.deleted).toBe(false)
  })
  it('reports a missing row as deleted', async () => {
    row.current = null
    const conflict = await conflictFor('mvlc_lots', 1, '2026-11-07T10:00:00Z', 'This lot')
    expect(conflict).toBeInstanceOf(EditConflictError)
    expect(conflict.deleted).toBe(true)
  })
  it('is null when the row is still at the version (the write was refused for another reason)', async () => {
    row.current = { updated_at: '2026-11-07T10:00:00.000+00:00' }
    expect(await conflictFor('mvlc_lots', 1, '2026-11-07T10:00:00Z', 'This lot')).toBeNull()
  })
  it('is null without a version to check', async () => {
    expect(await conflictFor('mvlc_lots', 1, undefined, 'This lot')).toBeNull()
  })
})
