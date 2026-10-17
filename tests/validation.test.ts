import { describe, expect, it } from 'vitest'
import {
  acceptanceRateInput,
  academicYear,
  courseInput,
  isoDate,
  rankingInput,
  rankingRightsInput,
  sourceInput,
  tuitionFeeInput,
  universityInput,
  verificationInput,
} from '@/lib/data/validation'

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : (r.error?.issues.map((i) => i.message) ?? [])

describe('primitives', () => {
  it('accepts only real ISO dates', () => {
    expect(isoDate.safeParse('2026-02-28').success).toBe(true)
    expect(isoDate.safeParse('2026-02-30').success).toBe(false)
    expect(isoDate.safeParse('15/10/2026').success).toBe(false)
  })

  it('accepts consecutive academic years only', () => {
    expect(academicYear.safeParse('2026-2027').success).toBe(true)
    expect(academicYear.safeParse('2026').success).toBe(true)
    expect(academicYear.safeParse('2026-2028').success).toBe(false)
  })
})

describe('sourceInput', () => {
  it('requires https and a publisher', () => {
    expect(sourceInput.safeParse({ url: 'https://www.ox.ac.uk/', title: 'Fees', publisher: 'University of Oxford', sourceType: 'university_official' }).success).toBe(true)
    expect(sourceInput.safeParse({ url: 'http://example.ac.uk/', title: 'Fees', publisher: 'X', sourceType: 'university_official' }).success).toBe(false)
    expect(sourceInput.safeParse({ url: 'https://example.ac.uk/', title: 'Fees', publisher: '  ', sourceType: 'other' }).success).toBe(false)
  })
})

describe('universityInput', () => {
  it('only accepts the 11 destinations, so Dubai cannot be a country', () => {
    const base = { slug: 'example-university', name: 'Example University' }
    expect(universityInput.safeParse({ ...base, destinationIso2: 'AE', subRegion: 'Dubai' }).success).toBe(true)
    expect(universityInput.safeParse({ ...base, destinationIso2: 'FR' }).success).toBe(false)
    expect(universityInput.safeParse({ ...base, destinationIso2: 'DUBAI' }).success).toBe(false)
  })

  it('rejects malformed slugs', () => {
    expect(universityInput.safeParse({ destinationIso2: 'DE', slug: 'Bad Slug', name: 'X' }).success).toBe(false)
  })
})

describe('courseInput', () => {
  it('rejects a qualification that does not match the level', () => {
    const r = courseInput.safeParse({ universityId: 1, slug: 'msc-data', name: 'MSc Data', qualification: 'master', studyLevel: 'UG' })
    expect(messages(r)).toContain('This qualification does not match the study level.')
  })
})

describe('tuitionFeeInput', () => {
  const base = { courseId: 1, currency: 'EUR', billingPeriod: 'per_year' } as const

  it('accepts a dated, verified decimal amount', () => {
    expect(tuitionFeeInput.safeParse({ ...base, amount: '18500.50', verificationStatus: 'verified', academicYear: '2026-2027' }).success).toBe(true)
  })

  it('rejects floats, negatives, zero and unsupported currencies', () => {
    expect(tuitionFeeInput.safeParse({ ...base, amount: '18500.555' }).success).toBe(false)
    expect(tuitionFeeInput.safeParse({ ...base, amount: '-1' }).success).toBe(false)
    expect(tuitionFeeInput.safeParse({ ...base, amount: '0' }).success).toBe(false)
    expect(tuitionFeeInput.safeParse({ ...base, amount: '100', currency: 'eur' }).success).toBe(false)
    expect(tuitionFeeInput.safeParse({ ...base, amount: '100', currency: 'JPY' }).success).toBe(false)
  })

  it('requires an empty amount for "not available" and a real one otherwise', () => {
    expect(tuitionFeeInput.safeParse({ ...base, amount: null, verificationStatus: 'unavailable' }).success).toBe(true)
    expect(tuitionFeeInput.safeParse({ ...base, amount: '100', verificationStatus: 'unavailable' }).success).toBe(false)
    expect(tuitionFeeInput.safeParse({ ...base, amount: null, verificationStatus: 'verified', academicYear: '2026' }).success).toBe(false)
  })

  it('lets an unverified draft omit the amount (Stage 3: capture of unpublished fees)', () => {
    expect(tuitionFeeInput.safeParse({ ...base, amount: null }).success).toBe(true)
  })

  it('requires a verified fee to say which year it applies to', () => {
    const r = tuitionFeeInput.safeParse({ ...base, amount: '100', verificationStatus: 'verified' })
    expect(messages(r)).toContain('A verified fee needs an academic year or a valid-to date.')
  })

  it('rejects an inverted validity window', () => {
    expect(tuitionFeeInput.safeParse({ ...base, amount: '100', validFrom: '2026-09-01', validTo: '2026-08-31' }).success).toBe(false)
  })
})

describe('acceptanceRateInput', () => {
  const base = { universityId: 1, scope: 'all', cohortLabel: 'Fall 2025 entry' } as const

  it('requires a written definition', () => {
    expect(acceptanceRateInput.safeParse({ ...base, ratePercent: '42', definition: 'rate' }).success).toBe(false)
    expect(acceptanceRateInput.safeParse({ ...base, ratePercent: '42', definition: 'Offers divided by completed applications' }).success).toBe(true)
  })

  it('caps at 100% and ties programme rates to a course', () => {
    const def = 'Offers divided by completed applications'
    expect(acceptanceRateInput.safeParse({ ...base, ratePercent: '101', definition: def }).success).toBe(false)
    expect(acceptanceRateInput.safeParse({ ...base, scope: 'programme', ratePercent: '10', definition: def }).success).toBe(false)
  })
})

describe('rankingInput and rights', () => {
  const base = { universityId: 1, providerId: 1, year: 2026 }

  it('requires exactly one of position or band', () => {
    expect(rankingInput.safeParse({ ...base, position: 12 }).success).toBe(true)
    expect(rankingInput.safeParse({ ...base, bandLow: 501, bandHigh: 510 }).success).toBe(true)
    expect(rankingInput.safeParse(base).success).toBe(false)
    expect(rankingInput.safeParse({ ...base, position: 12, bandLow: 1, bandHigh: 20 }).success).toBe(false)
    expect(rankingInput.safeParse({ ...base, bandLow: 510, bandHigh: 501 }).success).toBe(false)
  })

  it('requires licence evidence before rights can be marked licensed', () => {
    expect(rankingRightsInput.safeParse({ rightsStatus: 'licensed' }).success).toBe(false)
    expect(
      rankingRightsInput.safeParse({ rightsStatus: 'licensed', licenceReference: 'QS-2026-001', licenceScope: 'Web display', rightsCheckedAt: '2026-10-15' }).success,
    ).toBe(true)
    expect(rankingRightsInput.safeParse({ rightsStatus: 'not_required' }).success).toBe(false)
  })
})

describe('verificationInput', () => {
  const schema = verificationInput('2026-10-15')
  const base = { verificationStatus: 'verified', sourceId: 1, checkedAt: '2026-10-15', reviewDueAt: '2027-04-15', verifiedBy: 'admin-1' } as const

  it('accepts a complete verification', () => {
    expect(schema.safeParse(base).success).toBe(true)
  })

  it('rejects future check dates and review dates before the check', () => {
    expect(schema.safeParse({ ...base, checkedAt: '2026-10-16' }).success).toBe(false)
    expect(schema.safeParse({ ...base, reviewDueAt: '2026-10-15' }).success).toBe(false)
  })
})
