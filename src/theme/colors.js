/*
 * Shared palette. Lives here rather than in the Chakra theme because the app
 * still uses `defaultSystem` — fold these into a custom system when one exists.
 */
export const COLORS = {
  surface: '#FFFFFF',
  canvas: '#F7F8FA',
  border: '#E4E8EE',
  brandGreen: '#00652C',
  heading: '#0B1C30',
  muted: '#3F493F',
  subtle: '#6B7280',
  activeBg: '#1D4ED8',
  activeFg: '#FFFFFF',
  danger: '#BA1A1A',
  statusBg: '#E5EEFF',
  hoverBg: '#F2F5F9',
}

/*
 * Chart palette. `sold` + `reserved` are the two categorical series and were
 * validated together (lightness band, chroma floor, CVD separation, normal-vision
 * floor, contrast >= 3:1 — all pass). `available` is deliberately NOT a third
 * series: it is the unfilled remainder of a total, so it stays a neutral track
 * and is always directly labeled with its value and share.
 */
export const CHART = {
  sold: '#00652C',
  reserved: '#1D4ED8',
  available: '#CBD5E1',
  target: '#94A3B8',
  areaFrom: 'rgba(0, 101, 44, 0.18)',
  areaTo: 'rgba(0, 101, 44, 0.00)',
  grid: '#EDF0F4',
  axis: '#8A94A6',
}

/*
 * Lot status tokens for tables and inventory counts. These are STATUS colors,
 * not chart series: each always ships with a dot and a text label, so no state
 * is ever conveyed by color alone. `fg` is the text color and must clear WCAG AA
 * (4.5:1) on both white and its own `bg` tint; `dot` is the marker and bar fill.
 */
export const LOT_STATUS = {
  available: { label: 'Available', fg: '#166534', bg: '#E7F6EC', dot: '#16A34A' },
  reserved: { label: 'Reserved', fg: '#92400E', bg: '#FEF3E2', dot: '#F59E0B' },
  sold: { label: 'Sold', fg: '#B91C1C', bg: '#FDECEC', dot: '#DC2626' },
}

export default COLORS

/*
 * Fills for recolouring lots on an uploaded site map, matched to the legend
 * printed on the BHRI maps themselves (SOLD, RESERVED, HOLD, PRIME, OPEN) so a
 * repainted lot reads the same as the ones the designer coloured.
 */
export const MAP_LOT_FILL = [
  { value: 'sold', label: 'Sold', color: '#8CC48A' },
  { value: 'reserved', label: 'Reserved', color: '#5C9DF2' },
  { value: 'hold', label: 'Hold', color: '#F5AC2A' },
  { value: 'prime', label: 'Prime', color: '#F9F6A6' },
  { value: 'open', label: 'Open', color: '#E4EEC6' },
]
