import { describe, expect, it } from 'vitest'

const { cleanBroker, creditSales, validateBroker } = await import('./brokersData')

const VALID = { firstName: 'Juan', lastName: 'Dela Cruz', mobileNumber: '0917 123 4567', email: 'juan@example.com' }

describe('validateBroker', () => {
  it('accepts a complete form', () => {
    expect(validateBroker(VALID)).toEqual({})
    expect(validateBroker({ ...VALID, mobileNumber: '+63 (917) 123-4567' })).toEqual({})
  })

  it('requires every field', () => {
    expect(Object.keys(validateBroker({ firstName: ' ', lastName: '', mobileNumber: '', email: '' }))).toEqual([
      'firstName',
      'lastName',
      'mobileNumber',
      'email',
    ])
  })

  it('rejects malformed mobile numbers and emails', () => {
    expect(validateBroker({ ...VALID, mobileNumber: '12345' }).mobileNumber).toBeTruthy()
    expect(validateBroker({ ...VALID, mobileNumber: '0917-ABC-4567' }).mobileNumber).toBeTruthy()
    expect(validateBroker({ ...VALID, email: 'juan@example' }).email).toBeTruthy()
  })
})

describe('cleanBroker', () => {
  it('trims fields and lower-cases the email', () => {
    expect(cleanBroker({ ...VALID, firstName: ' Juan ', email: ' Juan@Example.COM ' })).toEqual({
      ...VALID,
      email: 'juan@example.com',
    })
  })

  it('sends no password: the create-broker function generates it', () => {
    expect(cleanBroker({ ...VALID, password: 'typed' })).not.toHaveProperty('password')
  })
})

describe('creditSales', () => {
  const geraldA = { id: 'a', firstName: 'Gerald', lastName: 'Delima', email: 'geralddelima.vhbc@gmail.com' }
  const geraldB = { id: 'b', firstName: 'Gerald', lastName: 'Delima', email: 'delimagerald9@gmail.com' }
  const juan = { id: 'j', firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@example.com' }

  it('credits a lot to the account whose email it stores, even when two share the name', () => {
    const stats = creditSales([geraldA, geraldB], [{ seller: 'GeraldDelima.vhbc@gmail.com', total: 2881200 }])
    expect(stats.get('a')).toEqual({ lotsSold: 1, totalTcp: 2881200 })
    expect(stats.has('b')).toBe(false)
  })

  it('credits an older, name-only lot when exactly one account has that name', () => {
    expect(creditSales([juan], [{ seller: 'juan  DELA-cruz', total: 100 }]).get('j')).toEqual({ lotsSold: 1, totalTcp: 100 })
  })

  it('credits a name-only lot to no one when several accounts share the name', () => {
    expect(creditSales([geraldA, geraldB], [{ seller: 'Gerald Delima', total: 100 }]).size).toBe(0)
  })
})
