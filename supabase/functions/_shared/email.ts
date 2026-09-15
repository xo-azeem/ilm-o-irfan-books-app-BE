// Transactional mail: what each letter says, and how it is sent.
//
// The outbox row carries facts (a status, an end date, a store, a plan name);
// this turns them into a subject, an HTML body and a plain-text twin, and
// hands them to Resend. One place for every letter, so the copy the reader
// receives can be reviewed beside the trigger that sends it
// (20260922120000_subscription_cancellation.sql).
//
// Every letter is written to be true whether or not the reader ever opens the
// app again: dates are absolute, the store is named, and nothing promises a
// refund — refunds are the store's, and the letter says so.

export type EmailKind =
  | 'membership_cancelled'
  | 'membership_resumed'
  | 'membership_ended'
  | 'cancellation_unfinished'

export type EmailFacts = {
  userId?: string
  status?: string | null
  expiresAt?: string | null
  store?: string | null
  planName?: string | null
  fullName?: string | null
  // cancellation_unfinished: true when a renewal already landed after the
  // request, so the reader has been charged for another period.
  renewed?: boolean
  // membership_ended: true when the reader had cancelled beforehand.
  wasCancelled?: boolean
}

export type EmailContent = {
  subject: string
  html: string
  text: string
}

const APP_NAME = 'Ilm o Irfan'

// Where a reader manages the subscription for each store. Both open the
// account's subscription list; a per-product link needs the SKU, which the
// letter does not have and does not need.
export const MANAGE_URLS: Record<string, string> = {
  app_store: 'https://apps.apple.com/account/subscriptions',
  play_store: 'https://play.google.com/store/account/subscriptions',
}

export function storeLabel(store: string | null | undefined): string {
  switch (store) {
    case 'app_store':
      return 'the App Store'
    case 'play_store':
      return 'Google Play'
    default:
      return 'your app store'
  }
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function greeting(facts: EmailFacts): string {
  const name = (facts.fullName ?? '').trim()
  return name ? `Assalamu alaikum ${name},` : 'Assalamu alaikum,'
}

function planLabel(facts: EmailFacts): string {
  return (facts.planName ?? '').trim() || 'Premium'
}

type Draft = {
  subject: string
  intro: string
  paragraphs: string[]
  cta?: { label: string; url: string }
}

// One layout, four letters. Inline styles because mail clients strip
// stylesheets; a single column because half of these are read on a phone.
function render(draft: Draft): EmailContent {
  const paragraphsHtml = draft.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#2b2b2b;">${escapeHtml(p)}</p>`)
    .join('')

  const ctaHtml = draft.cta
    ? `<p style="margin:24px 0 8px;"><a href="${escapeHtml(draft.cta.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#b8860b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">${escapeHtml(draft.cta.label)}</a></p>`
    : ''

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(draft.subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f3ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f3ee;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;">
        <tr><td style="padding:28px 28px 8px;">
          <p style="margin:0 0 20px;font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:#b8860b;font-weight:600;">${escapeHtml(APP_NAME)}</p>
          <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#1a1a1a;">${escapeHtml(draft.subject)}</h1>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#2b2b2b;">${escapeHtml(draft.intro)}</p>
          ${paragraphsHtml}
          ${ctaHtml}
        </td></tr>
        <tr><td style="padding:8px 28px 28px;">
          <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#7a7a7a;">You are receiving this because it concerns the ${escapeHtml(APP_NAME)} membership on your account. Refunds and billing questions are handled by the store you subscribed through.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    draft.subject,
    '',
    draft.intro,
    '',
    ...draft.paragraphs.flatMap((p) => [p, '']),
    ...(draft.cta ? [`${draft.cta.label}: ${draft.cta.url}`, ''] : []),
    `— ${APP_NAME}`,
  ].join('\n')

  return { subject: draft.subject, html, text }
}

export function composeEmail(kind: EmailKind, facts: EmailFacts): EmailContent {
  const plan = planLabel(facts)
  const store = storeLabel(facts.store)
  const until = formatDate(facts.expiresAt)
  const manageUrl = MANAGE_URLS[facts.store ?? ''] ?? null

  switch (kind) {
    case 'membership_cancelled':
      return render({
        subject: `Your ${plan} membership has been cancelled`,
        intro: greeting(facts),
        paragraphs: [
          until
            ? `We have received the cancellation of your ${plan} membership from ${store}. You have already paid for the current period, so you keep full access to the library until ${until}. You will not be charged again.`
            : `We have received the cancellation of your ${plan} membership from ${store}. You keep full access until the end of the period you have already paid for, and you will not be charged again.`,
          'Your reading progress, bookmarks and downloads stay exactly where they are. If you change your mind before that date, turn auto-renew back on in the store and your membership continues without a gap.',
          'If you did not cancel, check the subscription in the store — it may have been changed from another device on the same account.',
        ],
        cta: manageUrl ? { label: `Manage on ${store}`, url: manageUrl } : undefined,
      })

    case 'membership_resumed':
      return render({
        subject: `Welcome back — your ${plan} membership continues`,
        intro: greeting(facts),
        paragraphs: [
          until
            ? `Auto-renew is back on for your ${plan} membership. Nothing is interrupted: your next renewal is on ${until}, billed by ${store} as before.`
            : `Auto-renew is back on for your ${plan} membership, billed by ${store} as before. Nothing is interrupted.`,
          'Thank you for staying with us. Your library is waiting where you left it.',
        ],
      })

    case 'membership_ended':
      return render({
        subject: `Your ${plan} membership has ended`,
        intro: greeting(facts),
        paragraphs: [
          facts.wasCancelled
            ? `As requested, your ${plan} membership ended${until ? ` on ${until}` : ''} and you have not been charged again.`
            : `Your ${plan} membership ended${until ? ` on ${until}` : ''}, so the library is no longer open on your account.`,
          'Everything you built is safe — your reading positions, bookmarks and wishlist are kept — and a new membership picks up exactly where you left off. Open the app and choose a plan whenever you are ready.',
        ],
      })

    case 'cancellation_unfinished':
      return render({
        subject: facts.renewed
          ? `Your ${plan} membership renewed — the cancellation was not completed`
          : `Your cancellation is not finished yet`,
        intro: greeting(facts),
        paragraphs: [
          facts.renewed
            ? `You asked to cancel your ${plan} membership in the app, but ${store} has not recorded a cancellation, and the membership has since renewed${until ? ` through ${until}` : ''}.`
            : `You asked to cancel your ${plan} membership in the app, but ${store} has not confirmed it yet. Until it does, the membership stays on auto-renew${until ? ` and will bill again on ${until}` : ''}.`,
          `Subscriptions are billed by ${store}, so the cancellation has to be completed there: open your subscriptions, choose ${APP_NAME}, and turn off auto-renew. We will email you as soon as the store confirms.`,
          facts.renewed
            ? `If you were charged for a period you did not want, refunds are decided by ${store} — request one from the same subscriptions page.`
            : 'If you have changed your mind and want to keep your membership, there is nothing to do.',
        ],
        cta: manageUrl ? { label: `Open subscriptions on ${store}`, url: manageUrl } : undefined,
      })
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type EmailConfig = {
  apiKey: string
  from: string
  replyTo: string | null
}

// Reads the provider config, or null when it is not set. The dispatcher
// treats null as "leave the rows pending", not as a failure per row.
export function loadEmailConfig(): EmailConfig | null {
  const apiKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim()
  const from = (Deno.env.get('EMAIL_FROM') ?? '').trim()
  if (!apiKey || !from) return null
  const replyTo = (Deno.env.get('EMAIL_REPLY_TO') ?? '').trim()
  return { apiKey, from, replyTo: replyTo || null }
}

export type SendOutcome =
  | { ok: true; providerId: string | null }
  | { ok: false; status: number; code: string; retryable: boolean }

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

// Resend's HTTP API, called directly: one POST, no SDK to vendor into Deno.
// 429 and 5xx are retried with the outbox's backoff; a 4xx is the request's
// fault (a bad address, an unverified sender domain) and retrying it would
// only repeat the answer.
export async function sendEmail(
  config: EmailConfig,
  to: string,
  content: EmailContent,
  idempotencyKey: string,
): Promise<SendOutcome> {
  let res: Response
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      }),
    })
  } catch (error) {
    return {
      ok: false,
      status: 0,
      code: `NETWORK:${(error as Error)?.message ?? 'unknown'}`.slice(0, 120),
      retryable: true,
    }
  }

  if (res.ok) {
    let providerId: string | null = null
    try {
      const body = (await res.json()) as { id?: string }
      providerId = typeof body?.id === 'string' ? body.id : null
    } catch {
      // A 2xx with no JSON body is still a send.
    }
    return { ok: true, providerId }
  }

  let code = `HTTP_${res.status}`
  try {
    const body = (await res.json()) as { name?: string; message?: string }
    if (body?.name) code = `${body.name}`.slice(0, 60)
    else if (body?.message) code = `${res.status}:${body.message}`.slice(0, 120)
  } catch {
    // Keep the status code.
  }

  return {
    ok: false,
    status: res.status,
    code,
    retryable: res.status === 429 || res.status >= 500,
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isDeliverableAddress(value: string | null | undefined): value is string {
  return typeof value === 'string' && EMAIL_RE.test(value.trim())
}
