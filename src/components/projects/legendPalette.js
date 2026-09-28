/*
 * The colour each status paints a lot. The defaults are the VHBC legend
 * (MAP_LOT_FILL); a map whose legend was printed in other shades can have its
 * own, read off the legend on the picture and remembered per map in this
 * browser, so the next round of colouring that map starts from them.
 */
import { MAP_LOT_FILL } from '@/theme/colors'

export const DEFAULT_PALETTE = Object.freeze(Object.fromEntries(MAP_LOT_FILL.map(({ value, color }) => [value, color])))

const STORAGE_PREFIX = 'vhbc.legendPalette:'
const HEX = /^#[0-9A-F]{6}$/i

/** Whether `palette` is the defaults, colour for colour. */
export function isDefaultPalette(palette) {
  return MAP_LOT_FILL.every(({ value, color }) => palette[value]?.toUpperCase() === color.toUpperCase())
}

/** The palette saved for `key` (a map's name), or the defaults — unknown or malformed entries fall back one by one. */
export function loadPalette(key) {
  if (!key) return DEFAULT_PALETTE
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + key) ?? 'null')
    if (!saved || typeof saved !== 'object') return DEFAULT_PALETTE
    return Object.fromEntries(
      MAP_LOT_FILL.map(({ value, color }) => [value, HEX.test(saved[value] ?? '') ? saved[value].toUpperCase() : color]),
    )
  } catch {
    return DEFAULT_PALETTE
  }
}

/** Remember `palette` for `key`; the defaults are stored as nothing at all. */
export function savePalette(key, palette) {
  if (!key) return
  try {
    if (isDefaultPalette(palette)) window.localStorage.removeItem(STORAGE_PREFIX + key)
    else window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(palette))
  } catch {
    // Storage blocked (private window, previews): the palette still applies for this session.
  }
}

/** Hue (0–360), saturation and value (0–1) as '#RRGGBB'. */
export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return `#${[f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

/** '#RRGGBB' as { h (0–360), s, v (0–1) }; null for anything else. */
export function hexToHsv(hex) {
  if (!HEX.test(hex ?? '')) return null
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
  }
  return { h, s: max ? d / max : 0, v: max }
}
