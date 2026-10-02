// Who sold a lot: a broker or a sales agent, and how that is stored on the lot.
import { salesKey } from '@/data/brokersData'

/** Who can sell a lot. */
export const SELLER_KINDS = [
  { value: 'broker', label: 'Broker' },
  { value: 'sales_agent', label: 'Sales agent' },
]

/**
 * The account a lot's stored seller means. A seller picked from the directory
 * is stored by email, which no two accounts share; a lot saved before that
 * holds a name, which counts only when exactly one account has it — two
 * "Gerald Delima"s are different people. Undefined for an "Other" name.
 */
export function findAccount(accounts, stored) {
  const value = String(stored ?? '').trim()
  if (!value) return undefined
  const byEmail = accounts.find((account) => account.email && account.email.toLowerCase() === value.toLowerCase())
  if (byEmail) return byEmail
  const named = accounts.filter((account) => salesKey(account.name) === salesKey(value))
  return named.length === 1 ? named[0] : undefined
}

/**
 * A lot's seller as SellerPicker holds it — { kind: 'broker' | 'sales_agent' |
 * '', name } — from the lot's `soldBy` (a broker) or `salesAgent`. `name` is
 * what is stored: an account's email, or an "Other" name.
 */
export function sellerOf(lot) {
  if (lot?.soldBy) return { kind: 'broker', name: lot.soldBy }
  if (lot?.salesAgent) return { kind: 'sales_agent', name: lot.salesAgent }
  return { kind: '', name: '' }
}

/**
 * The lot fields for a seller: a broker goes in `soldBy`, a sales agent in
 * `salesAgent`, and the other is cleared, so a sale is credited on exactly one
 * of the Brokers and Sales Agents pages.
 */
export function sellerFields(seller) {
  const name = String(seller?.name ?? '').trim()
  return { soldBy: seller?.kind === 'broker' ? name : '', salesAgent: seller?.kind === 'sales_agent' ? name : '' }
}
