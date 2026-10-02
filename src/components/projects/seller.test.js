import { describe, expect, it } from 'vitest'
import { findAccount, sellerFields, sellerOf } from './seller'

const geraldA = { id: 'a', name: 'Gerald Delima', email: 'geralddelima.vhbc@gmail.com' }
const geraldB = { id: 'b', name: 'Gerald Delima', email: 'delimagerald9@gmail.com' }
const juan = { id: 'j', name: 'Juan Dela Cruz', email: 'juan@example.com' }

describe('findAccount', () => {
  it('finds the account a stored email means, whatever its case', () => {
    expect(findAccount([geraldA, geraldB], 'DelimaGerald9@gmail.com')).toBe(geraldB)
  })

  it('finds an older, name-only seller only when one account has the name', () => {
    expect(findAccount([juan], 'juan dela-cruz')).toBe(juan)
    expect(findAccount([geraldA, geraldB], 'Gerald Delima')).toBeUndefined()
  })

  it('finds nothing for an "Other" name or a blank', () => {
    expect(findAccount([juan], 'Some Realty')).toBeUndefined()
    expect(findAccount([juan], '')).toBeUndefined()
  })
})

describe('sellerFields', () => {
  it('stores a broker in soldBy and clears the sales agent', () => {
    expect(sellerFields({ kind: 'broker', name: ' juan@example.com ' })).toEqual({ soldBy: 'juan@example.com', salesAgent: '' })
  })

  it('stores a sales agent in salesAgent and clears the broker', () => {
    expect(sellerFields({ kind: 'sales_agent', name: 'maria@example.com' })).toEqual({ soldBy: '', salesAgent: 'maria@example.com' })
  })

  it('stores no one until the kind is chosen', () => {
    expect(sellerFields({ kind: '', name: 'Anyone' })).toEqual({ soldBy: '', salesAgent: '' })
    expect(sellerFields(undefined)).toEqual({ soldBy: '', salesAgent: '' })
  })
})

describe('sellerOf', () => {
  it('reads who sold a lot back', () => {
    expect(sellerOf({ soldBy: 'juan@example.com' })).toEqual({ kind: 'broker', name: 'juan@example.com' })
    expect(sellerOf({ soldBy: '', salesAgent: 'maria@example.com' })).toEqual({ kind: 'sales_agent', name: 'maria@example.com' })
    expect(sellerOf(null)).toEqual({ kind: '', name: '' })
  })
})
