/*
 * Edit conflicts: a save that would overwrite a change someone else made after
 * this user opened the record.
 *
 * Each record's `updated_at` (set by every portal write) is its version. A save
 * passes the version it started from; `unlessChanged` makes the write match the
 * row only while it is still that version, so the check and the write are one
 * statement and two people saving at the same moment cannot both win. When the
 * guarded write matches nothing, `conflictFor` tells a conflict apart from a
 * write row-level security refused.
 */
import { supabase } from './supabase'

export class EditConflictError extends Error {
  constructor(message, { deleted = false } = {}) {
    super(message)
    this.name = 'EditConflictError'
    // True when the row is gone, so saving anyway is impossible.
    this.deleted = deleted
  }
}

export const isEditConflict = (err) => err instanceof EditConflictError

/** `request` (an update) limited to the row as it was at `version`; unchanged when there is no version to check. */
export function unlessChanged(request, version, column = 'updated_at') {
  return version ? request.eq(column, version) : request
}

/** Whether version `a` is later than `b` — a live refresh brought someone else's newer save. */
export function isNewer(a, b) {
  if (!a || !b) return false
  const [x, y] = [Date.parse(a), Date.parse(b)]
  return !Number.isNaN(x) && !Number.isNaN(y) && x > y
}

/** Two `updated_at` values as the same instant, whatever their formatting. */
function sameInstant(a, b) {
  if (a === b) return true
  const [x, y] = [Date.parse(a), Date.parse(b)]
  return !Number.isNaN(x) && x === y
}

/**
 * After a guarded write matched no row: an EditConflictError naming `what`
 * ("Lot B1 L2") when the row was changed or deleted since `version`, or null
 * when it was not (so the caller reports its usual refusal).
 */
export async function conflictFor(table, id, version, what, column = 'updated_at') {
  if (!version || !supabase) return null
  const { data, error } = await supabase.from(table).select(column).eq('id', id).maybeSingle()
  if (error) return null
  if (!data) return new EditConflictError(`${what} was deleted by someone else while you were working on it.`, { deleted: true })
  if (!sameInstant(data[column], version)) {
    return new EditConflictError(`${what} was changed by someone else while you were working on it.`)
  }
  return null
}
