import 'server-only'
import nodemailer from 'nodemailer'
import { mailConfigured } from '@/lib/identity/policy'

// Provider-neutral outgoing mail. SMTP is the one transport: a Hostinger Email mailbox and every
// transactional service (Amazon SES, Brevo, Postmark, Resend, ZeptoMail, Mailgun…) offer an SMTP
// relay, so changing provider means changing SMTP_* only. Options and prices: docs/EMAIL-DELIVERY.md.
//
//   SMTP_HOST, SMTP_PORT (465 = implicit TLS, otherwise STARTTLS is required), SMTP_USER,
//   SMTP_PASSWORD, MAIL_FROM ("LockIn Consulting <no-reply@your-domain>").
//   MAIL_TRANSPORT=log (never in production): the message is written to the server console instead.

export interface MailMessage {
  to: string
  subject: string
  text: string
  /** Optional HTML alternative; `text` is always sent too, for clients that show plain text. */
  html?: string
}

/** Test hook: replaces delivery (tests capture codes here; nothing is sent). */
export const mailer: { send: (message: MailMessage) => Promise<void> } = { send: deliver }

let transport: ReturnType<typeof nodemailer.createTransport> | undefined

async function deliver(message: MailMessage): Promise<void> {
  if (!mailConfigured()) throw new Error('Outgoing mail is not configured.')
  if (process.env.MAIL_TRANSPORT === 'log') {
    console.info(`[mail:log] to=${message.to} subject=${message.subject}\n${message.text}`)
    return
  }
  const port = Number(process.env.SMTP_PORT ?? 465)
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER!.trim(), pass: process.env.SMTP_PASSWORD! },
  })
  await transport.sendMail({ from: process.env.MAIL_FROM!.trim(), to: message.to, subject: message.subject, text: message.text, html: message.html })
}

const PURPOSE = {
  'sign-in': 'sign in to',
  'email-verification': 'verify your email for',
  'forget-password': 'reset your password for',
  'change-email': 'change your email for',
} as const

// Brand colours from app/globals.css; the darker gold is for small text on white (contrast ≥ 4.5:1).
const INK = '#0b0a09'
const GOLD = '#d4b47a'
const GOLD_DARK = '#7a5f2e'
const BODY = '#3d3a35'
const MUTED = '#6f6a62'
const SERIF = "Georgia, 'Times New Roman', Times, serif"
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * The one-time code email: an HTML card with a plain-text alternative. No links and no images, so a forwarded
 * or phished copy carries nothing clickable and the code stays readable with images blocked. The code is not
 * in the subject, so it never shows in lock-screen notifications or mailbox lists.
 */
export function otpMessage(email: string, otp: string, type: keyof typeof PURPOSE, minutes: number): MailMessage {
  const heading = type === 'sign-in' ? 'Your sign-in code' : 'Your verification code'
  const body =
    type === 'sign-in'
      ? 'Use this one-time code to securely access your LockIn Consulting student account.'
      : `Use this one-time code to ${PURPOSE[type]} your LockIn Consulting student account.`
  const expiry = `This code expires in ${minutes} minutes and can only be used once.`
  const ignore = 'Didn’t request this code? You can safely ignore this email.'
  const neverShare = 'Never share your verification code with anyone, including someone claiming to be from LockIn Consulting.'
  const preheader = `Your one-time verification code is ready. It expires in ${minutes} minutes.`
  const code = escapeHtml(otp)

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f2efe8;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f2efe8;">${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2efe8" style="background-color:#f2efe8;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;border-collapse:separate;">
<tr><td align="center" bgcolor="${INK}" style="background-color:${INK};padding:30px 24px 26px;border-radius:12px 12px 0 0;">
<div style="font-family:${SERIF};font-size:30px;line-height:34px;letter-spacing:9px;color:#ffffff;padding-left:9px;">LOCKIN</div>
<div style="font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:6px;color:${GOLD};padding-left:6px;padding-top:6px;">CONSULTING</div>
</td></tr>
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:40px 40px 32px;border:1px solid #e7e1d4;border-top:0;border-radius:0 0 12px 12px;">
<h1 style="margin:0 0 14px;font-family:${SERIF};font-size:26px;line-height:32px;font-weight:normal;color:${INK};">${escapeHtml(heading)}</h1>
<p style="margin:0 0 28px;font-family:${SANS};font-size:15px;line-height:24px;color:${BODY};">${escapeHtml(body)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
<tr><td align="center" bgcolor="#faf7f0" style="background-color:#faf7f0;border:1px solid #e3d6b8;border-top:3px solid ${GOLD};border-radius:10px;padding:26px 12px 24px;">
<div style="font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:2px;text-transform:uppercase;color:${GOLD_DARK};padding-bottom:10px;">One-time code</div>
<div style="font-family:'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:38px;line-height:46px;font-weight:bold;letter-spacing:12px;color:${INK};padding-left:12px;">${code}</div>
</td></tr>
</table>
<p style="margin:22px 0 0;font-family:${SANS};font-size:14px;line-height:22px;color:${BODY};text-align:center;">${escapeHtml(expiry)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;">
<tr><td style="border-top:1px solid #ece6d9;padding-top:20px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};">
<strong style="color:${BODY};font-weight:600;">${escapeHtml(ignore)}</strong><br>${escapeHtml(neverShare)}
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:22px 24px 0;font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:3px;text-transform:uppercase;color:${MUTED};">LockIn Consulting</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  const text = [
    heading,
    '',
    body,
    '',
    `    ${otp}`,
    '',
    expiry,
    '',
    ignore,
    neverShare,
    '',
    '-- ',
    'LockIn Consulting',
  ].join('\n')

  return { to: email, subject: type === 'sign-in' ? 'Your LockIn sign-in code' : 'Your LockIn verification code', text, html }
}
