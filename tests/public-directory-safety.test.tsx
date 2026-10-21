// Regression tests for RISKS.md R-029: the public directory once rendered the private
// `pending_admin_entry` research batch as "verified" (with hard-coded QS 2025 positions and
// default fees) whenever DATABASE_URL was unset. Public listings may only come from the
// database's public_* views (D-012, D-024, D-026); see tests/db/public-directory.db.test.ts for
// the database side.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UniversityDirectory } from '@/components/destination/university-directory'
import { getDestinationDirectory } from '@/lib/data/directory'
import { DESTINATIONS } from '@/lib/destinations'

const ROOT = path.join(__dirname, '..')
const INTAKE_DIR = path.join(ROOT, 'db', 'intake', 'destinations')

interface IntakeFile {
  status: string
  records: { officialName: string; slug: string }[]
}
const intake = new Map<string, IntakeFile>(
  DESTINATIONS.filter((d) => existsSync(path.join(INTAKE_DIR, `${d.slug}.json`))).map((d) => [
    d.iso2,
    JSON.parse(readFileSync(path.join(INTAKE_DIR, `${d.slug}.json`), 'utf8')) as IntakeFile,
  ]),
)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [full] : []
  })
}
// Comments may mention db/intake/ (to say it is never read); code may not.
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('public directory never shows private research records', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('the research batch exists and is still pending admin entry (precondition)', () => {
    expect(intake.size).toBe(DESTINATIONS.length)
    for (const file of intake.values()) expect(file.status).toBe('pending_admin_entry')
  })

  it.each(DESTINATIONS.map((d) => [d.slug, d.iso2]))('%s: no database means "not configured", never research data', async (_slug, iso2) => {
    vi.stubEnv('DATABASE_URL', '')
    expect(await getDestinationDirectory(iso2)).toEqual({ state: 'not_configured' })
  })

  it('renders the pending state without any research university, ranking, fee or "verified" claim', async () => {
    vi.stubEnv('DATABASE_URL', '')
    for (const destination of DESTINATIONS) {
      const directory = await getDestinationDirectory(destination.iso2)
      const html = renderToStaticMarkup(<UniversityDirectory destination={destination} directory={directory} />)
      expect(html).toContain('Pending verification')
      for (const record of intake.get(destination.iso2)!.records) expect(html).not.toContain(record.officialName)
      expect(html).not.toMatch(/QS World University Rankings|#\d+/)
      expect(html).not.toMatch(/Verified(?!\s*:)/)
    }
  })

  it('no application code reads db/intake/ or hard-codes ranking positions', () => {
    const files = ['app', 'components', 'lib', 'proxy.ts'].flatMap((p) => {
      const full = path.join(ROOT, p)
      return statSync(full).isDirectory() ? sourceFiles(full) : [full]
    })
    expect(files.length).toBeGreaterThan(50)
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'))
      const rel = path.relative(ROOT, file)
      expect(code, rel).not.toMatch(/['"`](?:\.\/)?db\/intake|['"`]intake['"`]|intake\/destinations|research-batch/)
      expect(code, rel).not.toMatch(/QS_RANKINGS|QS World University Rankings/)
    }
    expect(existsSync(path.join(ROOT, 'lib', 'data', 'verified-directory.ts'))).toBe(false)
  })
})
