/*
 * The colours Color lots paints each status with, saved per project map in
 * `map_legend_colors` (20261019_create_map_legend_colors.sql) so every user and
 * browser colours a map the same way. A map is its project plus its map tab
 * (`slot`); the tab's phase and section are stored alongside, so the table can
 * be grouped by project and phase. A map with no row uses the default colours.
 */
import { supabase, unwrap } from './supabase'
import { parseSlot } from './annotatedImagesData'
import { MAP_LOT_FILL } from '@/theme/colors'
import { isDefaultPalette } from '@/components/projects/legendPalette'

const TABLE = 'map_legend_colors'
const HEX = /^#[0-9A-F]{6}$/

/** The palette ({ sold: '#RRGGBB', ... }) as the table's columns. */
export function paletteToRow(palette) {
  return Object.fromEntries(MAP_LOT_FILL.map(({ value, color }) => [`${value}_color`, String(palette[value] ?? color).toUpperCase()]))
}

/** A row's colours as a palette; a missing or malformed colour falls back to its default. */
export function rowToPalette(row) {
  return Object.fromEntries(
    MAP_LOT_FILL.map(({ value, color }) => {
      const stored = String(row?.[`${value}_color`] ?? '').toUpperCase()
      return [value, HEX.test(stored) ? stored : color]
    }),
  )
}

/**
 * The saved palette for one project map, or null when it has none — or when
 * there is no database or table to read, so the caller keeps what it has.
 */
export async function fetchLegendColors({ projectCode, slot }) {
  if (!supabase || !projectCode || !slot) return null
  const columns = MAP_LOT_FILL.map(({ value }) => `${value}_color`).join(', ')
  const { data } = unwrap(await supabase.from(TABLE).select(columns).eq('project', projectCode).eq('slot', slot).limit(1))
  return data[0] ? rowToPalette(data[0]) : null
}

/**
 * A saved row as one map's colours: its tab (`slot`), phase and section, and
 * palette — what Edit colors lists so another phase's colours can be reused.
 */
export function rowToMapColors(row) {
  return {
    slot: String(row?.slot ?? ''),
    phase: Number.isInteger(row?.phase) ? row.phase : null,
    section: row?.map_section || null,
    palette: rowToPalette(row),
  }
}

/**
 * Every map of the project that has its own colours, by phase then section
 * ([] with no database), so one phase's colours can be picked for another.
 */
export async function fetchProjectLegendColors(projectCode) {
  if (!supabase || !projectCode) return []
  const columns = ['slot', 'phase', 'map_section', ...MAP_LOT_FILL.map(({ value }) => `${value}_color`)].join(', ')
  const { data } = unwrap(
    await supabase
      .from(TABLE)
      .select(columns)
      .eq('project', projectCode)
      .order('phase', { ascending: true, nullsFirst: true })
      .order('map_section', { ascending: true, nullsFirst: true }),
  )
  return data.map(rowToMapColors)
}

/**
 * Save one project map's palette, replacing what it had. The default colours
 * are saved as no row at all, so the map simply follows the defaults.
 */
export async function saveLegendColors({ projectCode, slot, palette }) {
  if (!supabase) throw new Error('No database connected.')
  if (!projectCode || !slot) throw new Error('This map has no project or map tab to save its colors under.')
  if (isDefaultPalette(palette)) {
    unwrap(await supabase.from(TABLE).delete().eq('project', projectCode).eq('slot', slot))
    return
  }
  const { phase, section } = parseSlot(slot)
  unwrap(
    await supabase.from(TABLE).upsert(
      {
        project: projectCode,
        slot,
        phase,
        map_section: section,
        ...paletteToRow(palette),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project,slot' },
    ),
  )
}
