/*
 * CSV import for a project's lot table. Parsing and validation run in the
 * browser so the user sees a full preview (new / updated / errors) before
 * anything is written. Rows are matched to existing lots by lot number + phase:
 * a match is updated, anything else is inserted.
 */
import Papa from 'papaparse'
import { num, text } from './api'
import { fetchAllRows, supabase } from './supabase'
import { checkUpload } from '@/lib/uploadRules'
import {
  LOT_STATUS_OPTIONS,
  LOT_TABLES,
  PHASE_CODES,
  SOURCE,
  categoriesFor,
  fetchProjectLots,
  formatLotIdentifier,
  isLotIdentifierValid,
  lotTermsFor,
  parsePhaseCode,
  CATEGORY_CODES,
  CATEGORIES_BY_PROJECT,
} from './projectsData'
import { fetchPriceLookup } from './pricesData'

/** Accepted header spellings (compared lowercase, spaces/dashes/slashes as `_`). */
const HEADER_ALIASES = {
  // MSCC's status sheet calls its units UNIT and its towers BUILDING.
  lot_no: ['lot_no', 'lot_number', 'lot', 'lot_id', 'lot_identifier', 'identifier', 'unit', 'unit_no', 'unit_number'],
  phase: ['phase', 'phase_no', 'building', 'tower', 'tower_no'],
  category: ['category', 'lot_category', 'type'],
  size_sqm: ['size_sqm', 'size', 'area', 'area_sqm', 'lot_area', 'lot_area_sqm', 'sqm'],
  // No price column: a lot's price per sqm always comes from the project's
  // category prices in the database (one per category, edited under Category
  // prices), so a price in the file is ignored.
  status: ['status', 'lot_status'],
  // Reservation sheets identify either "Company" or the client's name here; the
  // sales sheets name the buyer of a sold lot in the same column.
  client: ['client', 'client_name', 'buyer', 'buyer_name', 'reserved_for', 'reservee', 'customer', 'customer_name'],
  // Cash or installment. Not "type", which already means category.
  payment_type: [
    'payment_type',
    'payment',
    'payment_terms',
    'payment_scheme',
    'payment_mode',
    'mode_of_payment',
    'mop',
    'terms',
    'cash_installment',
    'cash_or_installment',
  ],
  // Contract to Sell or Deed of Absolute Sale; "CTS/DOAS" normalizes to cts_doas.
  contract_type: ['contract_type', 'cts_doas', 'doas_cts', 'cts_or_doas', 'contract', 'document', 'document_type', 'doc_type'],
  // The commercial sheets title the agent column "SD/SM/REALTY".
  // MSCC's FLOOR column ("2F (2 BR)") carries the unit's bedrooms, its category.
  unit_type: ['floor', 'unit_type', 'floor_unit_type', 'bedrooms'],
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
  'lot_no,phase,category,size_sqm,status,client,payment_type,cts_doas,sold_by',
  'B1 L1,1,regular,250,available,,,,',
  'B1 L2,1,prime_corner,320,RSV,Juan Dela Cruz,installment,CTS,',
  'B1 L3,1,regular,250,sold,Maria Santos,cash,DOAS,Ana Reyes',
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

/**
 * The bedroom category in an MSCC FLOOR or unit type cell: "2F (1 BR)" -> 1_bedroom,
 * "2 Bedroom" -> 2_bedroom, "2F (2 BR DELUXE)" or the clipped "2F (2 BR-DE" ->
 * 2_bedroom_deluxe. '' when the cell names no bedrooms.
 */
export function bedroomCategory(value) {
  const match = /(\d+)\s*(?:BR|BED\s*ROOMS?)\b(.*)$/i.exec(text(value))
  if (!match) return ''
  return `${Number(match[1])}_bedroom${/(^|[^A-Z])DE/i.test(match[2]) ? '_deluxe' : ''}`
}

/** The floor outside the parentheses of an MSCC FLOOR cell: "2F (2 BR)" -> "2nd Floor"; '' when none. */
export function floorLevelFromCell(value) {
  const outside = text(value).replace(/\(.*$/, '')
  const match = /(\d+)\s*(?:ST|ND|RD|TH)?\s*(?:F|FL|FLR|FLOOR)\b/i.exec(outside)
  if (!match) return ''
  const floor = Number(match[1])
  const suffix = floor % 100 >= 11 && floor % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[floor % 10] ?? 'th')
  return `${floor}${suffix} Floor`
}

/** A bedroom category as the unit type label the form uses: 2_bedroom_deluxe -> "2 Bedroom Deluxe". */
const unitTypeLabel = (category) => category.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')

const normalizeCategory = (value) => text(value).trim().toLowerCase().replace(/[\s-]+/g, '_')
const matchKey = (lotNo, phase, section = '') =>
  `${text(lotNo).trim().toLowerCase().replace(/\s+/g, ' ')}|${phase ?? ''}|${text(section).toLowerCase()}`
const phaseDisplay = (phase, section, group = 'Phase') =>
  phase === null ? '—' : `${group} ${phase}${section ? (section === 'East' ? ' East' : section) : ''}`

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

/**
 * Reservation metadata encoded by the sales sheet's status and Client column.
 *
 * An RSV row records who the lot is held for. A sold row records its buyer: the
 * name goes in `reserved_for` with no reserve type, the same as a client-reserved
 * lot that is later marked sold in the portal. Company holds on a sold row are
 * not buyers and are dropped. Every other status carries no client.
 */
export function reservationFromCsv(statusValue, clientValue) {
  const status = text(statusValue).trim()
  const client = text(clientValue).trim()
  // "DD" / "MSD" (optionally followed by "RESERVED") are company holds, not client
  // names, but on an RSV row the sheet's label is kept so the lot still shows which one.
  const companyHold = client.match(/^(dd|msd)(?:\s+reserved)?$/i)
  const isCompany = /^company$/i.test(client) || Boolean(companyHold)

  if (normalizeStatus(status) === 'sold') {
    return { reserve_type: null, reserved_for: client && !isCompany ? client : null }
  }
  if (!/^rsv(?:\b|[-_])/i.test(status)) return { reserve_type: null, reserved_for: null }

  if (!client) return { reserve_type: null, reserved_for: null }
  if (companyHold) return { reserve_type: 'company', reserved_for: companyHold[1].toUpperCase() }
  if (isCompany) return { reserve_type: 'company', reserved_for: null }
  return { reserve_type: 'client', reserved_for: client }
}

/**
 * The sheet's payment cell as 'cash' or 'installment', null when blank, or
 * undefined when it says something else. The sheets write it many ways: CASH,
 * Spot Cash, Full; INSTALLMENT, Inst., In-house, Bank Financing, Pag-IBIG, IPP.
 */
export function paymentTypeFromCsv(value) {
  const raw = text(value).trim().toLowerCase()
  if (!raw) return null
  if (/^(cash|csh|spot|full)\b|spot\s*cash|full\s*(cash|payment)/.test(raw)) return 'cash'
  // ^inst covers the sheets' shorthand: INST, INSTL, INSTLMT, INSTALLMENT.
  if (/install|^inst|^ipp\b|in[\s-]?house|financ|pag[\s-]?ibig|monthly|amort|deferred/.test(raw)) return 'installment'
  return undefined
}

/**
 * The sheet's CTS/DOAS cell as 'cts' (Contract to Sell) or 'doas' (Deed of
 * Absolute Sale), null when blank (shown as Unknown), or undefined when it says
 * something else.
 */
export function contractTypeFromCsv(value) {
  const raw = text(value).trim().toLowerCase()
  if (!raw) return null
  if (/^cts\b|contract\s*to\s*sell/.test(raw)) return 'cts'
  if (/^doas\b|^das\b|deed\s*of\s*(absolute\s*)?sale/.test(raw)) return 'doas'
  return undefined
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
  await checkUpload('csv', file)

  const parsed = await parseCsv(file)
  const headers = parsed.meta.fields ?? []
  const column = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, aliases.find((alias) => headers.includes(alias))]),
  )
  const terms = lotTermsFor(projectCode)
  /*
   * Projects whose lots are not grouped (ERHD) need no phase column for grouping —
   * but the category can be encoded there instead of in a column of its own: a
   * project's own codes (PHASE_CODES), or, for a sheet with no category column,
   * the shared ones (CATEGORY_CODES: P, PC, C, or nothing for Regular). The phase
   * column is then required for that, and the category column is optional.
   */
  /*
   * A project with categories of its own (MSCC's bedroom counts) has no codes to
   * read out of the phase cell. Its sheets carry the category in the FLOOR column
   * ("2F (2 BR)"); failing that, a unit keeps the category it already has, and a
   * new one gets the project's first (default) category.
   */
  const ownCategories = Boolean(CATEGORIES_BY_PROJECT[projectCode])
  const codes = PHASE_CODES[projectCode] ?? (column.category || ownCategories ? null : { ...CATEGORY_CODES, phase: Boolean(terms.group) })
  const derivesCategory = Boolean(codes)
  const missingHeaders = [
    'lot_no',
    ...(terms.group || derivesCategory ? ['phase'] : []),
    ...(derivesCategory || ownCategories ? [] : ['category']),
    'size_sqm',
  ].filter((field) => !column[field])
  if (missingHeaders.length) return { rows: [], errors: [], counts: { total: 0, insert: 0, update: 0 }, missingHeaders }

  const tracksSections = projectCode === 'MVLC'
  const [existing, priceFor] = await Promise.all([
    fetchAllRows(table, `id, lot_no, phase, category${tracksSections ? ', map_section' : ''}`),
    fetchPriceLookup(projectCode),
  ])
  const existingKey = (lot) => matchKey(formatLotIdentifier(projectCode, lot.lot_no), lot.phase, lot.map_section)
  const idByKey = new Map(existing.map((lot) => [existingKey(lot), lot.id]))
  const categoryByKey = new Map(existing.map((lot) => [existingKey(lot), lot.category]))
  // Categories already in the table plus the ones this project offers, so a valid
  // category that no lot happens to use yet is not rejected as unknown.
  const knownCategories = new Set(
    [...existing.map((lot) => lot.category), ...categoriesFor(projectCode)].map(normalizeCategory).filter(Boolean),
  )

  // UNKNOWN is the placeholder the MSCC status sheet export writes for a blank, so it reads as one.
  const cell = (record, field) => {
    const value = column[field] ? text(record[column[field]]).trim() : ''
    return /^unknown$/i.test(value) ? '' : value
  }
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

    const lotNo = formatLotIdentifier(projectCode, repairLotNo(cell(record, 'lot_no')))
    if (!lotNo) problems.push('lot number is empty')
    else if (!isLotIdentifierValid(projectCode, lotNo)) problems.push('lot number must use a format such as B21 L1, B23-B L1, or C L1')

    const phaseCell = cell(record, 'phase')
    // A coded phase (MVLC's "MV-C-1A") gives the number; otherwise it is read as one.
    const coded = parsePhaseCode(projectCode, phaseCell, codes)
    /*
     * A cell that only carries a category code and no number at all ("ERHD-PC",
     * "ERHD") names no phase: the lot is imported without one rather than rejected.
     */
    const codeOnly = derivesCategory && coded.phase === null && !/\d/.test(phaseCell)
    const phase = terms.group && !codeOnly ? (coded.phase ?? parseNumber(phaseCell.replace(/^(phase|tower)\s*/i, ''))) : null
    const mapSection = tracksSections ? (coded.section ?? null) : null
    if (phase !== null && !(Number.isInteger(phase) && phase > 0)) {
      problems.push(`${terms.group.toLowerCase()} "${phaseCell}" is not a whole number`)
    }

    // A category column always wins; otherwise it is read out of the phase cell.
    const category =
      normalizeCategory(cell(record, 'category')) ||
      coded.category ||
      (ownCategories
        ? bedroomCategory(cell(record, 'unit_type')) ||
          normalizeCategory(categoryByKey.get(matchKey(lotNo, phase, mapSection))) ||
          categoriesFor(projectCode)[0]
        : '')
    if (!category) problems.push(derivesCategory ? `no category could be read from "${phaseCell}"` : 'category is empty')
    else if (knownCategories.size && !knownCategories.has(category)) {
      problems.push(`unknown category "${cell(record, 'category') || category}" (use: ${[...knownCategories].sort().join(', ')})`)
    }

    const sizeSqm = parseNumber(cell(record, 'size_sqm'))
    if (!(Number.isFinite(sizeSqm) && sizeSqm > 0)) problems.push('lot area must be a number greater than 0')

    // The price is always the category's price in the database. An ungrouped
    // project (ERHD) prices every lot from a single row, so its null phase is a
    // valid lookup rather than a reason to skip the price table.
    const pricePerSqm = (category && (phase === null || Number.isInteger(phase)) ? priceFor(phase, category) : null) ?? null
    /*
     * No price set in the database for this category is not a reason to skip
     * the lot: a new one is added with no price and TCP, an existing one keeps
     * what it has, and saving the category's price later (Category prices)
     * re-prices every lot in it, these included.
     */

    const status = normalizeStatus(cell(record, 'status'))
    if (!status) problems.push(`unknown status "${cell(record, 'status')}" (use: ${LOT_STATUS_OPTIONS.map((o) => o.value).join(', ')})`)
    const reservation = reservationFromCsv(cell(record, 'status'), cell(record, 'client'))
    const paymentType = paymentTypeFromCsv(cell(record, 'payment_type'))
    if (paymentType === undefined) problems.push(`unknown payment type "${cell(record, 'payment_type')}" (use cash or installment)`)
    const contractType = contractTypeFromCsv(cell(record, 'contract_type'))
    if (contractType === undefined) problems.push(`unknown CTS/DOAS value "${cell(record, 'contract_type')}" (use CTS or DOAS)`)

    /*
     * The sales sheets keep agent names in columns of their own that the portal
     * does not store, so a sold row needs no agent here. A blank one is left out
     * of the write entirely (see toColumns), which keeps any agent already
     * recorded in the portal rather than clearing it.
     */
    const soldBy = cell(record, 'sold_by')

    const key = matchKey(lotNo, phase, mapSection)
    if (lotNo && seen.has(key)) problems.push(`duplicate of row ${seen.get(key)} (same lot number, phase, and section)`)
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
      ...(tracksSections ? { map_section: mapSection } : {}),
      phase_label: phaseDisplay(phase, mapSection, terms.group),
      category,
      size_sqm: sizeSqm,
      price_per_sqm: pricePerSqm,
      total: pricePerSqm === null ? null : Math.round(sizeSqm * pricePerSqm * 100) / 100,
      status,
      ...reservation,
      // Left undefined when the file has no payment column, so the stored one survives.
      payment_type: column.payment_type ? paymentType : undefined,
      contract_type: column.contract_type ? contractType : undefined,
      sold_by: soldBy || null,
      ...monthYearStamp(record, cell),
      /*
       * MSCC's FLOOR cell holds the floor (outside the parentheses) and the unit
       * type (inside). Sent only when the file has that column, and then for every
       * row, so the batch writes the same columns throughout; a cell that names
       * neither mirrors the sheet and clears them.
       */
      ...(terms.unitFields?.length && column.unit_type
        ? {
            floor_level: floorLevelFromCell(cell(record, 'unit_type')) || null,
            unit_type: bedroomCategory(cell(record, 'unit_type')) ? unitTypeLabel(bedroomCategory(cell(record, 'unit_type'))) : null,
          }
        : {}),
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
    ...(projectCode === 'MVLC' ? { map_section: row.map_section ?? null } : {}),
    category: row.category,
    size_sqm: row.size_sqm,
    // The category's database price; left out when it has none, so an updated
    // lot keeps its stored price. `total` is generated from size_sqm * price_per_sqm.
    ...(row.price_per_sqm !== null ? { price_per_sqm: row.price_per_sqm } : {}),
    status: row.status,
    reserve_type: row.reserve_type,
    reserved_for: row.reserved_for,
    ...(row.payment_type !== undefined ? { payment_type: row.payment_type } : {}),
    ...(row.contract_type !== undefined ? { contract_type: row.contract_type } : {}),
    // Left out when the file named no agent, so the stored one survives the import.
    ...(row.sold_by ? { sold_by: row.sold_by } : {}),
    last_updated: row.date,
    last_updated_precision: row.precision,
    ...(row.floor_level !== undefined ? { floor_level: row.floor_level, unit_type: row.unit_type } : {}),
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
    map_section: '20261001_add_mvlc_lot_map_sections.sql',
    reserve_type: '20260921_add_lot_reserve_type.sql',
    reserved_for: '20261004_add_lot_reserved_for.sql',
    payment_type: '20261008_add_lot_payment_type.sql',
    contract_type: '20261009_add_lot_contract_type.sql',
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
 * back. MSCC also gets its unit columns, which the importer ignores (it reads
 * them from the status sheet's FLOOR column instead).
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
      'client',
      'payment_type',
      'cts_doas',
      'sold_by',
      ...unitFields.map((field) => field.column),
    ],
    data: lots.map((lot) => [
      lot.lotNo,
      // Keep MVLC's A/B/C/East section in an exported file so importing it back
      // cannot collapse Phase 1A and Phase 1B into the same phase.
      project.code === 'MVLC' ? lot.phase : (lot.phaseNo ?? ''),
      lot.rawCategory,
      lot.areaSqm,
      lot.pricePerSqm,
      lot.tcp,
      lot.rawStatus,
      lot.reserveType === 'company'
        ? lot.reservedFor || 'Company'
        : lot.reserveType === 'client' || lot.status === 'sold'
          ? lot.reservedFor
          : '',
      lot.paymentType,
      lot.contractType.toUpperCase(),
      lot.soldBy,
      ...unitFields.map((field) => lot[field.key] ?? ''),
    ]),
  })

  const date = new Date().toISOString().slice(0, 10)
  return { csv, count: lots.length, fileName: `${project.code || 'project'}-${unit}s-${date}.csv` }
}

/*
 * MSCC's unit status sheet: one row per unit in the layout the sales team keeps
 * (BUILDING, FLOOR, UNIT, STATUS, CLIENT NAME, RA #, YEAR, MONTH, RSV DATE,
 * SD/SM/REALTY, LOT AREA). A cell that applies to the unit but was never
 * recorded reads UNKNOWN; one that does not apply (the client of an open unit)
 * stays blank, as it does in the sheet.
 */
export const MSCC_REPORT_HEADERS = ['BUILDING', 'FLOOR', 'UNIT', 'STATUS', 'CLIENT NAME', 'RA #', 'YEAR', 'MONTH', 'RSV DATE', 'SD/SM/REALTY', 'LOT AREA']

const UNKNOWN = 'UNKNOWN'
const REPORT_STATUS = { available: 'OPEN', reserved: 'RSV', 'rsv-p': 'RSV', hold: 'HOLD', sold: 'SOLD' }

/** "2nd Floor" -> "2F"; without one, unit 1205 is on the 12th floor. */
function reportFloor(floorLevel, unitNo) {
  const stated = String(floorLevel ?? '').match(/(\d+)/)
  if (stated) return `${Number(stated[1])}F`
  const fromUnit = String(unitNo ?? '').trim().match(/^(\d+)\d{2}$/)
  return fromUnit ? `${Number(fromUnit[1])}F` : UNKNOWN
}

/** "2 Bedroom Deluxe" -> "2 BR DELUXE". */
function reportUnitType(unitType) {
  const type = String(unitType ?? '').trim()
  return type ? type.replace(/\s*bed\s*rooms?\b/i, ' BR').replace(/\s+/g, ' ').trim().toUpperCase() : UNKNOWN
}

/** A stored YYYY-MM-DD date as { year, month, date }; the day is unknown for month-only stamps. */
function reportDate(lastUpdated, precision) {
  const match = String(lastUpdated ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const [, year, month, day] = match
  return {
    year,
    month: MONTH_NAMES[Number(month) - 1]?.toUpperCase() ?? UNKNOWN,
    date: precision === 'month' ? UNKNOWN : `${month}/${day}/${year}`,
  }
}

/** Who holds the unit, in the sheet's words: COMPANY, MSD RESERVED, or the client. */
function reportClient(lot, status) {
  if (status === 'OPEN' || status === UNKNOWN) return lot.reservedFor || ''
  if (lot.reserveType === 'company') return lot.reservedFor ? `${lot.reservedFor.toUpperCase()} RESERVED` : 'COMPANY'
  return lot.reservedFor || UNKNOWN
}

/** One MSCC unit as a row of the status sheet, in MSCC_REPORT_HEADERS order. */
export function msccReportRow(lot) {
  const status = REPORT_STATUS[String(lot.rawStatus ?? '').toLowerCase()] ?? (lot.rawStatus ? String(lot.rawStatus).toUpperCase() : UNKNOWN)
  const taken = status !== 'OPEN' && status !== UNKNOWN
  const companyHold = taken && lot.reserveType === 'company'
  // A client's reservation or sale is expected to carry its paperwork and agent.
  const expected = taken && !companyHold
  const missing = expected ? UNKNOWN : ''
  const stamp = taken ? reportDate(lot.lastUpdated, lot.lastUpdatedPrecision) : null
  const building = lot.phaseNo != null ? `TOWER ${lot.phaseNo}` : lot.phase && lot.phase !== '—' ? String(lot.phase).toUpperCase() : UNKNOWN

  return [
    building,
    // The unit type field wins; otherwise the bedroom category (2_bedroom -> 2 BR) says it.
    `${reportFloor(lot.floorLevel, lot.lotNo)} (${reportUnitType(lot.unitType || (/bedroom/i.test(lot.rawCategory ?? '') ? lot.rawCategory.replace(/_/g, ' ') : ''))})`,
    lot.lotNo || UNKNOWN,
    status,
    reportClient(lot, status),
    // The portal does not record reservation agreement numbers yet.
    missing,
    stamp?.year ?? missing,
    stamp?.month ?? missing,
    stamp?.date ?? missing,
    lot.soldBy || missing,
    lot.areaSqm > 0 ? lot.areaSqm : UNKNOWN,
  ]
}

/**
 * Every MSCC unit matching the table's search and filters as the status sheet,
 * ordered by tower then unit number. Resolves { csv, count, fileName }.
 */
export async function exportMsccReportCsv(query) {
  const { lots, project, source, hasLotTable } = await fetchProjectLots({
    ...query,
    projectCode: 'MSCC',
    page: 1,
    pageSize: Number.MAX_SAFE_INTEGER,
  })
  if (source === SOURCE.NOT_CONFIGURED) throw new Error('No database connected.')
  if (source !== SOURCE.DATABASE) throw new Error('The database could not be reached.')
  if (!hasLotTable) throw new Error(`${project.name || 'MSCC'} has no unit table set up.`)

  const ordered = [...lots].sort(
    (a, b) =>
      (a.phaseNo ?? Infinity) - (b.phaseNo ?? Infinity) ||
      String(a.lotNo).localeCompare(String(b.lotNo), undefined, { numeric: true, sensitivity: 'base' }),
  )
  const csv = Papa.unparse({ fields: MSCC_REPORT_HEADERS, data: ordered.map(msccReportRow) })
  const date = new Date().toISOString().slice(0, 10)
  return { csv, count: lots.length, fileName: `MSCC-unit-status-${date}.csv` }
}
