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
 * The kinds of app account these functions manage, from the request's `kind`
 * (a broker when it is missing): the table holding the account's row, the role
 * stamped on its login, and how to name it in messages and the welcome email.
 */
export const APP_ACCOUNTS = {
  broker: { table: 'brokers', role: 'broker', label: 'broker' },
  regular_user: { table: 'regular_users', role: 'regular_user', label: 'user' },
  sales_agent: { table: 'sales_agents', role: 'sales_agent', label: 'sales agent' },
} as const

export type AppAccount = (typeof APP_ACCOUNTS)[keyof typeof APP_ACCOUNTS]

/** The account kind a request names, or null when it names one that does not exist. */
export function appAccount(kind: unknown): AppAccount | null {
  const key = String(kind ?? 'broker')
  return Object.hasOwn(APP_ACCOUNTS, key) ? APP_ACCOUNTS[key as keyof typeof APP_ACCOUNTS] : null
}

/**
 * The signed-in portal user making the request, or the reply refusing them.
 * Brokers, regular users, and sales agents sign in to the same project from the app, so being
 * signed in is not enough: an app account's own login is turned away.
 */
export async function portalUser(req: Request, admin: SupabaseClient): Promise<User | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data } = await admin.auth.getUser(token)
  if (!data?.user) return reply(401, { error: 'Sign in to the portal to manage app accounts.' })

  const roles: string[] = Object.values(APP_ACCOUNTS).map((account) => account.role)
  if (roles.includes(data.user.user_metadata?.role)) {
    return reply(403, { error: 'App accounts cannot manage other accounts.' })
  }
  // A table or column not made yet (before its migration) counts nothing.
  for (const { table } of Object.values(APP_ACCOUNTS)) {
    const { count } = await admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('auth_user_id', data.user.id)
    if (count) return reply(403, { error: 'App accounts cannot manage other accounts.' })
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
