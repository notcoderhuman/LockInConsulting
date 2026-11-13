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
    expect(layout).toContain('Not reviewed by a lawyer.')
    expect(layout).toContain('does not claim')
    for (const p of PAGES) {
      const page = read(p)
      expect(page, p).toContain('<LegalPage')
      expect(page, p).toMatch(/robots: \{ index: LEGAL_REVIEWED/)
    }
    expect(layout).toMatch(/LEGAL_REVIEWED \? null : \(/)
  })

  it('opens sign-up on the statutory business details alone, and never claims a lawyer reviewed anything', async () => {
    const { BUSINESS, LEGAL_REVIEWED, noticeReady } = await import('@/lib/legal/notice')
    // The Owner supplied these on 7 Nov 2026. A lawyer's review is not a statutory precondition, so it is not a
    // gate, and it is not claimed either: the flag stays false and the pages say so.
    expect(LEGAL_REVIEWED).toBe(false)
    expect(noticeReady()).toBe(true)
    expect(BUSINESS).toEqual({
      legalName: 'LockIn Consulting',
      address: 'B-11 Ashok Vihar, 100ft Road, Dayalbagh, Agra, 282005, India',
      contactPerson: 'Dev Gautam',
      contactEmail: 'lockinconsulting.in@gmail.com',
      contactPhone: '+91 99978 40093',
    })
    const full = { legalName: 'X', address: 'Y', contactPerson: 'Z', contactEmail: 'a@b.example', contactPhone: '1' }
    expect(noticeReady(full)).toBe(true)
    expect(noticeReady({ ...full, contactPhone: ' ' })).toBe(false)
    expect(noticeReady({ ...full, address: null })).toBe(false)
  })

  it('never claims compliance or a lawyer’s review, and invents no registration details', () => {
    for (const p of PAGES) expect(read(p), p).not.toMatch(/\b(we|LockIn) (comply|complies|is compliant|are compliant)|fully compliant|DPDP[- ]compliant|reviewed by (a|our) lawyer\b/i)
    const notice = read('lib/legal/notice.ts')
    // No invented registration type or numbers anywhere in the pages or the config.
    for (const text of [read('app/privacy/page.tsx'), read('app/terms/page.tsx'), notice]) expect(text).not.toMatch(/\b(CIN|GSTIN|GST number|PAN)\b\s*[:=]|proprietorship\)|private limited|\bLLP\b/i)
    // The AI pages say what is true today: Derek is off and nothing goes to an AI service.
    expect(read('app/privacy/page.tsx')).toContain('free service')
    expect(read('app/privacy/page.tsx')).toContain('only the text of your current question')
    expect(read('app/ai/page.tsx')).not.toContain('paid account')
  })

  it('records which notice version a student accepted, and the footer links all three pages', () => {
    expect(read('lib/student/onboarding.ts')).toMatch(/PRIVACY_NOTICE_VERSION = 'student-2026-11-13'/)
    expect(read('app/privacy/page.tsx')).toContain('version={PRIVACY_NOTICE_VERSION}')
    const footer = read('components/site/site-footer.tsx')
    for (const href of ['/privacy', '/terms', '/ai']) expect(footer).toContain(`href="${href}"`)
  })
})
