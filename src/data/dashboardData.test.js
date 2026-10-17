import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: null,
  fetchAllRows: vi.fn(),
  uiStatus: (status) => status,
  unwrap: (value) => value,
}))
vi.mock('./announcementsData', () => ({ fetchAnnouncements: vi.fn() }))

const { summarize, recentTransactions } = await import('./dashboardData')

describe('recent transactions', () => {
  it('lists dated sales and reservations newest first, and counts the undated', () => {
    const lot = (id, date, writtenAt = '') => ({ id, date, writtenAt, status: 'sold' })
    const { rows, undated } = recentTransactions([
      lot('old', '2025-01-10'),
      lot('none', ''),
      lot('new-early', '2026-10-15', '2026-10-15T01:00:00Z'),
      lot('new-late', '2026-10-15', '2026-10-15T09:00:00Z'),
      lot('mid', '2026-03-01'),
    ])
    expect(rows.map((row) => row.id)).toEqual(['new-late', 'new-early', 'mid', 'old'])
    expect(undated).toBe(1)
  })

  it('takes in only the sold and reserved lots of the project in view', () => {
    const base = { projectName: 'P', group: null, areaSqm: 10, phase: null, mapSection: null, date: '2026-01-01' }
    const result = summarize(
      [
        { ...base, id: 'a', projectCode: 'A', property: 'A1', status: 'sold' },
        { ...base, id: 'b', projectCode: 'A', property: 'A2', status: 'available' },
        { ...base, id: 'c', projectCode: 'B', property: 'B1', status: 'reserved' },
      ],
      { project: 'A' },
    )
    expect(result.recent.rows.map((row) => row.id)).toEqual(['a'])
  })
})

describe('dashboard MVLC phases', () => {
  it('keeps map sections as separate, fully labelled phases', () => {
    const common = {
      projectCode: 'MVLC',
      projectName: 'Mountain View Leisure Community',
      group: 'Phase',
      areaSqm: 100,
      status: 'available',
    }
    const result = summarize([
      { ...common, id: 'a', property: 'A', phase: 1, mapSection: 'A' },
      { ...common, id: 'b', property: 'B', phase: 1, mapSection: 'B' },
      { ...common, id: 'east', property: 'East', phase: 1, mapSection: 'East' },
      { ...common, id: '2a', property: '2A', phase: 2, mapSection: 'A' },
      { ...common, id: '3', property: '3', phase: 3, mapSection: null },
    ])

    expect(result.sellThrough[0].phases.map((phase) => phase.label)).toEqual([
      'Phase 1A',
      'Phase 1B',
      'Phase 1 East',
      'Phase 2A',
      'Phase 3',
    ])
  })
})
