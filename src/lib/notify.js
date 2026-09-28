import { toaster } from '@/components/ui/toaster'

/*
 * Toasts for database writes. Call once per user action, where it finishes — not
 * inside the data layer, where one action can make several writes.
 */

/** A write that went through: `title` says what changed, `description` any detail. */
export function notifySaved(title, description) {
  toaster.create({ type: 'success', title, description, duration: 4000, closable: true })
}

/** A write that failed: `title` says what did not happen, `err` why. */
export function notifyFailed(title, err) {
  toaster.create({ type: 'error', title, description: err?.message ?? String(err ?? ''), duration: 7000, closable: true })
}

/** A write that partly went through, e.g. a map saved but some lots kept their status. */
export function notifyWarning(title, description) {
  toaster.create({ type: 'warning', title, description, duration: 7000, closable: true })
}
