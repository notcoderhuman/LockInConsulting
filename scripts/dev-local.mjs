// One command for the local preview:  pnpm dev:local   (stop with Ctrl-C)
//
// Starts the disposable sandbox database (scripts/dev-sandbox.mjs: throwaway MySQL, every migration,
// SYNTHETIC accounts), then `next dev` on http://localhost:3000 from THIS folder, with hot reload.
// Derek uses the offline mock provider (its replies are labelled as test replies); no AI key, no
// Google credentials and no production setting is passed through, whatever your shell has set.
// Ctrl-C stops both, and the sandbox deletes its database and `.env.sandbox.local`.
// `pnpm dev:local:persist` (--persist) uses the persistent local MySQL instead, whose data is kept
// between runs (scripts/local-mysql.mjs).
// `pnpm dev:local:oauth` (--persist --oauth) is the one exception to "no Google credentials": it adds
// the owner's real ones from the git-ignored .env.oauth.local (docs/ENVIRONMENT.md → Google sign-in setup).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Default 3000; DEV_PORT=3100 (for example) when another app already uses 3000.
const PORT = Number(process.env.DEV_PORT) || 3000
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const envFile = path.join(root, '.env.sandbox.local')

if (process.env.NODE_ENV === 'production') {
  console.error('dev-local is for local development only.')
  process.exit(1)
}

// Another server on the port is usually a stale preview (or another app): never start a second one.
const portFree = await new Promise((resolve) => {
  const probe = net.createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)))
  probe.listen(PORT, '127.0.0.1')
})
if (!portFree) {
  console.error(`Port ${PORT} is already in use: another preview (maybe from an older worktree) is running. Stop it first, or use another port: DEV_PORT=3100 pnpm dev:local`)
  process.exit(1)
}

// --oauth: read (and check) the owner's real Google credentials before anything starts; applied below.
const OAUTH_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STUDENT_SELF_SIGNUP_ENABLED']
let oauth = null
if (process.argv.includes('--oauth')) {
  const oauthFile = path.join(root, '.env.oauth.local')
  oauth = existsSync(oauthFile)
    ? Object.fromEntries(
        readFileSync(oauthFile, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => OAUTH_KEYS.some((k) => line.startsWith(`${k}=`)))
          .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]),
      )
    : {}
  const missing = OAUTH_KEYS.slice(0, 2).filter((k) => !oauth[k])
  if (missing.length) {
    console.error(`--oauth needs ${missing.join(' and ')} in .env.oauth.local (git-ignored). See docs/ENVIRONMENT.md → Google sign-in setup.`)
    process.exit(1)
  }
}

if (existsSync(envFile)) rmSync(envFile) // left over from a sandbox that did not shut down cleanly
const sandbox = spawn(process.execPath, [path.join(root, 'scripts', 'dev-sandbox.mjs'), ...(process.argv.includes('--persist') ? ['--persist'] : [])], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] })
let next = null
const stopAll = () => {
  next?.kill('SIGINT')
  sandbox.kill('SIGINT')
}
process.on('SIGINT', stopAll)
process.on('SIGTERM', stopAll)
sandbox.on('exit', (code) => {
  next?.kill('SIGINT')
  process.exit(code ?? 0)
})

const started = Date.now()
while (!existsSync(envFile) || !readFileSync(envFile, 'utf8').includes('STUDENT_ACCOUNTS_ENABLED')) {
  if (Date.now() - started > 180_000) {
    console.error('The sandbox database did not start within 3 minutes.')
    stopAll()
    process.exit(1)
  }
  await new Promise((r) => setTimeout(r, 500))
}

const sandboxEnv = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
)
const env = { ...process.env, ...sandboxEnv, BETTER_AUTH_URL: `http://localhost:${PORT}`, DEREK_PROVIDER: 'mock', DEREK_AUTO_REPLY_CLEARED: 'mock' }
// Never let a real key or a production setting from the shell reach the local preview.
for (const key of ['GEMINI_API_KEY', 'GEMINI_PAID_TIER', 'DEREK_PROVIDER_APPROVED', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STUDENT_SELF_SIGNUP_ENABLED', 'NODE_ENV', 'AUTH_CLIENT_IP_HEADER', 'NEXT_PUBLIC_SITE_URL', 'ADMIN_DATABASE_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM', 'MAIL_TRANSPORT'])
  delete env[key]

// --oauth (pnpm dev:local:oauth): the REAL Google flow on localhost, opted into explicitly. Only the
// keys below are read, from the git-ignored .env.oauth.local that the owner creates (never this script,
// never .env.sandbox.local, which the sandbox rewrites). Values are never printed. New-student sign-up
// stays off unless that file also says STUDENT_SELF_SIGNUP_ENABLED=true (local only: NODE_ENV is never
// production here). The redirect URI Google must allow is <BETTER_AUTH_URL>/api/auth/callback/google.
if (oauth) {
  env.GOOGLE_CLIENT_ID = oauth.GOOGLE_CLIENT_ID
  env.GOOGLE_CLIENT_SECRET = oauth.GOOGLE_CLIENT_SECRET
  if (oauth.STUDENT_SELF_SIGNUP_ENABLED === 'true') env.STUDENT_SELF_SIGNUP_ENABLED = 'true'
  console.log(`\nGoogle sign-in: real credentials loaded from .env.oauth.local (values not shown).`)
  console.log(`Register this redirect URI on the OAuth client: ${env.BETTER_AUTH_URL}/api/auth/callback/google`)
  console.log(`New-student sign-up: ${env.STUDENT_SELF_SIGNUP_ENABLED === 'true' ? 'ON (local only)' : 'off (existing students only)'}`)
}

// --signup (pnpm dev:local:signup): rehearse student sign-up locally. New accounts on, and emailed
// codes are printed to this console instead of being sent (MAIL_TRANSPORT=log; never real mail).
if (process.argv.includes('--signup')) {
  Object.assign(env, { STUDENT_SELF_SIGNUP_ENABLED: 'true', MAIL_TRANSPORT: 'log' })
  console.log('\nStudent sign-up: ON (local only). Codes appear in this console as [mail:log].')
}

console.log(`\nLocal preview: http://localhost:${PORT}  (synthetic sign-ins are listed in .env.sandbox.local)\n`)
next = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--port', String(PORT), '--hostname', 'localhost'], { cwd: root, env, stdio: 'inherit' })
next.on('exit', () => sandbox.kill('SIGINT'))
