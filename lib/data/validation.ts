import { z } from 'zod'
import { DESTINATIONS } from '@/lib/destinations'
import {
  APPLICANT_SCOPES,
  BILLING_PERIODS,
  FEE_CATEGORIES,
  QUALIFICATIONS,
  QUALIFICATIONS_BY_LEVEL,
  RIGHTS_STATUSES,
  SOURCE_TYPES,
  STUDY_LEVELS,
  STUDY_MODES,
  SUPPORTED_CURRENCIES,
  VERIFICATION_STATUSES,
} from './types'

// Validation for admin write paths (Phase 10). The DB constraints enforce the same rules; these
// give field-level messages first.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const isoDate = z
  .string()
  .regex(ISO_DATE, 'Use YYYY-MM-DD.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
  }, 'Not a real calendar date.')

export const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .pipe(z.url({ protocol: /^https$/, error: 'Use a full https:// URL.' }))

const slug = z
  .string()
  .max(160)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and single hyphens only.')

const requiredText = (max: number) => z.string().trim().min(1, 'Required.').max(max)

const destinationIso2 = z.enum(DESTINATIONS.map((d) => d.iso2) as [string, ...string[]], {
  error: 'Not one of the 11 LockIn destinations.',
})

export const currencyCode = z.enum(SUPPORTED_CURRENCIES, { error: 'Unsupported currency code.' })

/** Positive decimal string with up to 2 places — never a float. */
export const moneyAmount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount like 18500 or 18500.50.')
  .refine((v) => Number(v) > 0, 'Amount must be greater than zero.')

export const academicYear = z
  .string()
  .regex(/^\d{4}(-\d{4})?$/, 'Use 2026 or 2026-2027.')
  .refine((v) => {
    const [a, b] = v.split('-').map(Number)
    return b === undefined || b === a + 1
  }, 'The second year must follow the first.')

export const sourceInput = z.object({
  url: httpsUrl,
  title: requiredText(300),
  publisher: requiredText(200),
  sourceType: z.enum(SOURCE_TYPES),
  notes: z.string().max(5000).optional(),
})

export const universityInput = z.object({
  destinationIso2,
  slug,
  name: requiredText(255),
  officialWebsite: httpsUrl.optional(),
  city: z.string().trim().max(120).optional(),
  subRegion: z.string().trim().max(120).optional(),
  institutionType: z.enum(['public', 'private', 'unknown']).default('unknown'),
})

export const courseInput = z
  .object({
    universityId: z.number().int().positive(),
    slug,
    name: requiredText(255),
    qualification: z.enum(QUALIFICATIONS),
    studyLevel: z.enum(STUDY_LEVELS),
    durationMonths: z.number().int().min(1).max(120).optional(),
    studyMode: z.enum(STUDY_MODES).optional(),
    teachingLanguage: z.string().trim().max(60).optional(),
    entryRequirements: z.string().trim().max(10_000).optional(),
    languageRequirements: z.string().trim().max(10_000).optional(),
    courseUrl: httpsUrl.optional(),
  })
  .refine((c) => QUALIFICATIONS_BY_LEVEL[c.studyLevel].includes(c.qualification), {
    path: ['qualification'],
    message: 'This qualification does not match the study level.',
  })

export const intakeInput = z.object({
  courseId: z.number().int().positive(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100).optional(),
  applicationDeadline: isoDate.optional(),
})

export const tuitionFeeInput = z
  .object({
    courseId: z.number().int().positive(),
    category: z.enum(FEE_CATEGORIES).default('international'),
    verificationStatus: z.enum(VERIFICATION_STATUSES).default('unverified'),
    amount: moneyAmount.nullable(),
    currency: currencyCode,
    billingPeriod: z.enum(BILLING_PERIODS),
    academicYear: academicYear.optional(),
    validFrom: isoDate.optional(),
    validTo: isoDate.optional(),
    notes: z.string().max(5000).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.verificationStatus === 'unavailable' && f.amount !== null)
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Leave the amount empty when the fee is not publicly available.' })
    // Drafts may omit the amount (the source may not publish one); 0002_admin_auth.sql matches.
    if (f.verificationStatus === 'verified' && f.amount === null)
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter the published amount, or mark it as not available.' })
    if (f.verificationStatus === 'verified' && !f.academicYear && !f.validTo)
      ctx.addIssue({ code: 'custom', path: ['academicYear'], message: 'A verified fee needs an academic year or a valid-to date.' })
    if (f.validFrom && f.validTo && f.validTo < f.validFrom)
      ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Valid-to must be on or after valid-from.' })
  })

export const acceptanceRateInput = z
  .object({
    universityId: z.number().int().positive(),
    courseId: z.number().int().positive().optional(),
    verificationStatus: z.enum(VERIFICATION_STATUSES).default('unverified'),
    ratePercent: z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a percentage like 42 or 42.5.')
      .refine((v) => Number(v) <= 100, 'Cannot exceed 100%.')
      .nullable(),
    definition: z.string().trim().min(10, 'Explain exactly what the rate measures, as stated by the source.').max(2000),
    scope: z.enum(APPLICANT_SCOPES),
    cohortLabel: requiredText(60),
  })
  .superRefine((a, ctx) => {
    if (a.scope === 'programme' && !a.courseId)
      ctx.addIssue({ code: 'custom', path: ['courseId'], message: 'A programme-level rate must reference its course.' })
    if (a.verificationStatus === 'unavailable' && a.ratePercent !== null)
      ctx.addIssue({ code: 'custom', path: ['ratePercent'], message: 'Leave the rate empty when it is not publicly available.' })
    if (a.verificationStatus === 'verified' && a.ratePercent === null)
      ctx.addIssue({ code: 'custom', path: ['ratePercent'], message: 'Enter the published rate, or mark it as not available.' })
  })

export const rankingInput = z
  .object({
    universityId: z.number().int().positive(),
    providerId: z.number().int().positive(),
    year: z.number().int().min(2000).max(2100),
    edition: z.string().trim().max(120).optional(),
    subject: z.string().trim().max(120).default(''),
    position: z.number().int().positive().optional(),
    bandLow: z.number().int().positive().optional(),
    bandHigh: z.number().int().positive().optional(),
  })
  .superRefine((r, ctx) => {
    const hasPosition = r.position !== undefined
    const hasBand = r.bandLow !== undefined || r.bandHigh !== undefined
    if (hasPosition === hasBand)
      ctx.addIssue({ code: 'custom', path: ['position'], message: 'Enter either an exact position or a band, not both.' })
    if (hasBand && (r.bandLow === undefined || r.bandHigh === undefined))
      ctx.addIssue({ code: 'custom', path: ['bandHigh'], message: 'A band needs both a low and a high value.' })
    if (r.bandLow !== undefined && r.bandHigh !== undefined && r.bandLow > r.bandHigh)
      ctx.addIssue({ code: 'custom', path: ['bandHigh'], message: 'The band high value must be at least the low value.' })
  })

export const rankingRightsInput = z
  .object({
    rightsStatus: z.enum(RIGHTS_STATUSES),
    licenceReference: z.string().trim().max(200).optional(),
    licenceScope: z.string().trim().max(5000).optional(),
    licenceExpiresAt: isoDate.optional(),
    rightsCheckedAt: isoDate.optional(),
    rightsNotes: z.string().trim().max(5000).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.rightsStatus === 'licensed') {
      if (!r.licenceReference) ctx.addIssue({ code: 'custom', path: ['licenceReference'], message: 'Record the licence reference.' })
      if (!r.licenceScope) ctx.addIssue({ code: 'custom', path: ['licenceScope'], message: 'Describe what the licence permits.' })
      if (!r.rightsCheckedAt) ctx.addIssue({ code: 'custom', path: ['rightsCheckedAt'], message: 'Record when the licence was confirmed.' })
    }
    if (r.rightsStatus === 'not_required' && (!r.rightsCheckedAt || !r.rightsNotes))
      ctx.addIssue({ code: 'custom', path: ['rightsNotes'], message: 'Explain why no licence is required and when this was checked.' })
  })

/** Built per request so "not in the future" uses the current date. */
export function verificationInput(today: string) {
  return z
    .object({
      verificationStatus: z.enum(['verified', 'unavailable']),
      sourceId: z.number().int().positive(),
      checkedAt: isoDate,
      reviewDueAt: isoDate,
      verifiedBy: requiredText(191),
      notes: z.string().max(5000).optional(),
    })
    .superRefine((v, ctx) => {
      if (v.checkedAt > today) ctx.addIssue({ code: 'custom', path: ['checkedAt'], message: 'The check date cannot be in the future.' })
      if (v.reviewDueAt <= v.checkedAt)
        ctx.addIssue({ code: 'custom', path: ['reviewDueAt'], message: 'The review-due date must be after the check date.' })
    })
}

// ---- Stage 3 admin inputs ----

export const campusInput = z.object({
  universityId: z.number().int().positive(),
  name: requiredText(200),
  city: z.string().trim().max(120).optional(),
  subRegion: z.string().trim().max(120).optional(),
  isMain: z.boolean().default(false),
})

/** A new source must record when the editor retrieved it (not in the future). */
export function sourceCaptureInput(today: string) {
  return sourceInput.extend({
    retrievedAt: isoDate.refine((v) => v <= today, 'The retrieval date cannot be in the future.'),
  })
}

/** Unpublish / return-to-draft reasons are stored on the record and in the audit log. */
export const reasonInput = z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(500)

export const FX_TERMS_STATUSES = ['not_reviewed', 'approved', 'rejected'] as const

export const fxProviderTermsInput = z
  .object({
    termsStatus: z.enum(FX_TERMS_STATUSES),
    currenciesCovered: z.string().trim().max(300).optional(),
    attributionText: z.string().trim().max(500).optional(),
    updateFrequency: z.string().trim().max(200).optional(),
    termsCheckedAt: isoDate.optional(),
    termsNotes: z.string().trim().max(5000).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.termsStatus !== 'approved') return
    const required = ['currenciesCovered', 'attributionText', 'updateFrequency', 'termsCheckedAt'] as const
    for (const key of required)
      if (!p[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required before the provider can be approved.' })
  })

/** Exchange rates are entered as decimal strings (never floats), quoted as INR per unit. */
export function fxRateInput(today: string) {
  return z.object({
    providerId: z.number().int().positive(),
    sourceId: z.number().int().positive(),
    baseCurrency: currencyCode.refine((c) => c !== 'INR', 'The base currency cannot be INR.'),
    rate: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,10})?$/, 'Enter a decimal rate like 23.4512.')
      .refine((v) => Number(v) > 0, 'The rate must be greater than zero.'),
    rateDate: isoDate.refine((v) => v <= today, 'The rate date cannot be in the future.'),
  })
}
