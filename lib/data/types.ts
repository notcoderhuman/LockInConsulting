// Mirrors the ENUMs in db/migrations. tests/db/migrations.db.test.ts fails if they drift.

export const PUBLICATION_STATUSES = ['draft', 'in_review', 'published', 'unpublished'] as const
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]

export const VERIFICATION_STATUSES = ['unverified', 'verified', 'unavailable'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const SOURCE_TYPES = [
  'university_official',
  'government',
  'regulator',
  'ranking_provider',
  'exchange_rate_provider',
  'other',
] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const QUALIFICATIONS = ['foundation', 'certificate', 'diploma', 'bachelor', 'master', 'doctorate', 'other'] as const
export type Qualification = (typeof QUALIFICATIONS)[number]

export const STUDY_LEVELS = ['UG', 'PG'] as const
export type StudyLevel = (typeof STUDY_LEVELS)[number]

export const QUALIFICATIONS_BY_LEVEL: Record<StudyLevel, readonly Qualification[]> = {
  UG: ['foundation', 'certificate', 'diploma', 'bachelor', 'other'],
  PG: ['certificate', 'diploma', 'master', 'doctorate', 'other'],
}

export const STUDY_MODES = ['full_time', 'part_time', 'online', 'blended'] as const
export type StudyMode = (typeof STUDY_MODES)[number]

export const FEE_CATEGORIES = ['international', 'domestic', 'eu_eea', 'other'] as const
export type FeeCategory = (typeof FEE_CATEGORIES)[number]

export const BILLING_PERIODS = ['per_year', 'per_semester', 'per_term', 'per_credit', 'total_programme'] as const
export type BillingPeriod = (typeof BILLING_PERIODS)[number]

export const APPLICANT_SCOPES = ['all', 'international', 'domestic', 'programme'] as const
export type ApplicantScope = (typeof APPLICANT_SCOPES)[number]

export const RIGHTS_STATUSES = ['not_confirmed', 'requested', 'licensed', 'denied', 'not_required'] as const
export type RightsStatus = (typeof RIGHTS_STATUSES)[number]

/** Currencies in use across the 11 destinations, plus INR for conversions. */
export const SUPPORTED_CURRENCIES = ['USD', 'GBP', 'CAD', 'EUR', 'AUD', 'NZD', 'SAR', 'AED', 'PLN', 'INR'] as const
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]

/** ISO calendar date, `YYYY-MM-DD`. Compared lexicographically. */
export type IsoDate = string

/** The verification columns shared by every fact table. */
export interface VerifiableRecord {
  publicationStatus: PublicationStatus
  verificationStatus: VerificationStatus
  sourceId: number | null
  checkedAt: IsoDate | null
  verifiedAt: string | null
  verifiedBy: string | null
  reviewDueAt: IsoDate | null
  /** Only tuition fees carry a validity end date. */
  validTo?: IsoDate | null
}

export interface RankingProviderRights {
  name: string
  rightsStatus: RightsStatus
  licenceExpiresAt: IsoDate | null
}

// ---- Public read model (what the destination pages render) ----

export interface SourceRef {
  url: string
  title: string
  publisher: string
  checkedAt: IsoDate
}

export interface InrConversion {
  amountInr: number
  rate: string
  rateDate: IsoDate
  sourceTitle: string
  sourceUrl: string
  providerName?: string
  attributionText?: string
}

export interface PublicTuitionFee {
  id: number
  category: FeeCategory
  /** Decimal string in the original currency; null when verified as not publicly available. */
  amount: string | null
  currency: string
  billingPeriod: BillingPeriod
  academicYear: string | null
  validTo: IsoDate | null
  notes: string | null
  status: 'verified' | 'unavailable'
  source: SourceRef
  inr: InrConversion | null
}

export interface PublicIntake {
  id: number
  month: number
  year: number | null
  applicationDeadline: IsoDate | null
  source: SourceRef
}

export interface PublicCourse {
  id: number
  name: string
  qualification: Qualification
  studyLevel: StudyLevel
  durationMonths: number | null
  studyMode: StudyMode | null
  teachingLanguage: string | null
  entryRequirements: string | null
  languageRequirements: string | null
  courseUrl: string | null
  source: SourceRef
  intakes: PublicIntake[]
  fees: PublicTuitionFee[]
}

export interface PublicAcceptanceRate {
  id: number
  courseId: number | null
  ratePercent: string | null
  definition: string
  scope: ApplicantScope
  cohortLabel: string
  status: 'verified' | 'unavailable'
  source: SourceRef
}

export interface PublicRanking {
  id: number
  providerName: string
  year: number
  edition: string | null
  subject: string
  position: number | null
  bandLow: number | null
  bandHigh: number | null
  source: SourceRef
}

export interface PublicUniversity {
  id: number
  slug: string
  name: string
  officialWebsite: string
  city: string | null
  subRegion: string | null
  institutionType: 'public' | 'private' | 'unknown'
  source: SourceRef
  courses: PublicCourse[]
  acceptanceRates: PublicAcceptanceRate[]
  rankings: PublicRanking[]
}

export type DirectoryResult =
  | { state: 'ready'; universities: PublicUniversity[] }
  | { state: 'not_configured' }
  | { state: 'error' }
