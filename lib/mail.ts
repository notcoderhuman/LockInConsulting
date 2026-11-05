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
  await transport.sendMail({ from: process.env.MAIL_FROM!.trim(), to: message.to, subject: message.subject, text: message.text })
}

const PURPOSE = {
  'sign-in': 'sign in to',
  'email-verification': 'verify your email for',
  'forget-password': 'reset your password for',
  'change-email': 'change your email for',
} as const

/** The one-time code email. Plain text only: no links, so a forwarded or phished copy carries no clickable sign-in. */
export function otpMessage(email: string, otp: string, type: keyof typeof PURPOSE, minutes: number): MailMessage {
  return {
    to: email,
    subject: `${otp} is your LockIn Consulting code`,
    text: [
      `Use this code to ${PURPOSE[type]} your LockIn Consulting student account:`,
      '',
      `    ${otp}`,
      '',
      `It expires in ${minutes} minutes and works once. LockIn will never ask you for this code by phone, chat or email.`,
      'If you did not ask for it, ignore this email: nothing changes without the code.',
    ].join('\n'),
  }
}
