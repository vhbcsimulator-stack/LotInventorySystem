/*
 * The colour each status paints a lot. The defaults are the BHRI legend
 * (MAP_LOT_FILL); a map whose legend was printed in other shades can have its
 * own, read off the legend on the picture and remembered per map in this
 * browser, so the next round of colouring that map starts from them.
 */
import { MAP_LOT_FILL } from '@/theme/colors'

export const DEFAULT_PALETTE = Object.freeze(Object.fromEntries(MAP_LOT_FILL.map(({ value, color }) => [value, color])))

const STORAGE_PREFIX = 'bhri.legendPalette:'
// Where colours were remembered before the rename to BHRI; still read, never written.
const LEGACY_STORAGE_PREFIX = 'vhbc.legendPalette:'
const HEX = /^#[0-9A-F]{6}$/i

/** Whether `palette` is the defaults, colour for colour. */
export function isDefaultPalette(palette) {
  return samePalette(palette, DEFAULT_PALETTE)
}

/** Whether two palettes paint every status the same colour (case aside). */
export function samePalette(a, b) {
  return MAP_LOT_FILL.every(({ value }) => Boolean(a?.[value]) && a[value].toUpperCase() === b?.[value]?.toUpperCase())
}

/** The palette saved for `key` (a map's name), or the defaults — unknown or malformed entries fall back one by one. */
export function loadPalette(key) {
  if (!key) return DEFAULT_PALETTE
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + key) ?? window.localStorage.getItem(LEGACY_STORAGE_PREFIX + key)
    const saved = JSON.parse(stored ?? 'null')
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
    window.localStorage.removeItem(LEGACY_STORAGE_PREFIX + key)
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

/**
 * A colour typed by hand as '#RRGGBB', or null when it is not one: a hex code
 * with or without '#', in six digits or three ('#FA0'), or red, green and blue
 * from 0 to 255 — 'rgb(250, 170, 0)' or just '250, 170, 0'.
 */
export function parseColorCode(input) {
  const code = String(input ?? '').trim()
  const hex = code.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1]
    return `#${digits.toUpperCase()}`
  }
  const rgb = code.match(/^(?:rgb\s*\(\s*)?(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)?$/i)
  if (!rgb) return null
  const channels = rgb.slice(1).map(Number)
  if (channels.some((channel) => channel > 255)) return null
  return rgbToHex(channels)
}

/** '#RRGGBB' as [r, g, b] (0–255 each); null for anything else. */
export function hexToRgb(hex) {
  if (!HEX.test(hex ?? '')) return null
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

/** [r, g, b] (0–255 each) as '#RRGGBB'. */
export function rgbToHex(rgb) {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`
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
