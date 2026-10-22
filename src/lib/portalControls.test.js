import { describe, expect, it } from 'vitest'
import { BUTTON_CONTROLS, CONTROL_STATE, commandAvailable, controlMessage, controlState, isDeveloper } from './portalControls'

describe('isDeveloper', () => {
  it('trusts app_metadata only', () => {
    expect(isDeveloper({ app_metadata: { role: 'developer' } })).toBe(true)
    expect(isDeveloper({ user_metadata: { role: 'developer' } })).toBe(false)
    expect(isDeveloper(null)).toBe(false)
  })
})

describe('controlState', () => {
  it('is visible without a row or with an unknown state', () => {
    expect(controlState({}, 'page.clients')).toBe(CONTROL_STATE.VISIBLE)
    expect(controlState({ 'page.clients': { state: 'gone' } }, 'page.clients')).toBe(CONTROL_STATE.VISIBLE)
    expect(controlState(null, 'portal')).toBe(CONTROL_STATE.VISIBLE)
  })

  it('reads the stored state', () => {
    expect(controlState({ portal: { state: 'maintenance' } }, 'portal')).toBe(CONTROL_STATE.MAINTENANCE)
  })
})

describe('controlMessage', () => {
  it('trims and defaults to empty', () => {
    expect(controlMessage({ portal: { message: '  back at 5pm ' } }, 'portal')).toBe('back at 5pm')
    expect(controlMessage({}, 'portal')).toBe('')
  })
})

describe('commandAvailable', () => {
  const addLot = { page: 'projects', props: { initialAction: 'add-lot' } }

  it('drops commands on a hidden or maintenance page', () => {
    expect(commandAvailable({ 'page.projects': { state: 'hidden' } }, addLot)).toBe(false)
    expect(commandAvailable({ 'page.projects': { state: 'maintenance' } }, { page: 'projects' })).toBe(false)
  })

  it('drops a project action that is switched off', () => {
    expect(commandAvailable({ 'button.projects.add-lot': { state: 'maintenance' } }, addLot)).toBe(false)
    expect(commandAvailable({}, addLot)).toBe(true)
  })

  it('drops map commands when the map tab or Color lots is switched off', () => {
    const colorLots = { page: 'projects', props: { initialView: 'map', initialMapAction: 'color-lots' } }
    expect(commandAvailable({ 'button.projects.color-lots': { state: 'hidden' } }, colorLots)).toBe(false)
    expect(commandAvailable({ 'button.projects.view-map': { state: 'hidden' } }, colorLots)).toBe(false)
    expect(commandAvailable({}, colorLots)).toBe(true)
  })
})

it('gives every button a unique id', () => {
  const ids = BUTTON_CONTROLS.map((button) => button.id)
  expect(new Set(ids).size).toBe(ids.length)
})
