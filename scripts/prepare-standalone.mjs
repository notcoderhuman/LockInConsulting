// Completes the `output: 'standalone'` bundle after `next build`.
//
// Next.js writes .next/standalone/server.js but deliberately does not copy `public/` or
// `.next/static/`, so without this step the standalone server serves pages but 404s every
// client chunk and globe texture. Plain Node (no shell commands), so it runs the same on
// Windows cmd/PowerShell, macOS and Linux. A no-op if standalone output is turned off.
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const standalone = path.join(root, '.next', 'standalone')

if (!existsSync(path.join(standalone, 'server.js'))) {
  console.log('prepare-standalone: no standalone build found; nothing to do.')
} else {
  for (const [from, to] of [
    [path.join(root, 'public'), path.join(standalone, 'public')],
    [path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static')],
  ]) {
    if (!existsSync(from)) continue
    rmSync(to, { recursive: true, force: true }) // drop assets from a previous build
    cpSync(from, to, { recursive: true })
  }
  console.log('prepare-standalone: copied public/ and .next/static/ into .next/standalone/.')
}
