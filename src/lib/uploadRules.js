/*
 * What the portal accepts for each kind of upload — the one list the file
 * pickers, the data layer, and the System Manual all read, so they never
 * disagree. Storage enforces the same limits on its side (see
 * supabase/migrations/20260925_restrict_uploads.sql); keep the two in step.
 */

const MB = 1024 * 1024

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

export const UPLOAD_RULES = {
  photo: {
    label: 'Photos',
    usedFor: 'Project development, future development, flyers, featured project, and future project images',
    formats: 'JPG, PNG or WebP',
    extensions: IMAGE_EXTENSIONS,
    types: IMAGE_TYPES,
    maxBytes: 10 * MB,
    image: true,
  },
  map: {
    label: 'Map images',
    usedFor: 'Project maps and annotated map images. SVG keeps a map sharp at any zoom. A recolored map is always saved as SVG: the original map, untouched, with the colored lots written in as vector shapes',
    formats: 'JPG, PNG, WebP or SVG',
    extensions: [...IMAGE_EXTENSIONS, '.svg'],
    types: [...IMAGE_TYPES, 'image/svg+xml'],
    maxBytes: 25 * MB,
    image: true,
  },
  coco: {
    label: 'Map annotations',
    usedFor: 'Lot outlines for an annotated map',
    formats: 'COCO JSON (.json)',
    extensions: ['.json'],
    // Browsers often report no type at all for .json; the extension decides then.
    types: ['application/json', 'text/json', ''],
    maxBytes: 20 * MB,
  },
  csv: {
    label: 'Lot import',
    usedFor: 'Adding or updating lots in bulk',
    formats: 'CSV (.csv)',
    extensions: ['.csv'],
    // Windows reports .csv as an Excel type when Excel is installed.
    types: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain', ''],
    maxBytes: 5 * MB,
  },
}

const ruleFor = (kind) => {
  const rule = UPLOAD_RULES[kind]
  if (!rule) throw new Error(`Unknown upload kind "${kind}".`)
  return rule
}

export const formatBytes = (bytes) =>
  bytes >= MB ? `${Number((bytes / MB).toFixed(1))} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** The `accept` attribute for a file input of this kind. */
export function acceptFor(kind) {
  const rule = ruleFor(kind)
  return [...rule.extensions, ...rule.types.filter(Boolean)].join(',')
}

/** One line for under a picker: "JPG, PNG or WebP · up to 10 MB". */
export function describeUpload(kind) {
  const rule = ruleFor(kind)
  return `${rule.formats} · up to ${formatBytes(rule.maxBytes)}`
}

/**
 * What is wrong with `file` for this kind of upload, or '' when nothing is —
 * name, reported type, and size only, so a picker can answer at once.
 * A Blob made in the page (a recoloured map) has no name; its type decides.
 */
export function uploadProblem(kind, file) {
  const rule = ruleFor(kind)
  if (!file) return 'Choose a file.'
  const name = typeof file.name === 'string' ? file.name : ''
  const shown = name ? `"${name}"` : 'This file'
  const extension = /\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? ''
  const type = String(file.type ?? '').toLowerCase()

  if ((name && !rule.extensions.includes(extension)) || !rule.types.includes(type) || (!name && !type)) {
    return `${shown} is not an accepted file. Use ${rule.formats}.`
  }
  if (!file.size) return `${shown} is empty.`
  if (file.size > rule.maxBytes) {
    return `${shown} is ${formatBytes(file.size)} — the limit is ${formatBytes(rule.maxBytes)}.`
  }
  return ''
}

/**
 * Whether text opens as an SVG document: an <svg> element after at most an XML
 * declaration, a doctype, and comments.
 */
export function isSvgText(head) {
  const text = String(head).replace(/^\uFEFF/, '')
  const rest = text.replace(/^(\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i, '')
  return /^<svg[\s>]/i.test(rest)
}

/** Whether the first bytes are those of a JPEG, PNG or WebP file. */
function isImageSignature(bytes) {
  const at = (offset, values) => values.every((value, index) => bytes[offset + index] === value)
  return (
    at(0, [0xff, 0xd8, 0xff]) || // JPEG
    at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || // PNG
    (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) // RIFF....WEBP
  )
}

/**
 * Throw a readable error unless `file` may be uploaded as this kind. Beyond
 * uploadProblem, it reads the file's first bytes: a renamed file — a GIF or SVG
 * called .png, a spreadsheet saved as .csv — is refused by what it holds, not
 * by what it is called.
 */
export async function checkUpload(kind, file) {
  const problem = uploadProblem(kind, file)
  if (problem) throw new Error(problem)

  const rule = ruleFor(kind)
  const shown = file.name ? `"${file.name}"` : 'This file'
  if (rule.types.includes('image/svg+xml') && (String(file.type).toLowerCase() === 'image/svg+xml' || /\.svg$/i.test(file.name ?? ''))) {
    // Scripts and outside links are stripped before it is stored (lib/svgMaps).
    if (!isSvgText(await file.slice(0, 4096).text())) throw new Error(`${shown} is not a real SVG image.`)
    return
  }
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  if (rule.image) {
    if (!isImageSignature(bytes)) throw new Error(`${shown} is not a real ${rule.formats} image.`)
  } else if (bytes.includes(0)) {
    // Text never holds a zero byte; an .xlsx or other binary renamed to .csv does.
    throw new Error(`${shown} is not a plain-text ${rule.formats} file.`)
  }
}
