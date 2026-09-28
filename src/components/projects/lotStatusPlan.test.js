import { describe, expect, it, vi } from 'vitest'

vi.mock('@/data/projectsData', () => ({
  lotKey: (value) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ''),
}))

const { annotationIdsForLot, fillForStatus, planStatusUpdate } = await import('./lotStatusPlan')

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

  it('reads a "C L1" label as the C-prefixed commercial lot', () => {
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
        ['cl1', [{ id: 20, lotNo: 'C L1', category: 'commercial_corner', status: 'available' }]],
        ['l2', [{ id: 21, lotNo: 'L2', category: 'regular', status: 'available' }]],
      ]),
    )
    expect(plan.changes).toEqual([{ id: 20, lotNo: 'C L1', label: 'C L1', from: 'available', status: 'sold' }])
    expect(plan.skipped.map((entry) => entry.label)).toEqual(['C L2'])
  })

  it('still matches a legacy commercial row stored without the C prefix', () => {
    const plan = planStatusUpdate(
      [{ id: 1, label: 'C L1' }],
      [{ shapeId: 1, status: 'sold' }],
      lots([['l1', [{ id: 20, lotNo: 'L1', category: 'commercial_corner', status: 'available' }]]]),
    )
    expect(plan.changes).toEqual([{ id: 20, lotNo: 'L1', label: 'C L1', from: 'available', status: 'sold' }])
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
    expect(plan.skipped.map((entry) => entry.label)).toEqual(['B2 L1', 'Road'])
    expect(plan.upToDate).toEqual([{ label: 'B1-L4', status: 'hold' }])
    expect(plan.mapOnly).toBe(1)
  })

  it('carries the reserve type, and changes a reserved lot whose type differs', () => {
    const plan = planStatusUpdate(
      shapes,
      [
        { shapeId: 1, status: 'reserved', reserveType: 'company' },
        { shapeId: 2, status: 'reserved', reserveType: 'client' },
        { shapeId: 3, status: 'reserved', reserveType: 'client' },
      ],
      lots([
        ['b1l3', [{ id: 10, lotNo: 'B1 L3', status: 'available', reserveType: '' }]],
        ['b1l4', [{ id: 11, lotNo: 'B1 L4', status: 'reserved', reserveType: 'company' }]],
        ['b2l1', [{ id: 12, lotNo: 'B2 L1', status: 'reserved', reserveType: 'client' }]],
      ]),
    )
    expect(plan.changes).toEqual([
      { id: 10, lotNo: 'B1 L3', label: 'B1 L3', from: 'available', status: 'reserved', reserveType: 'company', fromReserveType: '' },
      { id: 11, lotNo: 'B1 L4', label: 'B1-L4', from: 'reserved', status: 'reserved', reserveType: 'client', fromReserveType: 'company' },
    ])
    expect(plan.upToDate).toEqual([{ label: 'B2 L1', status: 'reserved', reserveType: 'client' }])
  })
})

describe('fillForStatus', () => {
  it('maps table statuses to map colors, pending reservations included', () => {
    expect(fillForStatus('sold')).toBe('sold')
    expect(fillForStatus('rsv-p')).toBe('reserved')
    expect(fillForStatus('available')).toBe('open')
    expect(fillForStatus('mystery')).toBeNull()
  })
})

describe('annotationIdsForLot', () => {
  const coco = {
    categories: [
      { id: 1, name: 'B1 L3' },
      { id: 2, name: 'C L1' },
    ],
    annotations: [{ id: 10, category_id: 1 }, { category_id: 2 }, { id: 12, category_id: 1 }],
  }

  it('finds every annotation labelled with the lot', () => {
    expect(annotationIdsForLot(coco, { lotNo: 'B1 L3', rawCategory: 'residential' })).toEqual([10, 12])
  })

  it('matches the C-prefixed label only for a commercial lot, using the index when there is no id', () => {
    expect(annotationIdsForLot(coco, { lotNo: 'C L1', rawCategory: 'commercial_corner' })).toEqual([1])
    expect(annotationIdsForLot(coco, { lotNo: 'L1', rawCategory: 'commercial_corner' })).toEqual([1])
    expect(annotationIdsForLot(coco, { lotNo: 'L1', rawCategory: 'residential' })).toEqual([])
  })
})

describe('planStatusUpdate with clicked areas', () => {
  const table = lots([
    ['l6', [{ id: 60, lotNo: 'L6', status: 'available' }]],
    ['l7', [{ id: 70, lotNo: 'L7', status: 'sold' }]],
  ])

  it('updates a clicked area linked to a lot, by its id', () => {
    const plan = planStatusUpdate([], [{ x: 10, y: 20, status: 'sold', lot: { id: 60, lotNo: 'L6' } }], table)
    expect(plan.changes).toEqual([{ id: 60, lotNo: 'L6', label: 'L6', from: 'available', status: 'sold' }])
    expect(plan.mapOnly).toBe(0)
  })

  it('leaves an unlinked clicked area on the map only', () => {
    const plan = planStatusUpdate([], [{ x: 10, y: 20, status: 'sold' }], table)
    expect(plan.changes).toEqual([])
    expect(plan.mapOnly).toBe(1)
  })

  it('lets the newest click linked to the same lot win', () => {
    const plan = planStatusUpdate(
      [],
      [
        { x: 1, y: 1, status: 'hold', lot: { id: 60, lotNo: 'L6' } },
        { x: 2, y: 2, status: 'sold', lot: { id: 60, lotNo: 'L6' } },
      ],
      table,
    )
    expect(plan.changes).toEqual([{ id: 60, lotNo: 'L6', label: 'L6', from: 'available', status: 'sold' }])
  })

  it('reports a linked lot already at that status as up to date, and a vanished one as skipped', () => {
    const plan = planStatusUpdate(
      [],
      [
        { x: 1, y: 1, status: 'sold', lot: { id: 70, lotNo: 'L7' } },
        { x: 2, y: 2, status: 'sold', lot: { id: 99, lotNo: 'L99' } },
      ],
      table,
    )
    expect(plan.upToDate).toEqual([{ label: 'L7', status: 'sold' }])
    expect(plan.skipped.map((entry) => entry.label)).toEqual(['L99'])
  })

  it('never lets a click and an annotation both set one lot', () => {
    const plan = planStatusUpdate(
      [{ id: 1, label: 'L6' }],
      [
        { shapeId: 1, status: 'hold' },
        { x: 2, y: 2, status: 'sold', lot: { id: 60, lotNo: 'L6' } },
      ],
      table,
    )
    expect(plan.changes).toEqual([{ id: 60, lotNo: 'L6', label: 'L6', from: 'available', status: 'hold' }])
    expect(plan.skipped).toHaveLength(1)
  })
})
