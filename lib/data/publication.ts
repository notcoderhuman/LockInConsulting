import type { IsoDate, RankingProviderRights, VerifiableRecord } from './types'

/**
 * How a record should be presented. Mirrors the CHECK constraints and public_* views in
 * db/migrations so the admin UI can explain *why* something is hidden before the DB rejects it.
 */
export type DisplayState = 'verified' | 'unverified' | 'expired' | 'unavailable' | 'unpublished'

export function todayIso(now: Date = new Date()): IsoDate {
  return now.toISOString().slice(0, 10)
}

export function getDisplayState(record: VerifiableRecord, today: IsoDate): DisplayState {
  if (record.publicationStatus !== 'published') return 'unpublished'
  if (record.verificationStatus === 'unverified') return 'unverified'
  if (!record.reviewDueAt || record.reviewDueAt < today) return 'expired'
  if (record.validTo && record.validTo < today) return 'expired'
  return record.verificationStatus
}

export function isPubliclyVisible(record: VerifiableRecord, today: IsoDate): boolean {
  const state = getDisplayState(record, today)
  return state === 'verified' || state === 'unavailable'
}

export interface PublishOptions {
  /** Tuition fees and acceptance rates may publish a verified "not publicly available" record. */
  allowUnavailable: boolean
}

/** Reasons a record can't be marked verified/unavailable. Empty array = OK. */
export function getVerificationBlockers(record: VerifiableRecord, today: IsoDate): string[] {
  if (record.verificationStatus === 'unverified') return []
  const blockers: string[] = []
  if (record.sourceId == null) blockers.push('Attach a source.')
  if (!record.checkedAt) blockers.push('Record the date the source was checked.')
  else if (record.checkedAt > today) blockers.push('The check date cannot be in the future.')
  if (!record.verifiedAt || !record.verifiedBy) blockers.push('Record who verified it and when.')
  if (!record.reviewDueAt) blockers.push('Set a review-due date.')
  else if (record.checkedAt && record.reviewDueAt <= record.checkedAt)
    blockers.push('The review-due date must be after the check date.')
  return blockers
}

/** Reasons a record can't be published. Empty array = OK. */
export function getPublishBlockers(
  record: VerifiableRecord,
  today: IsoDate,
  { allowUnavailable }: PublishOptions,
): string[] {
  const allowed = allowUnavailable ? ['verified', 'unavailable'] : ['verified']
  const blockers: string[] = []
  if (!allowed.includes(record.verificationStatus)) {
    blockers.push(
      record.verificationStatus === 'unavailable'
        ? 'This record type cannot be published as "not available".'
        : 'Verify the record before publishing.',
    )
  }
  blockers.push(...getVerificationBlockers(record, today))
  if (record.reviewDueAt && record.reviewDueAt < today) blockers.push('The review date has passed. Re-verify first.')
  if (record.validTo && record.validTo < today) blockers.push('The fee validity period has ended.')
  return blockers
}

export function rankingRightsAllowPublication(provider: RankingProviderRights, today: IsoDate): boolean {
  if (provider.rightsStatus === 'not_required') return true
  if (provider.rightsStatus !== 'licensed') return false
  return provider.licenceExpiresAt == null || provider.licenceExpiresAt >= today
}

export function getRankingPublishBlockers(
  ranking: VerifiableRecord,
  provider: RankingProviderRights,
  today: IsoDate,
): string[] {
  const blockers = getPublishBlockers(ranking, today, { allowUnavailable: false })
  if (!rankingRightsAllowPublication(provider, today)) {
    blockers.push(
      provider.rightsStatus === 'licensed'
        ? `The ${provider.name} licence expired on ${provider.licenceExpiresAt}.`
        : `${provider.name} reuse rights are "${provider.rightsStatus}". Rankings stay unpublished until rights are confirmed.`,
    )
  }
  return blockers
}

export function isRankingPubliclyVisible(
  ranking: VerifiableRecord,
  provider: RankingProviderRights,
  today: IsoDate,
): boolean {
  return getDisplayState(ranking, today) === 'verified' && rankingRightsAllowPublication(provider, today)
}
