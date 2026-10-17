import { describe, expect, it } from 'vitest'
import { convertToInr, daysBetween } from '@/lib/data/money'
import {
  getDisplayState,
  getPublishBlockers,
  getRankingPublishBlockers,
  isPubliclyVisible,
  isRankingPubliclyVisible,
  rankingRightsAllowPublication,
} from '@/lib/data/publication'
import type { RankingProviderRights, VerifiableRecord } from '@/lib/data/types'

const TODAY = '2026-10-15'

const verified: VerifiableRecord = {
  publicationStatus: 'published',
  verificationStatus: 'verified',
  sourceId: 1,
  checkedAt: '2026-10-01',
  verifiedAt: '2026-10-01 10:00:00',
  verifiedBy: 'admin-1',
  reviewDueAt: '2027-01-01',
}

describe('getDisplayState', () => {
  it('distinguishes all five states', () => {
    expect(getDisplayState(verified, TODAY)).toBe('verified')
    expect(getDisplayState({ ...verified, verificationStatus: 'unavailable' }, TODAY)).toBe('unavailable')
    expect(getDisplayState({ ...verified, verificationStatus: 'unverified' }, TODAY)).toBe('unverified')
    expect(getDisplayState({ ...verified, reviewDueAt: '2026-10-14' }, TODAY)).toBe('expired')
    expect(getDisplayState({ ...verified, validTo: '2026-08-31' }, TODAY)).toBe('expired')
    expect(getDisplayState({ ...verified, publicationStatus: 'unpublished' }, TODAY)).toBe('unpublished')
    expect(getDisplayState({ ...verified, publicationStatus: 'draft' }, TODAY)).toBe('unpublished')
  })

  it('treats a missing review date as expired, never as verified', () => {
    expect(getDisplayState({ ...verified, reviewDueAt: null }, TODAY)).toBe('expired')
  })

  it('stays visible on the review-due date itself', () => {
    expect(isPubliclyVisible({ ...verified, reviewDueAt: TODAY }, TODAY)).toBe(true)
  })
})

describe('getPublishBlockers', () => {
  it('allows a fully verified record', () => {
    expect(getPublishBlockers(verified, TODAY, { allowUnavailable: false })).toEqual([])
  })

  it('blocks unverified, unsourced and undated records', () => {
    const draft: VerifiableRecord = { ...verified, verificationStatus: 'unverified', sourceId: null, checkedAt: null }
    expect(getPublishBlockers(draft, TODAY, { allowUnavailable: true })).toContain('Verify the record before publishing.')
    const noSource = getPublishBlockers({ ...verified, sourceId: null, checkedAt: null }, TODAY, { allowUnavailable: false })
    expect(noSource).toEqual(expect.arrayContaining(['Attach a source.', 'Record the date the source was checked.']))
  })

  it('blocks future check dates and stale reviews', () => {
    expect(getPublishBlockers({ ...verified, checkedAt: '2026-12-01' }, TODAY, { allowUnavailable: false })).toContain(
      'The check date cannot be in the future.',
    )
    expect(getPublishBlockers({ ...verified, reviewDueAt: '2026-10-01' }, TODAY, { allowUnavailable: false }).length).toBeGreaterThan(0)
  })

  it('only allows "not available" records where the type permits it', () => {
    const unavailable = { ...verified, verificationStatus: 'unavailable' as const }
    expect(getPublishBlockers(unavailable, TODAY, { allowUnavailable: true })).toEqual([])
    expect(getPublishBlockers(unavailable, TODAY, { allowUnavailable: false }).length).toBe(1)
  })
})

describe('ranking publication controls', () => {
  const qs = (overrides: Partial<RankingProviderRights> = {}): RankingProviderRights => ({
    name: 'QS',
    rightsStatus: 'not_confirmed',
    licenceExpiresAt: null,
    ...overrides,
  })

  it('never publishes a ranking without confirmed rights, even when verified', () => {
    for (const status of ['not_confirmed', 'requested', 'denied'] as const) {
      expect(rankingRightsAllowPublication(qs({ rightsStatus: status }), TODAY)).toBe(false)
      expect(isRankingPubliclyVisible(verified, qs({ rightsStatus: status }), TODAY)).toBe(false)
      expect(getRankingPublishBlockers(verified, qs({ rightsStatus: status }), TODAY).join(' ')).toMatch(/rights/)
    }
  })

  it('publishes under an active licence and stops when it expires', () => {
    expect(isRankingPubliclyVisible(verified, qs({ rightsStatus: 'licensed' }), TODAY)).toBe(true)
    expect(isRankingPubliclyVisible(verified, qs({ rightsStatus: 'licensed', licenceExpiresAt: '2026-12-31' }), TODAY)).toBe(true)
    const expired = qs({ rightsStatus: 'licensed', licenceExpiresAt: '2026-10-14' })
    expect(isRankingPubliclyVisible(verified, expired, TODAY)).toBe(false)
    expect(getRankingPublishBlockers(verified, expired, TODAY).join(' ')).toMatch(/expired/)
  })

  it('still requires the ranking itself to be verified when rights are fine', () => {
    const licensed = qs({ rightsStatus: 'licensed' })
    expect(isRankingPubliclyVisible({ ...verified, verificationStatus: 'unverified' }, licensed, TODAY)).toBe(false)
    expect(isRankingPubliclyVisible({ ...verified, verificationStatus: 'unavailable' }, licensed, TODAY)).toBe(false)
  })
})

describe('convertToInr', () => {
  const fx = {
    rate: '108.5',
    rateDate: '2026-10-14',
    sourceTitle: 'ECB reference rates',
    sourceUrl: 'https://example.org/fx',
    providerName: 'European Central Bank',
    attributionText: 'Source: European Central Bank',
  }

  it('converts with the rate, date, source and attribution attached', () => {
    expect(convertToInr('1000.00', 'EUR', fx, TODAY)).toEqual({
      amountInr: 108500,
      rate: '108.5',
      rateDate: '2026-10-14',
      sourceTitle: 'ECB reference rates',
      sourceUrl: 'https://example.org/fx',
      providerName: 'European Central Bank',
      attributionText: 'Source: European Central Bank',
    })
  })

  it('shows nothing rather than a stale, future or missing rate', () => {
    expect(convertToInr('1000', 'EUR', { ...fx, rateDate: '2026-10-01' }, TODAY)).toBeNull()
    expect(convertToInr('1000', 'EUR', { ...fx, rateDate: '2026-10-16' }, TODAY)).toBeNull()
    expect(convertToInr('1000', 'EUR', undefined, TODAY)).toBeNull()
    expect(convertToInr(null, 'EUR', fx, TODAY)).toBeNull()
    expect(convertToInr('1000', 'INR', fx, TODAY)).toBeNull()
  })

  it('counts days across month boundaries', () => {
    expect(daysBetween('2026-09-30', '2026-10-07')).toBe(7)
  })
})
