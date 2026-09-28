import { beforeEach, describe, expect, it, vi } from 'vitest'

// An in-memory stand-in for Supabase: each table answers with its rows below.
const tables = { annotated_images: [], uploads: [] }

vi.mock('./supabase', () => {
  const query = (table) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      ilike: () => builder,
      order: () => builder,
      then: (resolve) => resolve({ data: tables[table], error: null }),
    }
    return builder
  }
  return {
    supabase: { from: (table) => query(table) },
    unwrap: ({ data, error }) => {
      if (error) throw new Error(error.message)
      return { data: data ?? [] }
    },
  }
})

const { fetchAnnotatedImages, parseSlot } = await import('./annotatedImagesData')

const annotations = {
  id: 8,
  project: 'MVLC',
  slot: 'phase-2-east',
  phase: '2',
  map_section: 'East',
  // A link the row recorded long ago — to a file that has since been deleted.
  image_link: 'https://cdn.example/mvlc/old/deleted-map.svg',
  storage_path: null,
  coco_json: { images: [{ width: 2048, height: 1448 }], annotations: [], categories: [] },
}
const map = {
  id: 8,
  name: 'phase-2e.svg',
  project: 'MVLC',
  Phase: 2,
  map_section: 'East',
  type: 'residential',
  image_URL: 'https://cdn.example/mvlc/owner/MVLC/phase-2-east/phase-2e.svg?v=1',
  storage_path: 'owner/MVLC/phase-2-east/phase-2e.svg',
}

beforeEach(() => {
  tables.annotated_images = [annotations]
  tables.uploads = []
})

describe('fetchAnnotatedImages — the picture comes from uploads', () => {
  it('shows the slot’s current map from uploads, not the link the row recorded', async () => {
    tables.uploads = [map]
    const { images } = await fetchAnnotatedImages({ projectCode: 'MVLC' })
    expect(images[0].url).toBe(map.image_URL)
  })

  it('shows no picture once the map is gone from uploads', async () => {
    const { images } = await fetchAnnotatedImages({ projectCode: 'MVLC' })
    expect(images[0].url).toBe('')
    expect(images[0].annotations).toBe(0) // the annotations themselves are still there
  })

  it('shows no picture when the map row has lost its image', async () => {
    tables.uploads = [{ ...map, image_URL: null }]
    const { images } = await fetchAnnotatedImages({ projectCode: 'MVLC' })
    expect(images[0].url).toBe('')
  })
})

describe('annotation map sections', () => {
  it.each([
    ['phase-1-a', 1, 'A'],
    ['phase-1-b', 1, 'B'],
    ['phase-1-c', 1, 'C'],
    ['phase-2-east', 2, 'East'],
  ])('reads %s as phase %i section %s', (slot, phase, section) => {
    expect(parseSlot(slot)).toMatchObject({ phase, section, commercial: false })
  })

  it('returns the stored section with an annotated image', async () => {
    const { images } = await fetchAnnotatedImages({ projectCode: 'MVLC' })
    expect(images[0].mapSection).toBe('East')
  })
})
