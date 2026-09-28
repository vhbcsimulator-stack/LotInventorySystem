import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * An in-memory stand-in for the Supabase client: it records every storage and
 * table call, and answers from `db`, so saving a map can be checked without
 * touching the real bucket or table.
 */
const calls = []
const db = { rows: [], before: null, updateRows: true, uploadError: null }

function query(table) {
  const op = { table, steps: [] }
  const builder = {
    select: (cols) => (op.steps.push(['select', cols]), builder),
    eq: (col, value) => (op.steps.push(['eq', col, value]), builder),
    ilike: () => builder,
    order: () => builder,
    in: (col, values) => (op.steps.push(['in', col, values]), builder),
    update: (fields) => (op.steps.push(['update', fields]), builder),
    insert: (fields) => (op.steps.push(['insert', fields]), builder),
    delete: () => (op.steps.push(['delete']), builder),
    maybeSingle: () => (op.steps.push(['maybeSingle']), builder),
    then: (resolve) => {
      calls.push(op)
      const kinds = op.steps.map(([kind]) => kind)
      if (kinds.includes('maybeSingle')) return resolve({ data: db.before, error: null })
      if (kinds.includes('update')) return resolve({ data: db.updateRows && table === 'uploads' ? [{ id: 8 }] : [], error: null })
      if (kinds.includes('insert')) return resolve({ data: [{ id: 99 }], error: null })
      if (kinds.includes('delete')) return resolve({ data: [], error: null })
      return resolve({ data: db.rows, error: null })
    },
  }
  return builder
}

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'editor-id' } } }) },
    from: (table) => query(table),
    storage: {
      from: (bucket) => ({
        upload: async (path, file, options) => {
          calls.push({ storage: 'upload', bucket, path, options })
          return { error: db.uploadError }
        },
        remove: async (paths) => {
          calls.push({ storage: 'remove', bucket, paths })
          return { error: null }
        },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.example/${bucket}/${path}` } }),
      }),
    },
  },
  unwrap: ({ data, error }) => {
    if (error) throw new Error(error.message)
    return { data: data ?? [] }
  },
}))

const { saveProjectMap } = await import('./projectMapsData')

// A real PNG header, so the upload rules accept the file.
const png = (name) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], name, { type: 'image/png' })
const row = (overrides) => ({
  id: 8,
  name: 'old.png',
  project: 'MVLC',
  project_id: 1,
  phase_id: 2,
  Phase: 2,
  map_section: 'East',
  type: 'residential',
  image_URL: 'https://cdn.example/mvlc/owner-id/MVLC/phase-2-east/old.png',
  storage_path: 'owner-id/MVLC/phase-2-east/old.png',
  uploaded_at: '2026-09-01T00:00:00Z',
  ...overrides,
})
const target = { phase: 2, section: 'East', commercial: false }
const uploads = () => calls.filter((call) => call.storage === 'upload')
const removes = () => calls.filter((call) => call.storage === 'remove')
const tableOps = (kind) => calls.filter((call) => call.table === 'uploads' && call.steps?.some(([step]) => step === kind))

beforeEach(() => {
  calls.length = 0
  Object.assign(db, { rows: [], before: null, updateRows: true, uploadError: null })
})

describe('saveProjectMap — updating a map reuses what is there', () => {
  it('overwrites the same file in the same folder, updating the same row', async () => {
    db.rows = [row()]
    db.before = { image_URL: row().image_URL, storage_path: row().storage_path }
    await saveProjectMap({ projectCode: 'MVLC', projectId: 1, target, file: png('new.png'), replaceId: 8 })

    expect(uploads()).toHaveLength(1)
    expect(uploads()[0].path).toBe('owner-id/MVLC/phase-2-east/old.png')
    expect(uploads()[0].options.upsert).toBe(true)
    expect(tableOps('insert')).toHaveLength(0)
    const [update] = tableOps('update')
    const fields = update.steps.find(([step]) => step === 'update')[1]
    expect(fields.storage_path).toBe('owner-id/MVLC/phase-2-east/old.png')
    expect(fields.image_URL).toMatch(/old\.png\?v=\d+$/)
    // The row was written before the file was overwritten, and nothing was deleted.
    expect(calls.indexOf(update)).toBeLessThan(calls.indexOf(uploads()[0]))
    expect(removes()).toHaveLength(0)
  })

  it('keeps the folder and name when the type changes, and drops the old file', async () => {
    db.rows = [row({ name: 'old.jpg', storage_path: 'owner-id/MVLC/phase-2-east/old.jpg' })]
    await saveProjectMap({ projectCode: 'MVLC', projectId: 1, target, file: png('new.png'), replaceId: 8 })
    expect(uploads()[0].path).toBe('owner-id/MVLC/phase-2-east/old.png')
    expect(removes()[0].paths).toEqual(['owner-id/MVLC/phase-2-east/old.jpg'])
  })

  it('puts a first map for a slot in the project folder its maps already use', async () => {
    const other = row({ id: 7, Phase: 1, storage_path: 'owner-id/MVLC/phase-1-east/one.png' })
    db.rows = [other]
    await saveProjectMap({ projectCode: 'MVLC', projectId: 1, target, file: png('new.png'), existing: [] })
    expect(uploads()[0].path).toMatch(/^owner-id\/MVLC\/phase-2-east\/\d+_[a-z0-9]+_new\.png$/)
    expect(uploads()[0].options.upsert).toBe(false)
    expect(tableOps('insert')).toHaveLength(1)
  })

  it('moves a map saved under another account’s folder into the project’s main one', async () => {
    // Three maps in the original folder; the one being replaced was saved from another account.
    db.rows = [
      row({ id: 7, Phase: 1, storage_path: 'original-id/MVLC/phase-1-east/a.png' }),
      row({ id: 8, storage_path: 'other-id/MVLC/phase-2-east/old.png' }),
      row({ id: 9, Phase: 3, map_section: null, storage_path: 'original-id/MVLC/phase-3/b.png' }),
      row({ id: 11, Phase: 1, type: 'commercial', storage_path: 'original-id/MVLC/phase-1-commercial/c.png' }),
    ]
    await saveProjectMap({ projectCode: 'MVLC', projectId: 1, target, file: png('new.png'), replaceId: 8 })
    expect(uploads()[0].path).toBe('original-id/MVLC/phase-2-east/old.png')
    expect(removes()[0].paths).toEqual(['other-id/MVLC/phase-2-east/old.png'])
  })

  it('writes a new map to the main folder even when another account’s map is found first', async () => {
    db.rows = [
      row({ id: 12, Phase: 1, storage_path: 'other-id/MVLC/phase-1-east/x.png' }),
      row({ id: 7, Phase: 3, map_section: null, storage_path: 'original-id/MVLC/phase-3/a.png' }),
      row({ id: 9, Phase: 1, type: 'commercial', storage_path: 'original-id/MVLC/phase-1-commercial/b.png' }),
    ]
    await saveProjectMap({ projectCode: 'MVLC', projectId: 1, target, file: png('new.png'), existing: [] })
    expect(uploads()[0].path).toMatch(/^original-id\/MVLC\/phase-2-east\//)
  })

  it('leaves the old file untouched when the database refuses the change', async () => {
    db.rows = [row()]
    db.updateRows = false
    await expect(saveProjectMap({ projectCode: 'MVLC', projectId: 1, target, file: png('new.png'), replaceId: 8 })).rejects.toThrow(
      /did not accept the change to map #8/,
    )
    expect(uploads()).toHaveLength(0)
    expect(removes()).toHaveLength(0)
  })

  it('puts the row back when the upload fails', async () => {
    db.rows = [row()]
    db.before = { image_URL: 'https://cdn.example/mvlc/owner-id/MVLC/phase-2-east/old.png', storage_path: 'owner-id/MVLC/phase-2-east/old.png' }
    db.uploadError = { message: 'network down' }
    await expect(saveProjectMap({ projectCode: 'MVLC', projectId: 1, target, file: png('new.png'), replaceId: 8 })).rejects.toThrow(/network down/)
    const updates = tableOps('update')
    expect(updates).toHaveLength(2)
    expect(updates[1].steps.find(([step]) => step === 'update')[1]).toEqual(db.before)
    expect(removes()).toHaveLength(0)
  })
})
