// The map gallery behind the public /maps/ page: every current project map,
// for anyone holding the gallery password. The password is checked here, never
// in the browser, so it is not shipped in the page's code.
//
// Needs one function secret:
//   MAP_GALLERY_PASSWORD  the password people type on /maps/
// Set it with: supabase secrets set MAP_GALLERY_PASSWORD="..."
//
// Deploy: supabase functions deploy map-gallery --no-verify-jwt
// (the page's visitors are not signed in to the portal).
import { adminClient, CORS, jsonBody, reply } from '../_shared/portal.ts'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

/** How long a wrong password waits before its answer, so guessing is slow. */
const WRONG_PASSWORD_DELAY_MS = 1000

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/** Compares the two in the same time however many characters match. */
async function samePassword(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

const text = (value: unknown) => (value == null ? '' : String(value).trim())

/** The project code a map row's `project` starts with, e.g. "MSCC - paused" → "MSCC". */
const codeOf = (project: unknown) => /^[A-Za-z0-9]+/.exec(text(project))?.[0].toUpperCase() ?? ''

/** The map's place in its project, read the way the portal's map tabs read it. */
function labelOf(row: Record<string, unknown>, code: string): { label: string; order: number } {
  const phase = Number.parseFloat(text(row.Phase))
  const hasPhase = Number.isFinite(phase)
  const commercial = text(row.type).toLowerCase() === 'commercial'
  const unit = /^MSCC/.test(code) ? 'Floor' : 'Phase'
  if (commercial) return { label: hasPhase ? `Commercial · Phase ${phase}` : 'Commercial', order: 10000 + (hasPhase ? phase : 0) }
  if (!hasPhase) return { label: 'Whole Map', order: -1 }
  // MVLC's phase 1 and 2 maps with no section are its East section.
  const section = text(row.map_section) || (code === 'MVLC' && (phase === 1 || phase === 2) ? 'East' : '')
  return { label: `${unit} ${phase}${section}`, order: phase * 100 + (section ? section.charCodeAt(0) - 64 : 0) }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const expected = Deno.env.get('MAP_GALLERY_PASSWORD') ?? ''
  if (!expected) return reply(503, { error: 'The map gallery is not set up yet.' })

  const body = await jsonBody(req)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!password || !(await samePassword(password, expected))) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS))
    return reply(401, { error: 'That password is not right.' })
  }

  const admin = adminClient()
  const [maps, projects] = await Promise.all([
    admin
      .from('uploads')
      .select('id, project, Phase, map_section, type, image_URL, uploaded_at')
      .eq('kind', 'map')
      .eq('current', true)
      .order('uploaded_at', { ascending: false })
      .range(0, 4999),
    admin.from('projects').select('id, code, name').order('id', { ascending: false }),
  ])
  if (maps.error) return reply(500, { error: maps.error.message })

  // The projects table repeats codes; the newest row names each one.
  const names = new Map<string, string>()
  for (const row of projects.data ?? []) {
    const code = text(row.code).toUpperCase()
    if (code && !names.has(code)) names.set(code, text(row.name) || code)
  }

  const list = (maps.data ?? [])
    .filter((row) => text(row.image_URL))
    .map((row) => {
      const code = codeOf(row.project)
      return {
        id: row.id,
        projectCode: code,
        projectName: names.get(code) ?? code,
        ...labelOf(row, code),
        url: text(row.image_URL),
        updatedAt: row.uploaded_at ?? null,
      }
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.order - b.order)

  return reply(200, { maps: list })
})
