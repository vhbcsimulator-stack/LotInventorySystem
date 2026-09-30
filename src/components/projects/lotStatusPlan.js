import { lotKey } from '@/data/projectsData'

/**
 * The lot-table status each map colour stands for. Prime (yellow) and open are
 * both unsold lots — prime only marks the premium ones — so both mean available.
 */
export const LOT_STATUS_BY_FILL = { sold: 'sold', reserved: 'reserved', hold: 'hold', open: 'available', prime: 'available' }

/**
 * The map colour for a lot-table status — the other way round. Available lots
 * go back to open; prime cannot be told apart from the table, so it is never
 * chosen automatically. Null for a status the map has no colour for.
 */
export function fillForStatus(status) {
  return { sold: 'sold', reserved: 'reserved', 'rsv-p': 'reserved', hold: 'hold', available: 'open' }[status] ?? null
}

/**
 * The annotation ids (as the preview numbers them: `id`, or the index when an
 * annotation has none) whose label names `lot` — { lotNo, rawCategory } from
 * the lot table. A legacy commercial lot without its "C" prefix also answers
 * to the map's "C"-prefixed label.
 */
export function annotationIdsForLot(coco, lot) {
  const key = lotKey(lot.lotNo)
  if (!key) return []
  const commercial = /commercial/i.test(lot.rawCategory ?? lot.category ?? '')
  const names = new Map((Array.isArray(coco?.categories) ? coco.categories : []).map((category) => [category.id, category.name]))
  const annotations = Array.isArray(coco?.annotations) ? coco.annotations : []
  return annotations.flatMap((annotation, index) => {
    const label = lotKey(names.get(annotation.category_id))
    const matches = label === key || (commercial && label === `c${key}`)
    return matches ? [annotation.id ?? index] : []
  })
}

/**
 * The lots a map label can mean. New commercial rows and map labels both use
 * "C L1". For legacy table rows stored as "L1", a label that matches nothing
 * as written is tried again without its leading C—among commercial lots only,
 * so "C L1" can never land on a residential lot.
 */
export function lotsForLabel(label, lotsByKey) {
  const key = lotKey(label)
  const exact = lotsByKey.get(key) ?? []
  if (exact.length) return exact
  const commercial = /^c(l\d.*)$/.exec(key)?.[1]
  if (!commercial) return []
  return (lotsByKey.get(commercial) ?? []).filter((lot) => /commercial/i.test(lot.category ?? ''))
}

/**
 * What saving the coloured map would do to the lot table, for review before
 * anything is written.
 *
 * `paints` are the preview's ({ shapeId, status } or { x, y, status }, plus
 * `reserveType` — 'client' or 'company' — on a reserved paint); each
 * annotated lot is matched to a row by its label against `lotsByKey` (from
 * fetchLotsByIdentifier). A clicked area ({ x, y }) counts only once it is
 * linked to a lot by hand — `lot: { id, lotNo }` — and is then matched by that
 * id. Only an unambiguous match with a different status is a change —
 * everything else is listed so the reviewer sees why it was skipped.
 *
 * Returns { changes: [{ id, lotNo, label, from, status, reserveType?, fromReserveType? }], upToDate: [{ label, status }],
 * skipped: [{ label, reason }], mapOnly } — `upToDate` are lots the table already
 * gives the colour's status (and reserve type), so only their map colour is saved.
 * A reserved lot whose reserve type differs is a change even though its status is not.
 * where `mapOnly` counts clicked areas not linked to any lot.
 */
export function planStatusUpdate(shapes, paints, lotsByKey) {
  const labels = new Map(shapes.map((shape) => [shape.id, shape.label]))
  const byId = new Map([...lotsByKey.values()].flat().map((lot) => [lot.id, lot]))
  // The newest paint of each annotated lot, and of each linked lot, wins, as it does on the map.
  const latest = new Map()
  const linked = new Map()
  let mapOnly = 0
  for (const paint of paints) {
    if (paint.shapeId !== undefined) latest.set(paint.shapeId, paint)
    else if (paint.lot?.id !== undefined) {
      linked.delete(paint.lot.id)
      linked.set(paint.lot.id, paint)
    } else mapOnly += 1
  }

  // Annotated lots first, then linked clicks; each resolves to the rows it can mean.
  const entries = [
    ...[...latest].map(([shapeId, paint]) => {
      const label = labels.get(shapeId) ?? `Annotation ${shapeId}`
      return { label, paint, matches: lotsForLabel(label, lotsByKey), missing: 'No lot with this identifier — the color is saved on the map only.' }
    }),
    ...[...linked].map(([id, paint]) => ({
      label: paint.lot.lotNo || `Lot ${id}`,
      paint,
      matches: byId.has(id) ? [byId.get(id)] : [],
      missing: 'This lot is no longer in the table — the color is saved on the map only.',
    })),
  ]

  const changes = []
  const skipped = []
  const upToDate = []
  const claimed = new Map() // lot id → label that set it, so two shapes cannot fight over one lot
  for (const { label, paint, matches, missing } of entries) {
    const { status: fill, reserveType } = paint
    const status = LOT_STATUS_BY_FILL[fill]
    if (!status) {
      skipped.push({ label, reason: 'This color has no matching status — the status is not changed.' })
      continue
    }
    if (matches.length === 0) {
      skipped.push({ label, reason: missing })
      continue
    }
    if (matches.length > 1) {
      skipped.push({ label, reason: `${matches.length} lots share this identifier — update it from the table instead.` })
      continue
    }
    const [lot] = matches
    if (claimed.has(lot.id)) {
      skipped.push({ label, reason: `Lot ${lot.lotNo} is already set by "${claimed.get(lot.id)}".` })
      continue
    }
    claimed.set(lot.id, label)
    const from = lot.status.toLowerCase()
    if (status === 'reserved' && reserveType !== undefined) {
      const fromReserveType = lot.reserveType ?? ''
      if (from === status && fromReserveType === reserveType) {
        upToDate.push({ label, status, reserveType })
        continue
      }
      changes.push({ id: lot.id, lotNo: lot.lotNo, label, from: lot.status, status, reserveType, fromReserveType })
      continue
    }
    if (from === status) {
      upToDate.push({ label, status })
      continue
    }
    changes.push({ id: lot.id, lotNo: lot.lotNo, label, from: lot.status, status })
  }
  return { changes, upToDate, skipped, mapOnly }
}
