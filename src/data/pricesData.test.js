import { describe, expect, it, vi } from 'vitest'

// Price rows as the database would return them; every table read answers from here.
const tables = {
  mvlc_price: [
    { id: 1, phase: 1, regular: 9000, prime: null },
    { id: 2, phase: 4, regular: 12000, prime: 14000 },
  ],
  new_price: [
    { id: 1, phase: null, regular: 8000, prime: 9000 },
    { id: 2, phase: 2, regular: 8500, prime: null },
  ],
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table) => {
      const builder = {
        select: () => builder,
        order: () => builder,
        then: (resolve) => resolve({ data: tables[table] ?? [], error: null }),
      }
      return builder
    },
  },
  fetchAllRows: async () => [],
  unwrap: ({ data, error }) => {
    if (error) throw new Error(error.message)
    return { data }
  },
}))

const { PRICE_CONFIG, defaultScopeValue, fetchPriceLookup, registerPriceTable } = await import('./pricesData')

describe('phased price tables', () => {
  it('prices any MVLC phase that has a row — not only phases 1 to 3', async () => {
    const priceFor = await fetchPriceLookup('MVLC')
    expect(priceFor(4, 'regular')).toBe(12000)
    expect(priceFor(1, 'regular')).toBe(9000)
    // MVLC has no all-phases row: an unpriced phase stays unpriced.
    expect(priceFor(5, 'regular')).toBeNull()
  })

  it("prices a portal-added project's phase from its own row, else the all-phases row", async () => {
    registerPriceTable('NEW', 'new_price')
    expect(PRICE_CONFIG.NEW).toMatchObject({ table: 'new_price', phased: true, allPhases: true })
    const priceFor = await fetchPriceLookup('NEW')
    expect(priceFor(2, 'regular')).toBe(8500)
    // Phase 2 has no prime price of its own, so the all-phases price applies.
    expect(priceFor(2, 'prime')).toBe(9000)
    expect(priceFor(7, 'regular')).toBe(8000)
    expect(priceFor(null, 'regular')).toBe(8000)
  })

  it('never replaces a built-in price table', () => {
    registerPriceTable('MVLC', 'other_price')
    expect(PRICE_CONFIG.MVLC.table).toBe('mvlc_price')
  })

  it('opens the price dialog on the right default scope', () => {
    expect(defaultScopeValue(PRICE_CONFIG.MVLC)).toBe('1')
    expect(defaultScopeValue(PRICE_CONFIG.NEW)).toBe('all')
    expect(defaultScopeValue(PRICE_CONFIG.ERHD)).toBe('main')
  })
})
