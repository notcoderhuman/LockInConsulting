// The facts the privacy notice and terms must state about the business (DPDP Act s.8(9), Rules r.9).
// Supplied by the Owner (Dev Gautam) on 7 Nov 2026; never invented. Two different things, kept apart:
//
//   STATUTORY (what the law asks the notice to contain): who the Data Fiduciary is and how to reach the person
//   who answers privacy questions, plus the purposes, data, rights and complaint route written on /privacy.
//   `noticeReady()` checks only that these business details are filled in. New student accounts stay closed in
//   production until it is true (lib/identity/policy.ts studentSignUpOpen).
//
//   INTERNAL (LockIn's own choice): whether a lawyer has reviewed the notice. The Act does not require it, so it
//   does not gate sign-up, but it is never claimed: `LEGAL_REVIEWED` stays false until a lawyer really has,
//   and while false the pages say so plainly and stay out of search engines.
//
// Not supplied, and so not stated anywhere: the registration type of the business (proprietorship, company…),
// a company, GST or other registration number. Changing the notice in substance also needs PRIVACY_NOTICE_VERSION
// bumped (lib/student/onboarding.ts) so existing students are asked to accept it again.

export interface BusinessDetails {
  /** The name the business trades under, exactly as the Owner gave it. */
  legalName: string | null
  /** Postal address. */
  address: string | null
  /** Person who answers questions about personal data (Rules r.9). */
  contactPerson: string | null
  /** Email for privacy requests and grievances. */
  contactEmail: string | null
  /** Phone for privacy requests and grievances. */
  contactPhone: string | null
}

export const BUSINESS: BusinessDetails = {
  legalName: 'LockIn Consulting',
  address: 'B-11 Ashok Vihar, 100ft Road, Dayalbagh, Agra, 282005, India',
  contactPerson: 'Dev Gautam',
  contactEmail: 'lockinconsulting.in@gmail.com',
  contactPhone: '+91 99978 40093',
}

/** True only after a lawyer has really reviewed /privacy and /terms as published. Not a launch gate. */
export const LEGAL_REVIEWED: boolean = false

/** Every business detail is filled in (the statutory content). A lawyer's review is not part of this. */
export function noticeReady(details: BusinessDetails = BUSINESS): boolean {
  return Object.values(details).every((v) => typeof v === 'string' && v.trim().length > 0)
}
