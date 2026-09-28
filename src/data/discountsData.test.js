import { describe, expect, it } from 'vitest'

const { PAYMENT_OPTIONS, quote } = await import('./discountsData')

describe('quote', () => {
  it('takes the discount off the list price', () => {
    // The example the payment options were described with: Cash, 40% off, no interest.
    expect(quote({ price: 1_000_000, option: 'cash', discount: 40, interest: 0 })).toEqual({
      net: 600_000,
      downPayment: 600_000,
      balance: 0,
      total: 600_000,
    })
  })

  it('charges interest on the balance left after the down payment', () => {
    // 20% off leaves 800,000; half of that is put down and the rest carries 10%.
    expect(quote({ price: 1_000_000, option: '50', discount: 20, interest: 10 })).toEqual({
      net: 800_000,
      downPayment: 400_000,
      balance: 440_000,
      total: 840_000,
    })
  })

  it('puts nothing down under the 0% option, so interest applies to the whole price', () => {
    expect(quote({ price: 500_000, option: '0', discount: 0, interest: 12 })).toEqual({
      net: 500_000,
      downPayment: 0,
      balance: 560_000,
      total: 560_000,
    })
  })

  it('treats an option name as the share paid up front', () => {
    // "30% down" on a 1,000,000 lot puts 300,000 down and carries 700,000.
    const down = (option) => quote({ price: 1_000_000, option, discount: 0, interest: 0 }).downPayment
    expect(down('cash')).toBe(1_000_000)
    expect(down('50')).toBe(500_000)
    expect(down('30')).toBe(300_000)
    expect(down('20')).toBe(200_000)
    expect(down('0')).toBe(0)
  })

  it('names every option after that share', () => {
    expect(PAYMENT_OPTIONS.map(({ label }) => label)).toEqual(['Cash', '50% down', '30% down', '20% down', '0% down'])
  })

  it('leaves a zero price at zero under every option', () => {
    ;['cash', '50', '30', '20', '0'].forEach((option) => {
      expect(quote({ price: 0, option, discount: 25, interest: 8 }).total).toBe(0)
    })
  })
})
