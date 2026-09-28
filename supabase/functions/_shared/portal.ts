// What every broker-account function shares: CORS, JSON replies, the
// service-role client, and the check that the caller is a portal user.
//
// Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to deployed
// functions automatically. Folders starting with `_` are not deployed on their
// own; they are bundled into the functions that import them.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'

// Keep this file type-checkable when the project does not include Deno's
// ambient type declarations. Supabase Edge Functions provide this global at runtime.
declare const Deno: {
  env: {
    get(name: string): string | undefined
  }
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    // Responses can carry a password: never cache them.
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/** A client with the service-role key: it can manage logins and bypasses row-level security. */
export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * A client with the public anon key, acting as nobody. Used for calls that
 * trigger Supabase's own auth emails, which the admin API does not send.
 */
export function publicClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * The signed-in portal user making the request, or the reply refusing them.
 * Brokers sign in to the same project from the app, so being signed in is not
 * enough: a broker's own login is turned away.
 */
export async function portalUser(req: Request, admin: SupabaseClient): Promise<User | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data } = await admin.auth.getUser(token)
  if (!data?.user) return reply(401, { error: 'Sign in to the portal to manage broker accounts.' })

  const { count } = await admin
    .from('brokers')
    .select('id', { count: 'exact', head: true })
    .eq('auth_user_id', data.user.id)
  if (data.user.user_metadata?.role === 'broker' || count) {
    return reply(403, { error: 'Broker accounts cannot manage other brokers.' })
  }
  return data.user
}

/** The request's JSON body, or null when it is missing or not an object. */
export async function jsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}
