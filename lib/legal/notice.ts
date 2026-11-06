// The facts the privacy notice and terms must state about the business (DPDP Act s.8(9), Rules r.9)
// and whether a lawyer has reviewed them. Filled in ONLY by the Owner, never invented. Until every
// field is set and `reviewed` is true:
//   - /privacy and /terms show a "Draft pending legal review" banner, are noindex, and show the gaps;
//   - new student accounts stay closed in production (lib/identity/policy.ts studentSignUpOpen).
// Changing anything here in substance also needs PRIVACY_NOTICE_VERSION bumped (lib/student/onboarding.ts).

export interface BusinessDetails {
  /** Registered legal name and form, e.g. "… (sole proprietorship)". */
  legalName: string | null
  /** Registered postal address. */
  address: string | null
  /** Person or role who answers questions about personal data (Rules r.9). */
  contactPerson: string | null
  /** Email for privacy requests and grievances. */
  contactEmail: string | null
  /** Phone for privacy requests and grievances. */
  contactPhone: string | null
}

export const BUSINESS: BusinessDetails = {
  legalName: null,
  address: null,
  contactPerson: null,
  contactEmail: null,
  contactPhone: null,
}

/** Set to true only after a lawyer has reviewed /privacy and /terms as published. */
export const LEGAL_REVIEWED: boolean = false

/** The notice is complete: reviewed, and every business detail filled in. */
export function noticeReady(details: BusinessDetails = BUSINESS, reviewed: boolean = LEGAL_REVIEWED): boolean {
  return reviewed && Object.values(details).every((v) => typeof v === 'string' && v.trim().length > 0)
}
