import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const audit = JSON.parse(readFileSync(path.join(root, 'db/intake/2026-10-17-pdf-audit.json'), 'utf8')) as {
  verdict: string
  summary: { rowsClaimed: number; rowsFound: number; placeholderRows: number; namedInstitutionRows: number }
  candidates: Array<{
    officialName: string
    destinationIso2: string
    slug: string
    candidateWebsite: string
    reviewStatus: string
    acceptedFacts: unknown[]
    identityCheck: { checkedAt: string; httpStatus: number }
  }>
}

const PLACEHOLDER = /#\s*\d+\s*$|^(University of|.+ State University)\s+(United States|United Kingdom|Canada|Germany)\b/

describe('PDF intake audit (db/intake)', () => {
  it('rejects the document as a data source and records the row mismatch', () => {
    expect(audit.verdict).toBe('rejected_as_data_source')
    expect(audit.summary.rowsFound).not.toBe(audit.summary.rowsClaimed)
    expect(audit.summary.placeholderRows + audit.summary.namedInstitutionRows).toBe(audit.summary.rowsFound)
  })

  it('keeps candidates as identity leads only, with no facts taken from the PDF', () => {
    for (const c of audit.candidates) {
      expect(c.acceptedFacts, c.officialName).toEqual([])
      expect(['identity_candidate', 'identity_check_blocked']).toContain(c.reviewStatus)
      expect(c.officialName).not.toMatch(PLACEHOLDER)
      expect(c.candidateWebsite).toMatch(/^https:\/\/[^?#]+$/)
      expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(c.identityCheck.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('has unique slugs per destination, matching the universities unique key', () => {
    const keys = audit.candidates.map((c) => `${c.destinationIso2}/${c.slug}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never seeds candidate universities through migrations', () => {
    const dir = path.join(root, 'db/migrations')
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(path.join(dir, f), 'utf8'))
      .join('\n')
    expect(sql).not.toMatch(/INSERT\s+INTO\s+universities/i)
    for (const c of audit.candidates) expect(sql).not.toContain(c.officialName)
  })
})
