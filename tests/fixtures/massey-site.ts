// A synthetic stand-in for the parts of massey.ac.nz that matter to one regression: the real URLs, and page text written
// from the facts the Owner supplied on 12 Nov 2026 (not copied from the site). Used only by tests; nothing here is published.
import type { Page } from '@/lib/derek/research'

const BASE = 'https://www.massey.ac.nz'
export const MASSEY = {
  home: `${BASE}/`,
  allQualifications: `${BASE}/study/all-qualifications-and-degrees/`,
  minfsc: `${BASE}/study/all-qualifications-and-degrees/master-of-information-sciences-PMINS/`,
  minfscRegulations: `${BASE}/about/university-calendar-and-regulations/qualification-regulations/master-of-information-sciences/`,
  mscRegulations: `${BASE}/about/university-calendar-and-regulations/qualification-regulations/master-of-science/`,
  analytics: `${BASE}/study/all-qualifications-and-degrees/master-of-analytics-PMANL/`,
  entry: `${BASE}/study/entry-requirements-to-study-at-massey/`,
  apply: `${BASE}/study/admission-and-enrolment/steps-to-apply/`,
  feesHub: `${BASE}/study/fees-and-funding/`,
  fees: `${BASE}/study/fees-and-funding/tuition-fees-for-international-students/`,
  scholarships: `${BASE}/study/fees-and-funding/scholarships/`,
} as const

export const PATHWAYS = [
  'A Bachelor of Information Sciences or equivalent, with a B- average or higher over qualifying 300-level majoring courses.',
  'A bachelor’s degree or equivalent, with a B- average or higher over 300-level majoring courses, plus at least two years of relevant professional experience demonstrated through a portfolio and an interview if required.',
  'A Bachelor of Information Sciences with Honours or Postgraduate Diploma in Information Sciences, or equivalent, with a B- average or higher over qualifying 700-level courses.',
]
export const MINFSC_FEE = 'The tuition fee for the Master of Information Sciences is NZD 38,400 per year for international students.'
export const ANALYTICS_FEE = 'The tuition fee for the Master of Analytics is NZD 41,000 per year for international students.'
export const APPLY_STEPS = [
  'Check that you meet the entry requirements for your qualification before you apply.',
  'Gather your supporting documents: certified academic transcripts, proof of identity and English language evidence.',
  'Apply online through the Massey application portal and upload your documents.',
]
export const SCHOLARSHIP_LINE = 'Massey offers scholarships for international postgraduate students, and eligibility and closing dates differ for each scholarship.'
export const ANALYTICS_RULE = 'Admission to the Master of Analytics requires a bachelor’s degree with a C+ average in statistics or mathematics courses.'

const page = (url: string, title: string, body: string): Page => ({ url, html: `<html><head><title>${title}</title></head><body>${body}</body></html>`, lastModified: null })
const link = (href: string, text: string) => `<a href="${href}">${text}</a>`

export const masseyPages: Record<string, Page> = {
  [MASSEY.home]: page(MASSEY.home, 'Massey University', `${link('/study/all-qualifications-and-degrees/', 'All qualifications and degrees')} ${link('/study/entry-requirements-to-study-at-massey/', 'Entry requirements')} ${link('/study/admission-and-enrolment/steps-to-apply/', 'How to apply: steps to apply')} ${link('/study/fees-and-funding/', 'Fees and scholarships')} ${link('/news/', 'News')}`),
  [MASSEY.allQualifications]: page(
    MASSEY.allQualifications,
    'All qualifications and degrees - Massey University',
    `<ul><li>${link('/study/all-qualifications-and-degrees/master-of-information-sciences-PMINS/', 'Master of Information Sciences')}</li><li>${link('/study/all-qualifications-and-degrees/master-of-analytics-PMANL/', 'Master of Analytics')}</li><li>${link('/about/university-calendar-and-regulations/qualification-regulations/master-of-science/', 'Master of Science')}</li></ul>`,
  ),
  [MASSEY.minfsc]: page(
    MASSEY.minfsc,
    'Master of Information Sciences - Massey University',
    `<p>The Master of Information Sciences (MInfSc) is a 180-credit master’s qualification covering complex computing topics, including machine learning, computer vision and system security.</p>
     <p>Courses are listed under Computer Science, with other information sciences subjects available.</p>
     <h2>Admission requirements</h2><ul>${PATHWAYS.map((p) => `<li>${p}</li>`).join('')}</ul>
     <p>Applicants must also meet the University’s admission requirements and English language requirements.</p>
     ${link('/about/university-calendar-and-regulations/qualification-regulations/master-of-information-sciences/', 'Master of Information Sciences regulations')}`,
  ),
  [MASSEY.minfscRegulations]: page(
    MASSEY.minfscRegulations,
    'Master of Information Sciences - Qualification regulations - Massey University',
    `<p>The Master of Information Sciences is awarded without a subject. Computer Science is among the subjects available under transitional provisions.</p>
     <p>Admission requirements: ${PATHWAYS[0]}</p>`,
  ),
  [MASSEY.mscRegulations]: page(
    MASSEY.mscRegulations,
    'Master of Science - Qualification regulations - Massey University',
    '<p>The Master of Science with a major in Computer Science is not accepting new enrolments.</p>',
  ),
  [MASSEY.analytics]: page(MASSEY.analytics, 'Master of Analytics - Massey University', `<p>${ANALYTICS_RULE}</p><p>Applicants must also meet English language requirements.</p>`),
  [MASSEY.apply]: page(MASSEY.apply, 'Steps to apply - Massey University', `<ol>${APPLY_STEPS.map((x) => `<li>${x}</li>`).join('')}</ol>`),
  [MASSEY.feesHub]: page(MASSEY.feesHub, 'Fees and funding - Massey University', `${link('/study/fees-and-funding/tuition-fees-for-international-students/', 'Tuition fees for international students')} ${link('/study/fees-and-funding/scholarships/', 'Scholarships')}`),
  [MASSEY.fees]: page(MASSEY.fees, 'Tuition fees for international students - Massey University', `<p>${MINFSC_FEE}</p><p>${ANALYTICS_FEE}</p>`),
  [MASSEY.scholarships]: page(MASSEY.scholarships, 'Scholarships - Massey University', `<p>${SCHOLARSHIP_LINE}</p>`),
  [MASSEY.entry]: page(MASSEY.entry, 'Entry requirements to study at Massey University', '<p>Applicants must meet the University’s admission requirements and English language requirements for the qualification they apply for.</p>'),
}
