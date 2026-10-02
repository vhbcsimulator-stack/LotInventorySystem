// Creates a broker's login for the mobile app, which shares this database, and
// the matching `brokers` row the portal lists.
//
// The portal cannot do this itself: creating a user from the browser signs the
// admin out, and the service-role key that can create users must never ship to
// the browser.
//
// The broker is emailed their sign-in details through Resend (see
// _shared/resend.ts for the RESEND_API_KEY and RESEND_FROM secrets) and asked
// to change the temporary password after signing in.
//
// Deploy: supabase functions deploy create-broker
import { adminClient, CORS, jsonBody, portalUser, reply } from '../_shared/portal.ts'
import { escapeHtml, sendEmail } from '../_shared/resend.ts'

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

/** The welcome email: the broker's sign-in details, and a request to change the password. */
function welcomeEmail(firstName: string, email: string, password: string) {
  const subject = 'Your VHBC broker account'
  const text = [
    `Hi ${firstName},`,
    '',
    'A broker account was created for you in the VHBC app. Sign in with:',
    '',
    `Email: ${email}`,
    `Temporary password: ${password}`,
    '',
    'This password is temporary. After you sign in, please change it in the app',
    'right away and keep your new password to yourself.',
    '',
    "If you weren't expecting this account, reply to this email or contact VHBC.",
  ].join('\n')

  const name = escapeHtml(firstName)
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f6f8;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1f2937">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
      <tr><td>
        <h1 style="margin:0 0 12px;font-size:20px;color:#111827">Welcome to VHBC, ${name}</h1>
        <p style="margin:0 0 16px;font-size:14px;line-height:22px">A broker account was created for you in the VHBC app. Sign in with:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f3f4f6;border-radius:8px;padding:14px;font-size:14px">
          <tr><td style="padding:4px 0;color:#6b7280;width:150px">Email</td><td style="padding:4px 0;font-weight:600">${escapeHtml(email)}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280">Temporary password</td><td style="padding:4px 0;font-weight:700;font-family:Consolas,Menlo,monospace;font-size:16px;letter-spacing:1px">${escapeHtml(password)}</td></tr>
        </table>
        <p style="margin:16px 0 0;padding:12px 14px;background:#fffbeb;font-size:14px;line-height:22px">
          <strong>This password is temporary.</strong> After you sign in, please change it in the app
          right away and keep your new password to yourself.
        </p>
        <p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#6b7280">If you weren't expecting this account, reply to this email or contact VHBC.</p>
      </td></tr>
    </table>
  </body>
</html>`
  return { subject, text, html }
}

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

  /*
   * Confirmed from the start: the password is only ever sent to this address,
   * so signing in with it shows the broker has the inbox. `must_change_password`
   * tells the app to ask for a new one on first sign-in; the app clears it once
   * the password is changed.
   */
  const password = generatePassword()
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      mobile_number: mobileNumber,
      role: 'broker',
      must_change_password: true,
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

  // The broker's sign-in details, sent through Resend. Without them the broker
  // has no way in, so if the email cannot be sent nothing is kept.
  try {
    await sendEmail({ to: email, ...welcomeEmail(firstName, email, password) })
  } catch (err) {
    await admin.from('brokers').delete().eq('id', row.id)
    await admin.auth.admin.deleteUser(created.user.id)
    const message = err instanceof Error ? err.message : String(err)
    return reply(/too many/i.test(message) ? 429 : 502, {
      error: `Could not email the sign-in details: ${message} The account was not created.`,
    })
  }

  // Also returned once, in case the email goes astray; it is not stored anywhere readable.
  return reply(200, { id: row.id, authUserId: created.user.id, email, password })
})
