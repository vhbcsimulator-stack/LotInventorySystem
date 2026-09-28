import { describe, expect, it } from 'vitest'

const { cleanBroker, validateBroker } = await import('./brokersData')

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
