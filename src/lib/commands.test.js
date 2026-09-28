import { describe, expect, it } from 'vitest'

const { COMMANDS, SEARCH_SUGGESTIONS, searchCommands } = await import('./commands')

describe('searchCommands', () => {
  it('finds the action that opens a dialog, not just the page around it', () => {
    // The example the feature was asked for: typing "add lot" offers the button.
    const results = searchCommands('add lot')
    expect(results.some(({ label }) => label.startsWith('Add lot'))).toBe(true)
    expect(results.every(({ group }) => group === 'Actions')).toBe(true)
  })

  it('carries the action through to the page that runs it', () => {
    const [first] = searchCommands('update discount MVLC')
    expect(first.page).toBe('projects')
    expect(first.props).toMatchObject({ initialProjectCode: 'MVLC', initialAction: 'update-discount' })
  })

  it('narrows as more words are typed', () => {
    const broad = searchCommands('map', { limit: 50 })
    const narrow = searchCommands('map eblf', { limit: 50 })
    expect(narrow.length).toBeLessThan(broad.length)
    expect(narrow.every(({ label, keywords }) => `${label} ${keywords}`.includes('EBLF'))).toBe(true)
  })

  it('matches on a synonym that is not in the name', () => {
    // "csv" is in the keywords of the import and export actions.
    expect(searchCommands('csv').length).toBeGreaterThan(0)
  })

  it('opens Color Lots on the selected project map', () => {
    const [result] = searchCommands('color lots MVLC')
    expect(result.label).toBe('Color Lots — MVLC')
    expect(result.props).toMatchObject({ initialProjectCode: 'MVLC', initialView: 'map', initialMapAction: 'color-lots' })
  })

  it('finds pages by name', () => {
    expect(searchCommands('dashboard')[0]).toMatchObject({ page: 'dashboard', group: 'Pages' })
  })

  it('matches nothing until something is typed', () => {
    expect(searchCommands('')).toEqual([])
    expect(searchCommands('   ')).toEqual([])
  })

  it('offers nothing for a word no command has', () => {
    expect(searchCommands('zzzznope')).toEqual([])
  })

  it('gives every command a unique id', () => {
    expect(new Set(COMMANDS.map(({ id }) => id)).size).toBe(COMMANDS.length)
  })

  it('keeps every suggested search useful', () => {
    expect(SEARCH_SUGGESTIONS.every((suggestion) => searchCommands(suggestion).length > 0)).toBe(true)
  })
})
