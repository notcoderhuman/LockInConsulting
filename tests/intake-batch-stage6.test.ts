import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESTINATIONS } from '@/lib/destinations'
import {
  BILLING_PERIODS,
  QUALIFICATIONS,
  STUDY_LEVELS,
  STUDY_MODES,
  SUPPORTED_CURRENCIES,
} from '@/lib/data/types'

interface Fact {
  field: string
  scope: string
  value: any
  evidence: string
  checkedAt: string
  validity: string | null
  result: string
  sourceUrl?: string
  publisher?: string
}

interface IntakeRecord {
  destinationIso2: string
  officialName: string
  slug: string
  institutionType: string
  city?: string | null
  subRegion?: string | null
  fromPdfLead?: boolean
  identity: {
    url: string
    method: string
    httpStatus: number | null
    pageTitle: string
    checkedAt: string
    result: string
  }
  facts: Fact[]
}

const root = path.resolve(__dirname, '..')
const batch = JSON.parse(readFileSync(path.join(root, 'db/intake/2026-10-18-research-batch.json'), 'utf8')) as {
  batch: string
  preparedAt: string
  status: string
  records: IntakeRecord[]
}

const RESULTS = ['captured', 'blocked_automated_check', 'source_not_located', 'stale', 'not_yet_researched']
const RANKING = /rank|qs|times higher|\bthe_/i
const PLACEHOLDER = /#\s*\d+\s*$|^(University of|.+ State University)\s+(United States|United Kingdom|Canada|Germany|Australia|Italy|Poland|Finland|New Zealand|Saudi Arabia|United Arab Emirates)\b/i

describe('Stage 6 directory research batch (db/intake/2026-10-18-research-batch.json)', () => {
  it('is a private research file awaiting admin entry, not published', () => {
    expect(batch.status).toBe('pending_admin_entry')
    expect(batch.records.length).toBe(33)
  })

  it('covers each of the 11 destinations with exactly 3 genuine universities', () => {
    const destCounts = new Map<string, number>()
    for (const d of DESTINATIONS) destCounts.set(d.iso2, 0)

    for (const r of batch.records) {
      expect(destCounts.has(r.destinationIso2), `Unknown destination: ${r.destinationIso2}`).toBe(true)
      destCounts.set(r.destinationIso2, (destCounts.get(r.destinationIso2) ?? 0) + 1)
    }

    for (const [iso2, count] of destCounts) {
      expect(count, `Destination ${iso2} does not have exactly 3 universities`).toBe(3)
    }
  })

  it('has unique institution slugs and unique official names across the batch', () => {
    const slugs = batch.records.map((r) => r.slug)
    expect(new Set(slugs).size).toBe(33)

    const names = batch.records.map((r) => r.officialName)
    expect(new Set(names).size).toBe(33)
  })

  it('contains zero placeholder or synthetic names', () => {
    for (const r of batch.records) {
      expect(r.officialName).not.toMatch(PLACEHOLDER)
      expect(r.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(['public', 'private', 'unknown']).toContain(r.institutionType)
    }
  })

  it('verifies identity with an official https URL and valid check date', () => {
    for (const r of batch.records) {
      expect(r.identity.url).toMatch(/^https:\/\//)
      expect(r.identity.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(RESULTS).toContain(r.identity.result)
    }
  })

  it('never captures ranking figures or fabricated acceptance rates', () => {
    for (const r of batch.records) {
      for (const f of r.facts) {
        expect(f.field).not.toMatch(RANKING)
        expect(f.field).not.toMatch(/acceptance_rate/)
        expect(['university_wide', 'course_specific']).toContain(f.scope)
        expect(RESULTS).toContain(f.result)
        if (f.result === 'captured') {
          expect(f.evidence.length, `${r.slug}.${f.field} evidence too short`).toBeGreaterThan(20)
        }
      }
    }
  })

  it('validates programme structures against schema constraints', () => {
    for (const r of batch.records) {
      const programmes = r.facts.filter((f) => f.field === 'programme' && f.value)
      expect(programmes.length, `${r.slug} has no researched programme`).toBeGreaterThanOrEqual(1)
      for (const p of programmes) {
        const val = p.value
        expect(QUALIFICATIONS).toContain(val.qualification)
        expect(STUDY_LEVELS).toContain(val.studyLevel)
        expect(STUDY_MODES).toContain(val.studyMode)
        expect(val.durationMonths).toBeGreaterThanOrEqual(1)
        expect(val.durationMonths).toBeLessThanOrEqual(120)
        expect(val.url).toMatch(/^https:\/\//)
      }
    }
  })

  it('ensures captured tuition fees use supported national currencies and printed validity', () => {
    for (const r of batch.records) {
      for (const f of r.facts) {
        if (f.field === 'tuition_fee' && f.value && f.value.currency) {
          expect(SUPPORTED_CURRENCIES).toContain(f.value.currency)
          expect(BILLING_PERIODS).toContain(f.value.billingPeriod)
          expect(f.validity, `${r.slug} fee missing validity`).toBeTruthy()
        }
      }
    }
  })

  it('provides respective destination research files under db/intake/destinations/', () => {
    for (const d of DESTINATIONS) {
      const destFile = path.join(root, `db/intake/destinations/${d.slug}.json`)
      const destData = JSON.parse(readFileSync(destFile, 'utf8')) as {
        destinationSlug: string
        destinationIso2: string
        recordCount: number
        records: IntakeRecord[]
      }
      expect(destData.destinationSlug).toBe(d.slug)
      expect(destData.destinationIso2).toBe(d.iso2)
      expect(destData.recordCount).toBe(10)
      expect(destData.records.length).toBe(10)
    }
  })
})
