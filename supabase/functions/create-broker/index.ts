// Creates a broker's login for the mobile app, which shares this database, and
// the matching `brokers` row the portal lists.
//
// The portal cannot do this itself: creating a user from the browser signs the
// admin out, and the service-role key that can create users must never ship to
// the browser.
//
// Deploy: supabase functions deploy create-broker
import { adminClient, CORS, jsonBody, portalUser, publicClient, reply } from '../_shared/portal.ts'

// Keep this function type-checkable when the project does not include Deno's
// ambient type declarations. Supabase Edge Functions provide this global at runtime.
declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// No look-alikes (0/O, 1/l/I), so the password survives being read aloud or
// copied by hand into the app.
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const PASSWORD_LENGTH = 12

/** A random temporary password from a cryptographic source, without modulo bias. */
function generatePassword() {
  const limit = 256 - (256 % PASSWORD_CHARS.length)
  let password = ''
  while (password.length < PASSWORD_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(PASSWORD_LENGTH * 2))) {
      if (byte < limit && password.length < PASSWORD_LENGTH) password += PASSWORD_CHARS[byte % PASSWORD_CHARS.length]
    }
  }
  return password
}

const clean = (value: unknown) => String(value ?? '').trim()

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const admin = adminClient()
  const caller = await portalUser(req, admin)
  if (caller instanceof Response) return caller

  const body = await jsonBody(req)
  if (!body) return reply(400, { error: 'Send the broker details as JSON.' })
  const firstName = clean(body.firstName)
  const lastName = clean(body.lastName)
  const mobileNumber = clean(body.mobileNumber)
  const email = clean(body.email).toLowerCase()

  if (!firstName || !lastName || !mobileNumber || !email) return reply(400, { error: 'All fields are required.' })
  if (!EMAIL_PATTERN.test(email)) return reply(400, { error: 'Enter a valid email address.' })

  // Left unconfirmed: the broker confirms through the "Confirm signup" email
  // sent below, then signs in to the app with the generated password.
  const password = generatePassword()
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: {
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      mobile_number: mobileNumber,
      role: 'broker',
    },
  })
  if (createError || !created?.user) {
    const taken = /already|registered|exists/i.test(createError?.message ?? '')
    return reply(taken ? 409 : 400, {
      error: taken ? `An account with the email ${email} already exists.` : createError?.message ?? 'Could not create the login.',
    })
  }

  const { data: row, error: insertError } = await admin
    .from('brokers')
    .insert({
      first_name: firstName,
      last_name: lastName,
      mobile_number: mobileNumber,
      email,
      auth_user_id: created.user.id,
      user_id: caller.id,
    })
    .select('id')
    .single()

  // No half-made brokers: without its row, the login is removed again.
  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id)
    const taken = insertError.code === '23505'
    return reply(taken ? 409 : 500, {
      error: taken ? `A broker with the email ${email} already exists.` : insertError.message,
    })
  }

  // Supabase's own "Confirm signup" email, from the project's existing template
  // and email settings. The admin API creates users silently, so the email is
  // requested the way the app's own sign-up would resend it.
  const { error: emailError } = await publicClient().auth.resend({ type: 'signup', email })

  // An account nobody can confirm is no use, so without the email nothing is kept.
  if (emailError) {
    await admin.from('brokers').delete().eq('id', row.id)
    await admin.auth.admin.deleteUser(created.user.id)
    const limited = emailError.status === 429 || /rate limit/i.test(emailError.message)
    return reply(limited ? 429 : 502, {
      error: limited
        ? 'Too many emails sent recently. Wait a few minutes and try again. The account was not created.'
        : `Could not send the confirmation email: ${emailError.message}. The account was not created.`,
    })
  }

  // The only place the password is ever returned; it is not stored anywhere readable.
  return reply(200, { id: row.id, authUserId: created.user.id, email, password })
})
