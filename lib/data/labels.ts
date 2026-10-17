import type { ApplicantScope, BillingPeriod, FeeCategory, Qualification, StudyMode } from './types'

export const QUALIFICATION_LABEL: Record<Qualification, string> = {
  foundation: 'Foundation',
  certificate: 'Certificate',
  diploma: 'Diploma',
  bachelor: "Bachelor's",
  master: "Master's",
  doctorate: 'Doctorate',
  other: 'Other',
}

export const BILLING_PERIOD_LABEL: Record<BillingPeriod, string> = {
  per_year: 'per year',
  per_semester: 'per semester',
  per_term: 'per term',
  per_credit: 'per credit',
  total_programme: 'whole programme',
}

export const FEE_CATEGORY_LABEL: Record<FeeCategory, string> = {
  international: 'International',
  domestic: 'Domestic',
  eu_eea: 'EU/EEA',
  other: 'Other',
}

export const STUDY_MODE_LABEL: Record<StudyMode, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  online: 'Online',
  blended: 'Blended',
}

export const APPLICANT_SCOPE_LABEL: Record<ApplicantScope, string> = {
  all: 'All applicants',
  international: 'International applicants',
  domestic: 'Domestic applicants',
  programme: 'This programme',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function monthLabel(month: number): string {
  return MONTHS[month - 1] ?? String(month)
}

export function formatDuration(months: number | null): string | null {
  if (months == null) return null
  if (months % 12 === 0) return `${months / 12} ${months === 12 ? 'year' : 'years'}`
  return `${months} months`
}
