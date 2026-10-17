// Removes a broker, regular user, or sales agent account (the body's `kind`,
// 'broker' when missing): their login for the mobile app, and their `brokers` /
// `regular_users` / `sales_agents` row. The portal cannot delete a login from the browser, since
// only the service-role key can.
//
// Deploy: supabase functions deploy delete-broker
import { adminClient, appAccount, CORS, jsonBody, portalUser, reply } from '../_shared/portal.ts'

// Keep this function type-checkable when the project does not include Deno's
// ambient type declarations. Supabase Edge Functions provide this global at runtime.
declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const admin = adminClient()
  const caller = await portalUser(req, admin)
  if (caller instanceof Response) return caller

  const body = await jsonBody(req)
  const account = appAccount(body?.kind)
  if (!account) return reply(400, { error: 'Unknown account kind.' })
  const id = String(body?.id ?? '').trim()
  if (!id) return reply(400, { error: `Say which ${account.label} to remove.` })

  const { data: broker, error: findError } = await admin
    .from(account.table)
    .select('id, auth_user_id')
    .eq('id', id)
    .maybeSingle()
  if (findError) return reply(500, { error: findError.message })
  if (!broker) return reply(404, { error: `That ${account.label} no longer exists.` })

  // The login goes first, so the account is locked out of the app even if
  // removing the row then fails; a retry finds the row and finishes the job.
  // A login already deleted in the dashboard is not an error.
  if (broker.auth_user_id) {
    const { error } = await admin.auth.admin.deleteUser(broker.auth_user_id)
    if (error && error.status !== 404) return reply(500, { error: `Could not remove the app login: ${error.message}` })
  }

  const { error: deleteError } = await admin.from(account.table).delete().eq('id', id)
  if (deleteError) return reply(500, { error: deleteError.message })

  return reply(200, { id })
})
