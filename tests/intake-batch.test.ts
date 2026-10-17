import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESTINATIONS } from '@/lib/destinations'

type Fact = { field: string; scope: string; value: unknown; evidence: string; checkedAt: string; validity: string | null; result: string }
type Record = {
  destinationIso2: string
  officialName: string
  slug: string
  institutionType: string
  identity: { url: string; checkedAt: string; result: string }
  facts: Fact[]
}

const root = path.resolve(__dirname, '..')
const batch = JSON.parse(readFileSync(path.join(root, 'db/intake/2026-10-17-initial-batch.json'), 'utf8')) as {
  status: string
  records: Record[]
}

const RESULTS = ['captured', 'blocked_automated_check', 'source_not_located', 'stale', 'not_yet_researched']
const RANKING = /rank|qs|times higher|\bthe_/i

describe('initial directory batch (db/intake)', () => {
  it('is a private research file, not yet entered or published', () => {
    expect(batch.status).toBe('pending_admin_entry')
    expect(JSON.stringify(batch)).not.toMatch(/"(verified|published)"/)
  })

  it('covers each configured destination exactly once', () => {
    const iso = batch.records.map((r) => r.destinationIso2).sort()
    expect(iso).toEqual(DESTINATIONS.map((d) => d.iso2).sort())
  })

  it('records identity with an official https website, date and outcome', () => {
    for (const r of batch.records) {
      expect(r.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(r.identity.url, r.officialName).toMatch(/^https:\/\//)
      expect(r.identity.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(RESULTS).toContain(r.identity.result)
      expect(['public', 'private', 'unknown']).toContain(r.institutionType)
    }
  })

  it('never invents values or captures rankings', () => {
    for (const r of batch.records)
      for (const f of r.facts) {
        expect(RESULTS, `${r.slug}.${f.field}`).toContain(f.result)
        expect(['university_wide', 'course_specific']).toContain(f.scope)
        expect(f.field).not.toMatch(RANKING)
        expect(f.field).not.toMatch(/acceptance/)
        if (f.result === 'captured') expect(f.evidence.length, `${r.slug}.${f.field}`).toBeGreaterThan(20)
        else expect(f.value, `${r.slug}.${f.field} has a value without evidence`).toBeNull()
      }
  })

  it('keeps fee values tied to a printed validity period', () => {
    for (const r of batch.records)
      for (const f of r.facts)
        if (f.field.startsWith('tuition_fee') && f.value !== null && typeof f.value === 'object')
          expect(f.validity, `${r.slug}.${f.field}`).toBeTruthy()
  })
})
