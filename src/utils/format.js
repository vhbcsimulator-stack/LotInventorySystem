/*
 * Presentation helpers. The data layer returns raw numbers and ISO dates; all
 * currency/date shaping happens here so it stays consistent across widgets.
 */

const PESO = '₱'

/** ₱85,000,000.00 */
export function formatPeso(value, { decimals = 2 } = {}) {
  if (value == null || Number.isNaN(value)) return '—'
  return (
    PESO +
    value.toLocaleString('en-PH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  )
}

function trim(n, decimals) {
  // With 1 decimal: 8.5 stays 8.5, 9.0 becomes 9.
  return Number(n.toFixed(decimals)).toString()
}

/** ₱48.5M — for tight spots like KPI sublines and axis ticks. */
export function formatPesoCompact(value, { decimals = 1 } = {}) {
  if (value == null || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${PESO}${trim(value / 1_000_000_000, decimals)}B`
  if (abs >= 1_000_000) return `${PESO}${trim(value / 1_000_000, decimals)}M`
  if (abs >= 1_000) return `${PESO}${trim(value / 1_000, decimals)}K`
  return PESO + value.toLocaleString('en-PH')
}

export function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString('en-PH')
}

/** 14.2 -> "+14.2%" (sign only when asked). */
export function formatPct(value, { signed = false, decimals = 1 } = {}) {
  if (value == null || Number.isNaN(value)) return '—'
  const sign = signed && value > 0 ? '+' : ''
  return `${sign}${Number(value.toFixed(decimals))}%`
}

/**
 * '2025-10-20' or '2025-10-20T05:11:14+00:00' -> 'Oct 20, 2025'
 *
 * `precision: 'month'` drops the day and spells the month out — 'March 2025' —
 * for dates that came from a source knowing only the month, where the stored day
 * is a placeholder rather than a fact. Omitting it keeps the full date.
 */
export function formatDate(iso, { precision = 'day' } = {}) {
  if (!iso) return '—'
  // Only the calendar date is shown, so a timestamp's time and zone are dropped.
  const date = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', {
    month: precision === 'month' ? 'long' : 'short',
    ...(precision === 'month' ? {} : { day: 'numeric' }),
    year: 'numeric',
  })
}
