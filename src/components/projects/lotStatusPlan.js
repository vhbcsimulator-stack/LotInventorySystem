import { lotKey } from '@/data/projectsData'

/**
 * The lot-table status each map colour stands for. Prime (yellow) and open are
 * both unsold lots — prime only marks the premium ones — so both mean available.
 */
export const LOT_STATUS_BY_FILL = { sold: 'sold', reserved: 'reserved', hold: 'hold', open: 'available', prime: 'available' }

/**
 * The lots a map label can mean. The map writes a commercial lot as "C L1",
 * while the table stores it as "L1" with a commercial category, so a label
 * that matches nothing as written is tried again without its leading C —
 * among commercial lots only, so "C L1" can never land on a residential lot.
 */
function lotsForLabel(label, lotsByKey) {
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
 * `paints` are the preview's ({ shapeId, status } or { x, y, status }); each
 * annotated lot is matched to a row by its label against `lotsByKey` (from
 * fetchLotsByIdentifier). Only an unambiguous match with a different status is
 * a change — everything else is listed so the reviewer sees why it was skipped.
 *
 * Returns { changes: [{ id, lotNo, label, from, status }], skipped: [{ label, reason }], mapOnly }
 * where `mapOnly` counts areas coloured by clicking outside every annotation.
 */
export function planStatusUpdate(shapes, paints, lotsByKey) {
  const labels = new Map(shapes.map((shape) => [shape.id, shape.label]))
  // The newest paint of each annotated lot wins, as it does on the map.
  const latest = new Map()
  let mapOnly = 0
  for (const paint of paints) {
    if (paint.shapeId === undefined) mapOnly += 1
    else latest.set(paint.shapeId, paint.status)
  }

  const changes = []
  const skipped = []
  const claimed = new Map() // lot id → label that set it, so two shapes cannot fight over one lot
  for (const [shapeId, fill] of latest) {
    const label = labels.get(shapeId) ?? `Annotation ${shapeId}`
    const status = LOT_STATUS_BY_FILL[fill]
    if (!status) {
      skipped.push({ label, reason: 'This color has no matching status — the status is not changed.' })
      continue
    }
    const matches = lotsForLabel(label, lotsByKey)
    if (matches.length === 0) {
      skipped.push({ label, reason: 'No lot with this identifier — the color is saved on the map only.' })
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
    if (lot.status.toLowerCase() === status) {
      skipped.push({ label, reason: `Already ${status}.` })
      continue
    }
    changes.push({ id: lot.id, lotNo: lot.lotNo, label, from: lot.status, status })
  }
  return { changes, skipped, mapOnly }
}
