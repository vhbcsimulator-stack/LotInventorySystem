import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: null,
  fetchAllRows: vi.fn(),
  uiStatus: (status) => status,
  unwrap: (value) => value,
}))
vi.mock('./announcementsData', () => ({ fetchAnnouncements: vi.fn() }))

const { summarize } = await import('./dashboardData')

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
