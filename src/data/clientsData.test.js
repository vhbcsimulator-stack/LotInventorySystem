import { describe, expect, it } from 'vitest'

const clientsModule = await import('./clientsData')
const { NEW_CLIENT_FIELDS, portalSubtitle, validateClient } = clientsModule

const VALID = {
  broker_name: 'VHBC Test',
  name: 'Aaron',
  phone: '096528104',
  stage: 'cold',
  project_code: 'ERHD',
  unit_description: 'ERHD Development Unit',
  tcp_formatted: 'Price Upon Request',
}

describe('validateClient', () => {
  it('accepts the client card fields, leaving notes, email, and VIP tag optional', () => {
    expect(validateClient(VALID)).toEqual({})
  })

  it('requires every required field', () => {
    const required = NEW_CLIENT_FIELDS.filter((field) => field.required).map((field) => field.key)
    expect(Object.keys(validateClient({}))).toEqual(required)
  })

  it('rejects a malformed email', () => {
    expect(validateClient({ ...VALID, email: 'aaron@' }).email).toBeTruthy()
  })

  it('only accepts the five stages', () => {
    expect(validateClient({ ...VALID, stage: 'lukewarm' }).stage).toBeTruthy()
    ;['hot', 'warm', 'reserved', 'cold', 'closed'].forEach((stage) => expect(validateClient({ ...VALID, stage })).toEqual({}))
  })

  it('never asks for what the portal or the app fills in', () => {
    const asked = NEW_CLIENT_FIELDS.map((field) => field.key)
    ;['avatar_url', 'subtitle', 'last_activity_text', 'hold_subtitle', 'status_note', 'tag_note'].forEach((key) => expect(asked).not.toContain(key))
  })

  it('marks a client added here as portal-exclusive', () => {
    expect(portalSubtitle('ERHD')).toBe('Portal Exclusive • ERHD')
  })
})

describe('unitDescription', () => {
  const { unitDescription } = clientsModule

  it('names the lot and its status', () => {
    expect(unitDescription('MVLC', 'B27 L1', 'Reserved')).toBe('MVLC B27 L1 · Reserved')
    expect(unitDescription('MVLC', 'B27 L1', 'Available')).toBe('MVLC B27 L1 · Available')
  })

  it('leaves the status off when there is none', () => {
    expect(unitDescription('ERHD', ' 12 ', '')).toBe('ERHD 12')
  })
})

describe('client form', () => {
  it('no longer asks for the TCP', () => {
    expect(NEW_CLIENT_FIELDS.some((field) => field.key === 'tcp_formatted')).toBe(false)
  })
})
