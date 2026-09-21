import { describe, expect, it, vi } from 'vitest'

vi.mock('@/data/projectsData', () => ({
  lotKey: (value) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ''),
}))

const { planStatusUpdate } = await import('./lotStatusPlan')

const lots = (entries) => new Map(entries)
const shapes = [
  { id: 1, label: 'B1 L3' },
  { id: 2, label: 'B1-L4' },
  { id: 3, label: 'B2 L1' },
  { id: 4, label: 'Road' },
]

describe('planStatusUpdate', () => {
  it('turns an unambiguous colored lot into a status change', () => {
    const plan = planStatusUpdate(
      shapes,
      [{ shapeId: 1, status: 'sold' }],
      lots([['b1l3', [{ id: 10, lotNo: 'B1 L3', status: 'available' }]]]),
    )
    expect(plan.changes).toEqual([{ id: 10, lotNo: 'B1 L3', label: 'B1 L3', from: 'available', status: 'sold' }])
    expect(plan.skipped).toEqual([])
  })

  it('reads a "C L1" label as the commercial lot stored as "L1", never a residential one', () => {
    const commercialShapes = [
      { id: 1, label: 'C L1' },
      { id: 2, label: 'C L2' },
    ]
    const plan = planStatusUpdate(
      commercialShapes,
      [
        { shapeId: 1, status: 'sold' },
        { shapeId: 2, status: 'sold' },
      ],
      lots([
        ['l1', [{ id: 20, lotNo: 'L1', category: 'commercial_corner', status: 'available' }]],
        ['l2', [{ id: 21, lotNo: 'L2', category: 'regular', status: 'available' }]],
      ]),
    )
    expect(plan.changes).toEqual([{ id: 20, lotNo: 'L1', label: 'C L1', from: 'available', status: 'sold' }])
    expect(plan.skipped.map((entry) => entry.label)).toEqual(['C L2'])
  })

  it('maps both open and prime to available', () => {
    const plan = planStatusUpdate(
      shapes,
      [
        { shapeId: 1, status: 'open' },
        { shapeId: 2, status: 'prime' },
      ],
      lots([
        ['b1l3', [{ id: 10, lotNo: 'B1 L3', status: 'sold' }]],
        ['b1l4', [{ id: 11, lotNo: 'B1 L4', status: 'sold' }]],
      ]),
    )
    expect(plan.changes.map((change) => change.status)).toEqual(['available', 'available'])
    expect(plan.skipped).toEqual([])
  })

  it('uses the newest paint of a lot and skips unchanged, unknown, and ambiguous lots', () => {
    const plan = planStatusUpdate(
      shapes,
      [
        { shapeId: 1, status: 'sold' },
        { shapeId: 1, status: 'reserved' },
        { shapeId: 2, status: 'hold' },
        { shapeId: 3, status: 'sold' },
        { shapeId: 4, status: 'sold' },
        { x: 5, y: 5, status: 'sold' },
      ],
      lots([
        ['b1l3', [{ id: 10, lotNo: 'B1 L3', status: 'available' }]],
        ['b1l4', [{ id: 11, lotNo: 'B1 L4', status: 'hold' }]],
        [
          'b2l1',
          [
            { id: 12, lotNo: 'B2 L1', status: 'available' },
            { id: 13, lotNo: 'B2 L1', status: 'available' },
          ],
        ],
      ]),
    )
    expect(plan.changes).toEqual([{ id: 10, lotNo: 'B1 L3', label: 'B1 L3', from: 'available', status: 'reserved' }])
    expect(plan.skipped.map((entry) => entry.label)).toEqual(['B1-L4', 'B2 L1', 'Road'])
    expect(plan.mapOnly).toBe(1)
  })
})
