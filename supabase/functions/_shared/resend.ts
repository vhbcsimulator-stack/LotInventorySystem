// Sends email through Resend (https://resend.com/docs/api-reference/emails/send-email).
//
// Needs two function secrets:
//   RESEND_API_KEY  an API key from resend.com/api-keys
//   RESEND_FROM     the sender, on a domain verified in Resend,
//                   e.g. "VHBC Portal <no-reply@yourdomain.com>"
// Set them with: supabase secrets set RESEND_API_KEY=re_... RESEND_FROM="VHBC Portal <no-reply@yourdomain.com>"

declare const Deno: {
  env: {
    get(name: string): string | undefined
  }
}

export type Email = { to: string; subject: string; html: string; text: string }

/** Send one email. Throws with a readable message when Resend is not set up or refuses it. */
export async function sendEmail({ to, subject, html, text }: Email): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM')
  if (!apiKey || !from) throw new Error('Email is not set up: set the RESEND_API_KEY and RESEND_FROM function secrets.')

  let response: Response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    })
  } catch (err) {
    throw new Error(`Could not reach Resend: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (response.ok) return

  // Resend answers failures with { name, message }.
  const reason = await response.json().then((body) => body?.message, () => '')
  if (response.status === 429) throw new Error('Too many emails sent recently. Wait a minute and try again.')
  throw new Error(reason || `Resend refused the email (HTTP ${response.status}).`)
}

/** Text made safe to place inside HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
