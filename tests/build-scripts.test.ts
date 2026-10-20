// R-030: `NODE_ENV=production next build` failed under Windows cmd/PowerShell. `next build`
// already defaults NODE_ENV to production. The standalone bundle also needs public/ and
// .next/static/ copied in, or it 404s every client chunk and texture.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config.mjs'

const root = path.join(__dirname, '..')
const scripts: Record<string, string> = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts

describe('package scripts', () => {
  it('use no POSIX-only environment assignments, so they run in cmd, PowerShell and sh', () => {
    for (const [name, cmd] of Object.entries(scripts)) expect(cmd, name).not.toMatch(/(^|&&\s*|;\s*)[A-Z_][A-Z0-9_]*=\S*\s/)
  })

  it('builds with Next defaults and completes the standalone bundle', () => {
    expect(scripts.build).toBe('next build && node scripts/prepare-standalone.mjs')
    expect(existsSync(path.join(root, 'scripts', 'prepare-standalone.mjs'))).toBe(true)
    expect(nextConfig.output).toBe('standalone')
    expect(scripts['start:standalone']).toBe('node .next/standalone/server.js')
    expect(scripts.start).toBe('next start')
  })
})
