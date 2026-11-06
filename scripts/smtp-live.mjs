// Opt-in live check of outgoing mail:  pnpm test:smtp-live you@example.com
//
// Sends ONE plain-text email through the SMTP_* settings in this shell (the same ones lib/mail.ts uses)
// to the address on the command line, then reports what the server answered. Never prints the user
// name or password, and never runs in the normal test suites. Use a mailbox you own, then check the
// received message's headers for spf=pass, dkim=pass and dmarc=pass (docs/EMAIL-DELIVERY.md).
import nodemailer from 'nodemailer'

const to = (process.argv[2] ?? '').trim()
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error('Usage: pnpm test:smtp-live <recipient@example.com>')
  process.exit(2)
}
const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'].filter((k) => !(process.env[k] ?? '').trim())
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')} (set them in this shell only; never commit them).`)
  process.exit(2)
}
const port = Number(process.env.SMTP_PORT ?? 465)
const host = process.env.SMTP_HOST.trim()
const transport = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  requireTLS: port !== 465,
  auth: { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASSWORD },
})

console.log(`SMTP ${host}:${port} (${port === 465 ? 'implicit TLS' : 'STARTTLS required'}), from ${process.env.MAIL_FROM.trim()}, to ${to}`)
try {
  await transport.verify()
  console.log('Connection and login: OK')
  const info = await transport.sendMail({
    from: process.env.MAIL_FROM.trim(),
    to,
    subject: 'LockIn Consulting: SMTP test',
    text: `This is a one-off delivery test of LockIn Consulting's outgoing mail, sent ${new Date().toISOString()}.\nNo action is needed.`,
  })
  console.log(`Accepted: ${info.accepted.length}, rejected: ${info.rejected.length}`)
  console.log(`Message-ID: ${info.messageId}`)
  console.log(`Server reply: ${String(info.response).slice(0, 120)}`)
  process.exit(info.rejected.length ? 1 : 0)
} catch (error) {
  // Code and SMTP reply code only: a full error can echo the login name.
  const e = /** @type {{ code?: string, responseCode?: number, command?: string }} */ (error)
  console.error(`Failed: ${e.code ?? 'error'}${e.responseCode ? ` (SMTP ${e.responseCode})` : ''}${e.command ? ` during ${e.command}` : ''}`)
  process.exit(1)
} finally {
  transport.close()
}
