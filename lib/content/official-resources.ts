/**
 * Official starting points per destination. These are links, not summaries: we don't restate
 * entry or visa rules until a reviewer has verified them.
 *
 * Check method (15 Oct 2026):
 *   - `http_title` (default): automated live HTTP 200 fetch where the page title and body matched
 *     the official publisher.
 *   - `content_review`: page content was retrieved and inspected to confirm the official publisher
 *     and topic.
 *
 * Links that failed live verification or blocked non-browser requests (403/429/202 WAF challenge
 * or DNS/connection failures) are NOT included in `OFFICIAL_RESOURCES`; they are recorded in
 * `UNRESOLVED_OFFICIAL_LINKS` and RISKS.md R-015 so the public site only lists links verified end-to-end.
 */

export type ResourceKind = 'study_portal' | 'visa' | 'admissions' | 'regulator' | 'scholarships' | 'government'

export interface OfficialResource {
  iso2: string
  title: string
  publisher: string
  url: string
  kind: ResourceKind
  linkCheckedAt: string
  /** Default: automated HTTP 200 + matching title. `content_review`: page content read to confirm publisher and topic. */
  checkMethod?: 'http_title' | 'content_review'
}

export interface UnresolvedOfficialResource {
  iso2: string
  title: string
  publisher: string
  url: string
  kind: ResourceKind
  lastAttemptedAt: string
  status: string
  note: string
}

const CHECKED = '2026-10-15'

export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  study_portal: 'Official study portal',
  visa: 'Student visa',
  admissions: 'Admissions service',
  regulator: 'Higher-education regulator',
  scholarships: 'Scholarships',
  government: 'Government',
}

export const OFFICIAL_RESOURCES: readonly OfficialResource[] = [
  { iso2: 'US', title: 'EducationUSA', publisher: 'U.S. Department of State', url: 'https://educationusa.state.gov/', kind: 'study_portal', linkCheckedAt: CHECKED },
  { iso2: 'US', title: 'Study in the States', publisher: 'U.S. Department of Homeland Security (SEVP)', url: 'https://studyinthestates.dhs.gov/', kind: 'visa', linkCheckedAt: CHECKED, checkMethod: 'content_review' },
  { iso2: 'US', title: 'Students and Employment (F-1 / M-1)', publisher: 'U.S. Citizenship and Immigration Services (USCIS)', url: 'https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/students-and-employment', kind: 'visa', linkCheckedAt: CHECKED, checkMethod: 'content_review' },

  { iso2: 'GB', title: 'Student visa', publisher: 'GOV.UK', url: 'https://www.gov.uk/student-visa', kind: 'visa', linkCheckedAt: CHECKED },
  { iso2: 'GB', title: 'UCAS', publisher: 'UCAS', url: 'https://www.ucas.com/', kind: 'admissions', linkCheckedAt: CHECKED },
  { iso2: 'GB', title: 'Office for Students (England)', publisher: 'Office for Students', url: 'https://www.officeforstudents.org.uk/', kind: 'regulator', linkCheckedAt: CHECKED },

  { iso2: 'CA', title: 'EduCanada', publisher: 'Government of Canada', url: 'https://www.educanada.ca/', kind: 'study_portal', linkCheckedAt: CHECKED },
  { iso2: 'CA', title: 'Study permit', publisher: 'Immigration, Refugees and Citizenship Canada', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html', kind: 'visa', linkCheckedAt: CHECKED, checkMethod: 'content_review' },

  { iso2: 'IT', title: 'Study in Italy', publisher: 'Italian Ministry of Foreign Affairs and International Cooperation', url: 'https://studyinitaly.esteri.it/', kind: 'study_portal', linkCheckedAt: CHECKED, checkMethod: 'content_review' },
  { iso2: 'IT', title: 'Il visto per l’Italia (Visa for Italy)', publisher: 'Ministero degli Affari Esteri e della Cooperazione Internazionale', url: 'https://vistoperitalia.esteri.it/', kind: 'visa', linkCheckedAt: CHECKED, checkMethod: 'content_review' },
  { iso2: 'IT', title: 'Ministry of Foreign Affairs', publisher: 'Ministero degli Affari Esteri e della Cooperazione Internazionale', url: 'https://www.esteri.it/en/', kind: 'government', linkCheckedAt: CHECKED },

  { iso2: 'DE', title: 'DAAD', publisher: 'German Academic Exchange Service', url: 'https://www.daad.de/en/', kind: 'study_portal', linkCheckedAt: CHECKED },
  { iso2: 'DE', title: 'Study in Germany', publisher: 'DAAD', url: 'https://www.study-in-germany.com/en/', kind: 'study_portal', linkCheckedAt: CHECKED },
  { iso2: 'DE', title: 'Visa & Service', publisher: 'Federal Foreign Office', url: 'https://www.auswaertiges-amt.de/en/visa-service', kind: 'visa', linkCheckedAt: CHECKED },

  { iso2: 'AU', title: 'Study Australia', publisher: 'Australian Government', url: 'https://www.studyaustralia.gov.au/', kind: 'study_portal', linkCheckedAt: CHECKED },
  { iso2: 'AU', title: 'Student visa (subclass 500)', publisher: 'Department of Home Affairs', url: 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500', kind: 'visa', linkCheckedAt: CHECKED },
  { iso2: 'AU', title: 'CRICOS Register of Institutions and Courses', publisher: 'Australian Government Department of Education', url: 'https://cricos.education.gov.au/', kind: 'regulator', linkCheckedAt: CHECKED, checkMethod: 'content_review' },

  { iso2: 'NZ', title: 'Immigration New Zealand', publisher: 'New Zealand Government', url: 'https://www.immigration.govt.nz/', kind: 'visa', linkCheckedAt: CHECKED },
  { iso2: 'NZ', title: 'Fee Paying Student Visa', publisher: 'Immigration New Zealand', url: 'https://www.immigration.govt.nz/visas/fee-paying-student-visa/', kind: 'visa', linkCheckedAt: CHECKED, checkMethod: 'content_review' },
  { iso2: 'NZ', title: 'NZQA', publisher: 'New Zealand Qualifications Authority', url: 'https://www2.nzqa.govt.nz/', kind: 'regulator', linkCheckedAt: CHECKED },

  { iso2: 'SA', title: 'Ministry of Education', publisher: 'Kingdom of Saudi Arabia', url: 'https://www.moe.gov.sa/en/Pages/default.aspx', kind: 'government', linkCheckedAt: CHECKED },
  { iso2: 'SA', title: 'KSA Visa Platform', publisher: 'Ministry of Foreign Affairs, Kingdom of Saudi Arabia', url: 'https://visa.mofa.gov.sa/', kind: 'visa', linkCheckedAt: CHECKED, checkMethod: 'content_review' },
  { iso2: 'SA', title: 'Education and Training Evaluation Commission (ETEC)', publisher: 'Kingdom of Saudi Arabia', url: 'https://etec.gov.sa/en', kind: 'regulator', linkCheckedAt: CHECKED, checkMethod: 'content_review' },

  { iso2: 'AE', title: 'Higher education in the UAE', publisher: 'The Official Platform of the UAE Government (U.AE)', url: 'https://u.ae/en/information-and-services/education', kind: 'government', linkCheckedAt: CHECKED },
  { iso2: 'AE', title: 'Residence visa for studying in the UAE', publisher: 'The Official Portal of the UAE Government (U.AE)', url: 'https://u.ae/en/information-and-services/visa-and-emirates-id/Types-of-visas/residence-visa-for-studying-in-the-uae', kind: 'visa', linkCheckedAt: CHECKED, checkMethod: 'content_review' },
  { iso2: 'AE', title: 'Ministry of Higher Education and Scientific Research', publisher: 'UAE Government', url: 'https://www.mohesr.gov.ae/en/Pages/Home.aspx', kind: 'regulator', linkCheckedAt: CHECKED },
  { iso2: 'AE', title: 'Commission for Academic Accreditation (CAA)', publisher: 'UAE Ministry of Higher Education and Scientific Research', url: 'https://caa.ae/', kind: 'regulator', linkCheckedAt: CHECKED, checkMethod: 'content_review' },
  { iso2: 'AE', title: 'Abu Dhabi Department of Education and Knowledge (ADEK)', publisher: 'Government of Abu Dhabi', url: 'https://www.adek.gov.ae/en', kind: 'regulator', linkCheckedAt: CHECKED, checkMethod: 'content_review' },

  { iso2: 'FI', title: 'Study in Finland', publisher: 'Finnish National Agency for Education', url: 'https://www.studyinfinland.fi/', kind: 'study_portal', linkCheckedAt: CHECKED },
  { iso2: 'FI', title: 'Admissions & residence-permit guidance', publisher: 'Finnish National Agency for Education', url: 'https://www.studyinfinland.fi/admissions', kind: 'admissions', linkCheckedAt: CHECKED, checkMethod: 'content_review' },
  { iso2: 'FI', title: 'Opintopolku / Studyinfo national admissions portal', publisher: 'Finnish National Agency for Education', url: 'https://opintopolku.fi/konfo/en/', kind: 'admissions', linkCheckedAt: CHECKED, checkMethod: 'content_review' },

  { iso2: 'PL', title: 'Study in Poland (study.gov.pl)', publisher: 'Polish National Agency for Academic Exchange (NAWA) & Ministry of Science and Higher Education', url: 'https://study.gov.pl/', kind: 'study_portal', linkCheckedAt: CHECKED, checkMethod: 'content_review' },
  { iso2: 'PL', title: 'NAWA', publisher: 'Polish National Agency for Academic Exchange', url: 'https://nawa.gov.pl/en', kind: 'scholarships', linkCheckedAt: CHECKED },
  { iso2: 'PL', title: 'Visas', publisher: 'Ministry of Foreign Affairs of Poland', url: 'https://www.gov.pl/web/diplomacy/visas', kind: 'visa', linkCheckedAt: CHECKED },
]

/**
 * Official portals that could not be verified via automated fetch on 15 Oct 2026 due to WAF/bot
 * challenges or connection failures. Recorded here for transparency and manual browser verification;
 * never rendered as verified on public destination pages until confirmed.
 */
export const UNRESOLVED_OFFICIAL_LINKS: readonly UnresolvedOfficialResource[] = [
  { iso2: 'US', title: 'Student Visa (F / M)', publisher: 'U.S. Department of State — Bureau of Consular Affairs', url: 'https://travel.state.gov/content/travel/en/us-visas/study/student-visa.html', kind: 'visa', lastAttemptedAt: CHECKED, status: 'HTTP 403 (Cloudflare / Akamai bot challenge)', note: 'Blocked to automated fetch; Study in the States (DHS) and USCIS F-1/M-1 pages are verified and listed instead.' },
  { iso2: 'IT', title: 'Universitaly', publisher: 'Italian Ministry of University and Research', url: 'https://www.universitaly.it/', kind: 'study_portal', lastAttemptedAt: CHECKED, status: 'HTTP 202 (empty body / WAF challenge)', note: 'Returned HTTP 202 without page content on re-check; Study in Italy (studyinitaly.esteri.it) and Visa for Italy (vistoperitalia.esteri.it) are verified and listed.' },
  { iso2: 'FI', title: 'Studying in Finland (residence permits)', publisher: 'Finnish Immigration Service (Migri)', url: 'https://migri.fi/en/studying-in-finland', kind: 'visa', lastAttemptedAt: CHECKED, status: 'HTTP 403 (Cloudflare challenge)', note: 'Blocked to automated fetch; Study in Finland admissions page (which links to Migri) and Opintopolku are verified and listed.' },
  { iso2: 'NZ', title: 'Study with New Zealand', publisher: 'Education New Zealand', url: 'https://www.studywithnewzealand.govt.nz/en', kind: 'study_portal', lastAttemptedAt: CHECKED, status: 'HTTP 429 (Vercel Security Checkpoint)', note: 'Blocked to automated fetch; Immigration NZ Fee Paying Student Visa and NZQA are verified and listed.' },
  { iso2: 'AE', title: 'KHDA (Dubai private education regulator)', publisher: 'Knowledge and Human Development Authority, Government of Dubai', url: 'https://web.khda.gov.ae/en/', kind: 'regulator', lastAttemptedAt: CHECKED, status: 'Connection timeout / fetch failed', note: 'Unreachable from verification environment; federal MOHESR, CAA, U.AE and Abu Dhabi ADEK are verified and listed.' },
  { iso2: 'PL', title: 'Go Poland (legacy domain)', publisher: 'Polish National Agency for Academic Exchange (NAWA)', url: 'https://go-poland.pl/', kind: 'study_portal', lastAttemptedAt: CHECKED, status: 'Connection timeout / replaced by study.gov.pl', note: 'Superseded by https://study.gov.pl/, which returned HTTP 200 and is listed in OFFICIAL_RESOURCES.' },
  { iso2: 'SA', title: 'Study in Saudi', publisher: 'Ministry of Education, Kingdom of Saudi Arabia', url: 'https://studyinsaudi.moe.gov.sa/', kind: 'study_portal', lastAttemptedAt: CHECKED, status: 'DNS ENOTFOUND (studyinsaudi.moe.gov.sa)', note: 'Subdomain did not resolve on 15 Oct 2026; MOE, MOFA Visa Platform and ETEC are verified and listed.' },
]

export function getOfficialResources(iso2: string): OfficialResource[] {
  return OFFICIAL_RESOURCES.filter((r) => r.iso2 === iso2)
}
