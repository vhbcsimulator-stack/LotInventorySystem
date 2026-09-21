/*
 * CSV import for a project's lot table. Parsing and validation run in the
 * browser so the user sees a full preview (new / updated / errors) before
 * anything is written. Rows are matched to existing lots by lot number + phase:
 * a match is updated, anything else is inserted.
 */
import Papa from 'papaparse'
import { num, text } from './api'
import { fetchAllRows, supabase } from './supabase'
import {
  LOT_STATUS_OPTIONS,
  LOT_TABLES,
  PHASE_CODES,
  SOURCE,
  categoriesFor,
  fetchProjectLots,
  lotTermsFor,
  parsePhaseCode,
} from './projectsData'
import { fetchPriceLookup } from './pricesData'

/** Accepted header spellings (compared lowercase, spaces/dashes/slashes as `_`). */
const HEADER_ALIASES = {
  lot_no: ['lot_no', 'lot_number', 'lot', 'lot_id', 'lot_identifier', 'identifier'],
  phase: ['phase', 'phase_no'],
  category: ['category', 'lot_category', 'type'],
  size_sqm: ['size_sqm', 'size', 'area', 'area_sqm', 'lot_area', 'lot_area_sqm', 'sqm'],
  price_per_sqm: ['price_per_sqm', 'price_sqm', 'price', 'price_per_sq_m'],
  status: ['status', 'lot_status'],
  // The commercial sheets title the agent column "SD/SM/REALTY".
  sold_by: ['sold_by', 'sales_agent', 'agent', 'sd_sm_realty', 'sd_sm_realty_', 'sd_sm', 'realty'],
  year: ['year', 'yr'],
  month: ['month', 'mo'],
  // A full reservation date, which beats YEAR/MONTH when the sheet has one.
  date: ['rsv_date', 'reservation_date', 'date', 'sold_date', 'date_sold'],
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** A month name, abbreviation, or 1-12 as a month number, or null. */
function parseMonthName(value) {
  const raw = text(value).trim().toLowerCase()
  if (!raw) return null
  if (/^\d{1,2}$/.test(raw)) {
    const numeric = Number(raw)
    return numeric >= 1 && numeric <= 12 ? numeric : null
  }
  const index = MONTH_NAMES.findIndex((name) => name === raw || name.slice(0, 3) === raw.slice(0, 3))
  return index === -1 ? null : index + 1
}

/**
 * A whole date cell as YYYY-MM-DD, or null.
 *
 * The sheets write reservation dates by hand in every shape a spreadsheet allows
 * — "March 20 2026", "March 19,2026", "April 02, 2026", "31-May-25", "6/16/2026"
 * — so the month name is read directly rather than left to Date.parse, which
 * reads "31-May-25" differently across browsers. A two-digit year is 20xx: these
 * sheets record current and upcoming sales, never the 1900s.
 */
function parseDateCell(value) {
  const raw = text(value).trim().replace(/[–—]/g, '-')
  if (!raw) return null

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw)
  // The separator before the year is a comma, a space, or (typed in a hurry) both.
  const named = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:\s*,\s*|\s+)(\d{2,4})$/i.exec(raw)
  const dayFirst = /^(\d{1,2})[-\s]([a-z]{3,9})\.?[-\s](\d{2,4})$/i.exec(raw)
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw)

  let year = null
  let month = null
  let day = null
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (named) [month, day, year] = [parseMonthName(named[1]), Number(named[2]), Number(named[3])]
  else if (dayFirst) [day, month, year] = [Number(dayFirst[1]), parseMonthName(dayFirst[2]), Number(dayFirst[3])]
  // Filipino sheets follow US order here: 6/16/2026 is 16 June.
  else if (slashed) [month, day, year] = [Number(slashed[1]), Number(slashed[2]), Number(slashed[3])]
  else return null

  if (year !== null && year < 100) year += 2000
  if (!month || !day || !year || month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2999) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The YEAR and MONTH columns as { date, precision } for `last_updated`.
 *
 * The sheets know the month a lot last moved but never the day, so the date is
 * stored as the first of that month and flagged 'month' so the portal shows
 * "March 2025" rather than inventing a day. A row with neither column filled in
 * mirrors the sheet and clears the date.
 */
function monthYearStamp(record, cell) {
  // A full date column (the commercial sheets' RSV DATE) knows the day, so it is
  // stored as itself rather than rounded back to the first of the month.
  const exact = parseDateCell(cell(record, 'date'))
  if (exact) return { date: exact, precision: null }

  const month = parseMonthName(cell(record, 'month'))
  const year = parseNumber(cell(record, 'year'))
  if (month === null || month < 1 || !Number.isInteger(year) || year < 1900 || year > 2999) {
    return { date: null, precision: null }
  }
  return { date: `${year}-${String(month).padStart(2, '0')}-01`, precision: 'month' }
}

export const CSV_TEMPLATE = [
  'lot_no,phase,category,size_sqm,price_per_sqm,status,sold_by',
  'B1 L1,1,regular,250,,available,',
  'B1 L2,1,prime_corner,320,12500,sold,Juan Dela Cruz',
].join('\n')

const BATCH = 500

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Undo Excel's date auto-conversion of lot numbers.
 *
 * A lot entered as "21-1" through "21-12" is read by Excel as a date and comes
 * back out as "21-Jan".."21-Dec" — which is why such a block runs 21-Jan..21-Dec
 * and then continues correctly at 21-13, there being no thirteenth month.
 *
 * Only a whole cell of exactly that shape is rewritten, so a lot legitimately
 * named "B1 L3" or "12-Block" is left alone.
 */
function repairLotNo(value) {
  const raw = text(value).trim()
  const match = /^(\d+)-([a-z]{3,9})(?:-\d{2,4})?$/i.exec(raw)
  if (!match) return raw
  const month = MONTH_ABBR.indexOf(match[2].slice(0, 3).toLowerCase())
  return month === -1 ? raw : `${match[1]}-${month + 1}`
}

/**
 * Whether a parsed row carries nothing worth importing.
 *
 * Excel hands back trailing rows that look blank on screen but are not empty to
 * a parser: a cell holding a non-breaking space, a zero-width character left by
 * a paste, or a dash in a column the portal does not read. Papa's
 * skipEmptyLines only drops plain whitespace, so such a row used to be validated
 * and reported as three errors against a row the user sees as empty.
 *
 * A row counts as blank when none of the columns the import actually reads has
 * content — deliberately ignoring the sheet's other columns, so a stray mark
 * outside lot number, phase, category, area, price, status, agent or date does
 * not resurrect it.
 */
const BLANKS = /[\s ​-‍﻿]+/g
const isBlankRow = (record, cell) =>
  Object.keys(HEADER_ALIASES).every((field) => cell(record, field).replace(BLANKS, '') === '')

const normalizeHeader = (header) => text(header).trim().toLowerCase().replace(/[\s\-/.]+/g, '_').replace(/[^\w]/g, '')
const normalizeCategory = (value) => text(value).trim().toLowerCase().replace(/[\s-]+/g, '_')
const matchKey = (lotNo, phase) => `${text(lotNo).trim().toLowerCase().replace(/\s+/g, ' ')}|${phase ?? ''}`

function parseNumber(value) {
  const cleaned = text(value).replace(/[₱,\s]/g, '').replace(/sqm$/i, '')
  return cleaned === '' ? null : num(cleaned, NaN)
}

/**
 * Words the sales sheets use for a status the portal already has. Matched on the
 * whole cell, so "RSV-P" is untouched here and still reads as Reserved (Pending)
 * through its own stored value.
 */
const STATUS_SPELLINGS = { open: 'available', rsv: 'reserved' }

function normalizeStatus(value) {
  const spelled = text(value).trim().toLowerCase()
  if (!spelled) return 'available'
  const raw = STATUS_SPELLINGS[spelled] ?? spelled
  const option = LOT_STATUS_OPTIONS.find(
    (item) => item.value === raw || item.label.toLowerCase() === raw || item.label.toLowerCase().replace(/[()]/g, '') === raw,
  )
  return option?.value ?? null
}

function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normalizeHeader,
      complete: resolve,
      error: reject,
    })
  })
}

/**
 * Read and validate a CSV against the project's lot table. Resolves
 * { rows, errors, counts, missingHeaders } where each row carries its
 * `rowNumber` (as seen in a spreadsheet, header = row 1) and, for updates, `id`.
 */
export async function previewLotImport(projectCode, file) {
  if (!supabase) throw new Error('No database connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  const table = LOT_TABLES[projectCode]
  if (!table) throw new Error(`No lot table is set up for ${projectCode}.`)
  if (!file) throw new Error('Choose a CSV file.')

  const parsed = await parseCsv(file)
  const headers = parsed.meta.fields ?? []
  const column = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, aliases.find((alias) => headers.includes(alias))]),
  )
  const terms = lotTermsFor(projectCode)
  /*
   * Projects whose lots are not grouped (ERHD) need no phase column for grouping —
   * but when the project encodes its category there (CATEGORY_FROM_PHASE) the
   * column is required for that instead, and the category column becomes optional.
   */
  // The category is read out of the phase cell itself, so no category column of
  // its own has to be present.
  const derivesCategory = Boolean(PHASE_CODES[projectCode])
  const missingHeaders = [
    'lot_no',
    ...(terms.group || derivesCategory ? ['phase'] : []),
    ...(derivesCategory ? [] : ['category']),
    'size_sqm',
  ].filter((field) => !column[field])
  if (missingHeaders.length) return { rows: [], errors: [], counts: { total: 0, insert: 0, update: 0 }, missingHeaders }

  const [existing, priceFor] = await Promise.all([
    fetchAllRows(table, 'id, lot_no, phase, category'),
    fetchPriceLookup(projectCode),
  ])
  const idByKey = new Map(existing.map((lot) => [matchKey(lot.lot_no, lot.phase), lot.id]))
  // Categories already in the table plus the ones this project offers, so a valid
  // category that no lot happens to use yet is not rejected as unknown.
  const knownCategories = new Set(
    [...existing.map((lot) => lot.category), ...categoriesFor(projectCode)].map(normalizeCategory).filter(Boolean),
  )

  const cell = (record, field) => (column[field] ? text(record[column[field]]).trim() : '')
  const rows = []
  const errors = []
  const seen = new Map()

  let blank = 0

  parsed.data.forEach((record, index) => {
    const rowNumber = index + 2
    const problems = []

    // An empty trailing row from Excel is skipped, not reported as errors.
    if (isBlankRow(record, cell)) {
      blank += 1
      return
    }

    const lotNo = repairLotNo(cell(record, 'lot_no'))
    if (!lotNo) problems.push('lot number is empty')

    const phaseCell = cell(record, 'phase')
    // A coded phase (MVLC's "MV-C-1A") gives the number; otherwise it is read as one.
    const coded = parsePhaseCode(projectCode, phaseCell)
    const phase = terms.group ? (coded.phase ?? parseNumber(phaseCell.replace(/^(phase|tower)\s*/i, ''))) : null
    if (phase !== null && !(Number.isInteger(phase) && phase > 0)) {
      problems.push(`${terms.group.toLowerCase()} "${phaseCell}" is not a whole number`)
    }

    // A category column always wins; otherwise it is read out of the phase cell.
    const category = normalizeCategory(cell(record, 'category')) || coded.category
    if (!category) problems.push(derivesCategory ? `no category could be read from "${phaseCell}"` : 'category is empty')
    else if (knownCategories.size && !knownCategories.has(category)) {
      problems.push(`unknown category "${cell(record, 'category')}" (use: ${[...knownCategories].sort().join(', ')})`)
    }

    const sizeSqm = parseNumber(cell(record, 'size_sqm'))
    if (!(Number.isFinite(sizeSqm) && sizeSqm > 0)) problems.push('lot area must be a number greater than 0')

    const csvPrice = parseNumber(cell(record, 'price_per_sqm'))
    if (csvPrice !== null && !(Number.isFinite(csvPrice) && csvPrice > 0)) problems.push('price per sqm must be a number greater than 0')
    // An ungrouped project (ERHD) prices every lot from a single row, so its null
    // phase is a valid lookup rather than a reason to skip the price table.
    const pricePerSqm =
      csvPrice ?? (category && (phase === null || Number.isInteger(phase)) ? priceFor(phase, category) : null) ?? null
    if (pricePerSqm === null && category) {
      problems.push(`no price per sqm given and none set for ${phase === null ? 'this project' : `${terms.group} ${phase}`} ${category}`)
    }

    const status = normalizeStatus(cell(record, 'status'))
    if (!status) problems.push(`unknown status "${cell(record, 'status')}" (use: ${LOT_STATUS_OPTIONS.map((o) => o.value).join(', ')})`)

    /*
     * The sales sheets keep agent names in columns of their own that the portal
     * does not store, so a sold row needs no agent here. A blank one is left out
     * of the write entirely (see toColumns), which keeps any agent already
     * recorded in the portal rather than clearing it.
     */
    const soldBy = cell(record, 'sold_by')

    const key = matchKey(lotNo, phase)
    if (lotNo && seen.has(key)) problems.push(`duplicate of row ${seen.get(key)} (same lot number and phase)`)
    else if (lotNo) seen.set(key, rowNumber)

    if (problems.length) {
      errors.push({ rowNumber, lotNo, problems })
      return
    }

    rows.push({
      rowNumber,
      id: idByKey.get(key) ?? null,
      lot_no: lotNo,
      phase,
      category,
      size_sqm: sizeSqm,
      price_per_sqm: pricePerSqm,
      total: Math.round(sizeSqm * pricePerSqm * 100) / 100,
      status,
      sold_by: soldBy || null,
      ...monthYearStamp(record, cell),
    })
  })

  const update = rows.filter((row) => row.id !== null).length
  // `total` counts the rows the file actually offered, so skipped blank rows do
  // not show up as a gap between the total and what is added plus updated.
  return {
    rows,
    errors,
    counts: { total: parsed.data.length - blank, insert: rows.length - update, update },
    missingHeaders: [],
  }
}

/**
 * Write validated rows: new lots are inserted and matched lots updated, in
 * batches. `onProgress(done, total)` reports rows written so far. Resolves
 * { inserted, updated }; throws on the first failed batch with how far it got.
 */
export async function commitLotImport(projectCode, rows, onProgress = () => {}) {
  const table = LOT_TABLES[projectCode]
  if (!supabase || !table) throw new Error(`No lot table is set up for ${projectCode}.`)

  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) throw new Error('Sign in to import lots.')

  /*
   * `updated_at` records when the row was actually written, which is now. The
   * business-facing `last_updated` comes from the sheet's YEAR/MONTH instead, so
   * importing a master sheet does not make every lot look edited today.
   */
  const now = new Date()
  const stamp = { updated_at: now.toISOString() }
  const toColumns = (row) => ({
    lot_no: row.lot_no,
    phase: row.phase,
    category: row.category,
    size_sqm: row.size_sqm,
    price_per_sqm: row.price_per_sqm,
    // `total` is generated by the database from size_sqm * price_per_sqm.
    status: row.status,
    // Left out when the file named no agent, so the stored one survives the import.
    ...(row.sold_by ? { sold_by: row.sold_by } : {}),
    last_updated: row.date,
    last_updated_precision: row.precision,
    ...stamp,
  })

  const inserts = rows.filter((row) => row.id === null).map((row) => ({ ...toColumns(row), user_id: auth.user.id }))
  const updates = rows.filter((row) => row.id !== null).map((row) => ({ id: row.id, ...toColumns(row) }))
  const total = inserts.length + updates.length
  let done = 0
  let inserted = 0
  let updated = 0

  /*
   * A column the database has not been given yet reads as an opaque "schema
   * cache" error, so the migration that adds it is named in the message instead
   * of leaving the file to be hunted down.
   */
  const COLUMN_MIGRATIONS = {
    sold_by: '20260915_add_lots_sold_by.sql',
    last_updated_precision: '20260916_add_lot_last_updated_precision.sql',
    unit_type: '20260916_add_mscc_unit_columns.sql',
    floor_level: '20260916_add_mscc_unit_columns.sql',
    unit_view: '20260916_add_mscc_unit_columns.sql',
    end_unit: '20260916_add_mscc_unit_columns.sql',
  }
  const migrationHint = (message) => {
    const column = Object.keys(COLUMN_MIGRATIONS).find((name) => message.includes(name))
    return column ? ` — run supabase/migrations/${COLUMN_MIGRATIONS[column]} in the Supabase SQL Editor first.` : ''
  }

  const fail = (what, err) =>
    new Error(
      `${what} failed after ${inserted} added and ${updated} updated: ${err.message}${migrationHint(err.message)}`,
      { cause: err },
    )
  const notAccepted = new Error('the database did not accept every row — you may need to sign in')

  for (let i = 0; i < inserts.length; i += BATCH) {
    const batch = inserts.slice(i, i + BATCH)
    const { data, error } = await supabase.from(table).insert(batch).select('id')
    if (error) throw fail('Adding new lots', error)
    if ((data?.length ?? 0) < batch.length) throw fail('Adding new lots', notAccepted)
    inserted += batch.length
    done += batch.length
    onProgress(done, total)
  }

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH)
    const { data, error } = await supabase.from(table).upsert(batch, { onConflict: 'id' }).select('id')
    if (error) throw fail('Updating existing lots', error)
    if ((data?.length ?? 0) < batch.length) throw fail('Updating existing lots', notAccepted)
    updated += batch.length
    done += batch.length
    onProgress(done, total)
  }

  return { inserted, updated }
}

/**
 * Every lot matching the table's search, filters, and sort — across all pages —
 * as CSV in the import format, so an exported file can be edited and imported
 * back. MSCC also gets its unit columns, which the importer ignores.
 * Resolves { csv, count, fileName }.
 */
export async function exportLotsCsv(query) {
  const { lots, project, terms, source, hasLotTable } = await fetchProjectLots({
    ...query,
    page: 1,
    pageSize: Number.MAX_SAFE_INTEGER,
  })
  if (source === SOURCE.NOT_CONFIGURED) throw new Error('No database connected.')
  if (source !== SOURCE.DATABASE) throw new Error('The database could not be reached.')
  const unit = (terms ?? lotTermsFor(project.code)).item.toLowerCase()
  if (!hasLotTable) throw new Error(`${project.name || 'This project'} has no ${unit} table set up.`)

  const unitFields = (terms ?? lotTermsFor(project.code)).unitFields ?? []
  const csv = Papa.unparse({
    fields: [
      'lot_no',
      'phase',
      'category',
      'size_sqm',
      'price_per_sqm',
      'total',
      'status',
      'sold_by',
      ...unitFields.map((field) => field.column),
    ],
    data: lots.map((lot) => [
      lot.lotNo,
      lot.phaseNo ?? '',
      lot.rawCategory,
      lot.areaSqm,
      lot.pricePerSqm,
      lot.tcp,
      lot.rawStatus,
      lot.soldBy,
      ...unitFields.map((field) => lot[field.key] ?? ''),
    ]),
  })

  const date = new Date().toISOString().slice(0, 10)
  return { csv, count: lots.length, fileName: `${project.code || 'project'}-${unit}s-${date}.csv` }
}
