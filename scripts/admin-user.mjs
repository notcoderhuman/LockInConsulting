// Administrator provisioning. This is the ONLY way to create admin accounts or change roles:
// the website has no sign-up route and no first-run setup page.
//
// Run on a trusted machine with database access (e.g. Hostinger SSH), never from a browser:
//   node scripts/admin-user.mjs create --email founder@example.com --name "Dev Gautam" --role owner
//   node scripts/admin-user.mjs grant  --email reviewer@example.com --role reviewer
//   node scripts/admin-user.mjs revoke --email reviewer@example.com
//   node scripts/admin-user.mjs set-password --email founder@example.com
//   node scripts/admin-user.mjs list
//   node scripts/admin-user.mjs verify-audit
//
// Passwords are read from the terminal with echo off, or from stdin when piped
// (`--password-stdin`). They are never accepted as command-line arguments, so they don't end up
// in shell history or the process list. Requires DATABASE_URL (or ADMIN_DATABASE_URL) and
// BETTER_AUTH_SECRET in the environment.
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { betterAuth } from 'better-auth'
import mysql from 'mysql2/promise'
import { appendChangeLogRow, verifyAuditChain } from '../lib/admin/audit-core.mjs'
import { AUTH_MODELS, PASSWORD_POLICY } from '../lib/auth-options.mjs'

const ROLES = ['editor', 'reviewer', 'owner']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class CliError extends Error {}

function utcPool(uri, dateStrings) {
  const pool = mysql.createPool({ uri, dateStrings, timezone: 'Z', connectionLimit: 2, multipleStatements: false })
  pool.pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"))
  return pool
}

async function readPasswordFromTty(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  // Suppress echo: overwrite whatever readline would print while the password is typed.
  rl._writeToOutput = function (s) {
    if (s.includes(prompt)) process.stdout.write(prompt)
  }
  try {
    return await new Promise((resolve) => rl.question(prompt, resolve))
  } finally {
    rl.close()
    process.stdout.write('\n')
  }
}

async function readPasswordFromStdin() {
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return data.split(/\r?\n/)[0]
}

async function obtainPassword(fromStdin) {
  if (fromStdin || !process.stdin.isTTY) return readPasswordFromStdin()
  const first = await readPasswordFromTty('New password: ')
  const second = await readPasswordFromTty('Repeat password: ')
  if (first !== second) throw new CliError('Passwords do not match.')
  return first
}

function checkPassword(password) {
  const { minPasswordLength: min, maxPasswordLength: max } = PASSWORD_POLICY
  if (typeof password !== 'string' || password.length < min || password.length > max)
    throw new CliError(`Password must be ${min}–${max} characters.`)
}

/**
 * @param {{ env?: Record<string, string | undefined>, readPassword?: () => Promise<string>, log?: (s: string) => void, actor?: string }} io
 */
export async function runAdminCli(argv, io = {}) {
  const env = io.env ?? process.env
  const log = io.log ?? ((s) => console.log(s))
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
      'password-stdin': { type: 'boolean', default: false },
    },
  })
  const command = positionals[0]
  const uri = env.ADMIN_DATABASE_URL || env.DATABASE_URL
  if (!uri) throw new CliError('Set ADMIN_DATABASE_URL or DATABASE_URL.')
  const secret = env.BETTER_AUTH_SECRET ?? ''
  if (secret.length < 32) throw new CliError('Set BETTER_AUTH_SECRET (at least 32 characters).')

  const actor = io.actor ?? `cli:${os.userInfo().username}`
  const readPassword = io.readPassword ?? (() => obtainPassword(values['password-stdin']))
  const email = values.email?.trim().toLowerCase()
  const role = values.role

  const dataPool = utcPool(uri, true)
  const authPool = utcPool(uri, false)
  const auth = betterAuth({
    database: authPool,
    secret,
    baseURL: env.BETTER_AUTH_URL || 'http://localhost:3000',
    ...AUTH_MODELS,
    emailAndPassword: { enabled: true, ...PASSWORD_POLICY },
    telemetry: { enabled: false },
  })

  async function memberChange(userId, action, reason, mutate) {
    const conn = await dataPool.getConnection()
    try {
      await conn.beginTransaction()
      const [[before]] = await conn.query('SELECT * FROM admin_members WHERE user_id = ? FOR UPDATE', [userId])
      await mutate(conn)
      const [[after]] = await conn.query('SELECT * FROM admin_members WHERE user_id = ?', [userId])
      // admin_members is keyed by a string user id; the log stores the numeric entity id 0 and
      // the user id inside before/after.
      await appendChangeLogRow(conn, {
        entityType: 'admin_member',
        entityId: 0,
        action,
        actorId: actor,
        actorRole: 'cli',
        reason,
        before: before ?? null,
        after: after ?? null,
      })
      await conn.commit()
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
  }

  const requireEmail = () => {
    if (!email || !EMAIL.test(email)) throw new CliError('Pass a valid --email.')
  }
  const requireRole = () => {
    if (!ROLES.includes(role)) throw new CliError(`--role must be one of: ${ROLES.join(', ')}.`)
  }

  try {
    const ctx = await auth.$context
    const findUser = async () => {
      const found = await ctx.internalAdapter.findUserByEmail(email)
      if (!found?.user) throw new CliError(`No account for ${email}.`)
      return found.user
    }

    switch (command) {
      case 'create': {
        requireEmail()
        requireRole()
        const name = values.name?.trim()
        if (!name) throw new CliError('Pass --name.')
        if ((await ctx.internalAdapter.findUserByEmail(email))?.user) throw new CliError(`${email} already has an account. Use "grant".`)
        const password = await readPassword()
        checkPassword(password)
        const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: false })
        await ctx.internalAdapter.linkAccount({
          userId: user.id,
          providerId: 'credential',
          accountId: user.id,
          password: await ctx.password.hash(password),
        })
        await memberChange(user.id, 'role_grant', `create as ${role}`, (conn) =>
          conn.query("INSERT INTO admin_members (user_id, role, status, granted_by) VALUES (?, ?, 'active', ?)", [user.id, role, actor]),
        )
        log(`Created ${email} as ${role}.`)
        return { userId: user.id }
      }
      case 'grant': {
        requireEmail()
        requireRole()
        const user = await findUser()
        await memberChange(user.id, 'role_grant', `grant ${role}`, (conn) =>
          conn.query(
            `INSERT INTO admin_members (user_id, role, status, granted_by) VALUES (?, ?, 'active', ?)
             ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active', revoked_at = NULL,
                                     granted_by = VALUES(granted_by), granted_at = CURRENT_TIMESTAMP(3)`,
            [user.id, role, actor],
          ),
        )
        log(`${email} is now ${role}.`)
        return { userId: user.id }
      }
      case 'revoke': {
        requireEmail()
        const user = await findUser()
        await memberChange(user.id, 'role_revoke', 'revoke', (conn) =>
          conn.query("UPDATE admin_members SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3) WHERE user_id = ?", [user.id]),
        )
        await ctx.internalAdapter.deleteUserSessions(user.id)
        log(`Revoked admin access for ${email} and signed out all of their sessions.`)
        return { userId: user.id }
      }
      case 'set-password': {
        requireEmail()
        const user = await findUser()
        const password = await readPassword()
        checkPassword(password)
        await ctx.internalAdapter.updatePassword(user.id, await ctx.password.hash(password))
        await ctx.internalAdapter.deleteUserSessions(user.id)
        log(`Password changed for ${email}; existing sessions were signed out.`)
        return { userId: user.id }
      }
      case 'list': {
        const [rows] = await dataPool.query(
          'SELECT u.email, u.name, m.role, m.status FROM auth_user u LEFT JOIN admin_members m ON m.user_id = u.id ORDER BY u.email',
        )
        for (const r of rows) log(`${r.email}\t${r.name}\t${r.role ?? '-'}\t${r.status ?? 'no access'}`)
        return { rows }
      }
      case 'verify-audit': {
        const result = await verifyAuditChain(dataPool)
        log(result.ok ? `Audit chain intact (${result.checked} rows).` : `AUDIT CHAIN BROKEN at row ${result.brokenAtId}: ${result.reason}`)
        return result
      }
      default:
        throw new CliError('Commands: create, grant, revoke, set-password, list, verify-audit')
    }
  } finally {
    await dataPool.end()
    await authPool.end()
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  runAdminCli(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof CliError ? e.message : e)
    process.exit(1)
  })
}
