// A PERSISTENT local MySQL 8.4 for development (`pnpm dev:local:persist`). It uses the same
// MySQL binary that mysql-memory-server downloads for the tests, but keeps its data in a folder
// outside this repository, so imported research survives restarts:
//
//   default data folder: ~/.lockin-consulting/local-db   (override: LOCKIN_LOCAL_DB_DIR)
//   default port:        127.0.0.1:33307                 (override: LOCKIN_LOCAL_DB_PORT)
//
// Local only: it listens on 127.0.0.1, with a passwordless root user that cannot be reached from
// another machine. It never connects to any other database. Stopping it shuts MySQL down cleanly.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { createDB } from 'mysql-memory-server'

export const LOCAL_DB_NAME = 'lockin_local'

export function localDbDir() {
  return process.env.LOCKIN_LOCAL_DB_DIR || path.join(os.homedir(), '.lockin-consulting', 'local-db')
}

function findBinaryRoot() {
  const base = path.join(os.tmpdir(), 'mysqlmsn', 'binaries')
  if (!existsSync(base)) return null
  const version = readdirSync(base).filter((v) => v.startsWith('8.4.')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
  return version ? path.join(base, version, 'mysql') : null
}

async function canConnect(port) {
  try {
    const conn = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' })
    await conn.end()
    return true
  } catch {
    return false
  }
}

export async function startLocalMysql({ log = console.log } = {}) {
  const dir = localDbDir()
  const port = Number(process.env.LOCKIN_LOCAL_DB_PORT) || 33307
  const dataDir = path.join(dir, 'data')

  let child = null
  if (await canConnect(port)) {
    log(`Reusing the local MySQL already running on 127.0.0.1:${port}.`)
  } else {
    let root = findBinaryRoot()
    if (!root) {
      // First run on this machine: let mysql-memory-server download its MySQL 8.4 binary, then reuse it.
      const tmp = await createDB({ version: '8.4.x', logLevel: 'ERROR' })
      await tmp.stop()
      root = findBinaryRoot()
    }
    if (!root) throw new Error('No MySQL 8.4 binary found. Run the DB tests once (pnpm test:db) to download it.')
    const mysqld = path.join(root, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld')
    const common = ['--no-defaults', `--basedir=${root}`, `--datadir=${dataDir}`]
    if (!existsSync(dataDir)) {
      mkdirSync(dir, { recursive: true })
      log(`Creating a persistent local database in ${dataDir} …`)
      const init = spawnSync(mysqld, [...common, '--initialize-insecure', '--console'], { encoding: 'utf8' })
      if (init.status !== 0) throw new Error(`MySQL could not initialise the data folder:\n${init.stderr || init.stdout}`)
    }
    child = spawn(mysqld, [...common, `--port=${port}`, '--bind-address=127.0.0.1', '--mysqlx=OFF', '--console'], { stdio: 'ignore' })
    const started = Date.now()
    while (!(await canConnect(port))) {
      if (child.exitCode != null) throw new Error(`MySQL exited with code ${child.exitCode}. Is the data folder in use by another server?`)
      if (Date.now() - started > 120_000) throw new Error('The local MySQL did not start within 2 minutes.')
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' })
  await admin.query(`CREATE DATABASE IF NOT EXISTS ${LOCAL_DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await admin.end()

  return {
    port,
    dbName: LOCAL_DB_NAME,
    username: 'root',
    dataDir,
    async stop() {
      // A clean shutdown so the data folder is never left mid-write.
      try {
        const conn = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' })
        await conn.query('SHUTDOWN')
        await conn.end().catch(() => {})
      } catch {
        child?.kill()
      }
      if (child && child.exitCode == null) await new Promise((r) => child.once('exit', r))
    },
  }
}
