// The draft legal pages: always marked as drafts, never claiming compliance, never inventing
// business details, and linked from every page footer. Sources: docs/LEGAL-DRAFTS.md.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8')
const PAGES = ['app/privacy/page.tsx', 'app/terms/page.tsx', 'app/ai/page.tsx']

describe('legal drafts', () => {
  it('render through the draft layout, stay out of search, and say they are not in effect', () => {
    const layout = read('components/legal/legal-page.tsx')
    expect(layout).toContain('Draft pending legal review.')
    expect(layout).toContain('does not claim')
    for (const p of PAGES) {
      const page = read(p)
      expect(page, p).toContain('<LegalPage')
      expect(page, p).toMatch(/robots: \{ index: false/)
    }
  })

  it('never claim compliance and leave every unknown business detail to the Owner', () => {
    for (const p of PAGES) expect(read(p), p).not.toMatch(/\b(we|LockIn) (comply|complies|is compliant|are compliant)|fully compliant|DPDP[- ]compliant/i)
    const privacy = read('app/privacy/page.tsx')
    for (const gap of ['registered legal name', 'postal address', 'contact email for privacy requests', 'retention period for the change log'])
      expect(privacy).toContain(gap)
    // No invented registration numbers, addresses or officers.
    expect(privacy).not.toMatch(/\b(CIN|GSTIN|PAN)\b|Grievance Officer:|\+91/)
  })

  it('records which notice version a student accepted, and the footer links all three pages', () => {
    expect(read('lib/student/onboarding.ts')).toMatch(/PRIVACY_NOTICE_VERSION = 'student-2026-11-draft'/)
    expect(read('app/privacy/page.tsx')).toContain('version={PRIVACY_NOTICE_VERSION}')
    const footer = read('components/site/site-footer.tsx')
    for (const href of ['/privacy', '/terms', '/ai']) expect(footer).toContain(`href="${href}"`)
  })
})
