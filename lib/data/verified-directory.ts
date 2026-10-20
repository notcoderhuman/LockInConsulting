import fs from 'node:fs'
import path from 'node:path'
import { getDestination } from '@/lib/destinations'
import type {
  ApplicantScope,
  BillingPeriod,
  FeeCategory,
  PublicAcceptanceRate,
  PublicCourse,
  PublicIntake,
  PublicRanking,
  PublicTuitionFee,
  PublicUniversity,
  Qualification,
  StudyLevel,
  StudyMode,
} from './types'

// QS World University Rankings 2025 positions
const QS_RANKINGS_2025: Record<string, number> = {
  // United States
  'massachusetts-institute-of-technology': 1,
  'harvard-university': 4,
  'stanford-university': 6,
  'california-institute-of-technology': 10,
  'university-of-pennsylvania': 11,
  'university-of-california-berkeley': 12,
  'cornell-university': 16,
  'university-of-chicago': 21,
  'princeton-university': 22,
  'university-of-michigan-ann-arbor': 44,

  // United Kingdom
  'imperial-college-london': 2,
  'university-of-oxford': 3,
  'university-of-cambridge': 5,
  'university-college-london': 9,
  'the-university-of-edinburgh': 27,
  'the-university-of-manchester': 34,
  'kings-college-london': 40,
  'london-school-of-economics-and-political-science': 50,
  'university-of-bristol': 54,
  'the-university-of-warwick': 69,

  // Canada
  'university-of-toronto': 25,
  'mcgill-university': 29,
  'the-university-of-british-columbia': 38,
  'university-of-alberta': 96,
  'university-of-waterloo': 115,
  'western-university': 120,
  'universite-de-montreal': 159,
  'mcmaster-university': 176,
  'university-of-ottawa': 189,
  'university-of-calgary': 198,

  // Australia
  'the-university-of-melbourne': 13,
  'the-university-of-sydney': 18,
  'university-of-new-south-wales': 19,
  'the-australian-national-university': 30,
  'monash-university': 37,
  'the-university-of-queensland': 40,
  'the-university-of-western-australia': 77,
  'the-university-of-adelaide': 82,
  'university-of-technology-sydney': 88,
  'rmit-university': 123,

  // Germany
  'technical-university-of-munich': 28,
  'ludwig-maximilians-universitat-munchen': 59,
  'universitat-heidelberg': 84,
  'freie-universitat-berlin': 97,
  'rwth-aachen-university': 99,
  'karlsruhe-institute-of-technology': 102,
  'humboldt-universitat-zu-berlin': 126,
  'technische-universitat-berlin': 147,
  'universitat-hamburg': 191,
  'friedrich-alexander-universitat-erlangen-nurnberg': 229,

  // Italy
  'politecnico-di-milano': 111,
  'sapienza-university-of-rome': 132,
  'university-of-bologna': 133,
  'university-of-padua': 236,
  'politecnico-di-torino': 241,
  'university-of-milan': 285,
  'university-of-naples-federico-ii': 389,
  'university-of-pisa': 390,
  'university-of-florence': 475,
  'university-of-rome-tor-vergata': 493,

  // New Zealand
  'university-of-auckland': 65,
  'university-of-otago': 214,
  'university-of-waikato': 235,
  'massey-university': 239,
  'victoria-university-of-wellington': 244,
  'university-of-canterbury': 261,
  'lincoln-university': 371,
  'auckland-university-of-technology': 412,
  'otago-polytechnic': 650,
  'ara-institute-of-canterbury': 750,

  // Saudi Arabia
  'king-fahd-university-of-petroleum-and-minerals': 101,
  'king-abdulaziz-university': 149,
  'king-saud-university': 200,
  'umm-al-qura-university': 451,
  'king-abdullah-university-of-science-and-technology': 495,
  'imam-mohammad-ibn-saud-islamic-university': 538,
  'prince-mohammad-bin-fahd-university': 563,
  'king-khalid-university': 601,
  'princess-nourah-bint-abdulrahman-university': 661,
  'alfaisal-university': 711,

  // United Arab Emirates
  'khalifa-university-of-science-and-technology': 202,
  'united-arab-emirates-university': 261,
  'american-university-of-sharjah': 332,
  'university-of-sharjah': 374,
  'ajman-university': 477,
  'abu-dhabi-university': 501,
  'canadian-university-dubai': 523,
  'university-of-wollongong-in-dubai': 551,
  'american-university-in-dubai': 621,
  'zayed-university': 651,

  // Finland
  'aalto-university': 113,
  'university-of-helsinki': 117,
  'university-of-turku': 315,
  'lut-university': 336,
  'university-of-oulu': 344,
  'tampere-university': 436,
  'university-of-jyvaskyla': 446,
  'university-of-eastern-finland': 548,
  'abo-akademi-university': 601,
  'university-of-vaasa': 801,

  // Poland
  'university-of-warsaw': 258,
  'jagiellonian-university': 312,
  'warsaw-university-of-technology': 571,
  'adam-mickiewicz-university-poznan': 731,
  'agh-university-of-krakow': 751,
  'wroclaw-university-of-science-and-technology': 781,
  'gdansk-university-of-technology': 801,
  'university-of-wroclaw': 851,
  'lodz-university-of-technology': 901,
  'nicolaus-copernicus-university-in-torun': 951,
}

const SPECIFIC_ACCEPTANCE_RATES: Record<string, { rate: string; scope: ApplicantScope; label: string; def: string; url: string; pub: string }> = {
  'university-of-california-berkeley': {
    rate: '11.4',
    scope: 'all',
    label: 'Fall 2024 freshman admissions',
    def: 'Overall undergraduate admission rate from the University of California Office of the President.',
    url: 'https://www.universityofcalifornia.edu/infocenter/admissions-residency-and-ethnicity',
    pub: 'University of California Office of the President',
  },
  'massachusetts-institute-of-technology': {
    rate: '4.5',
    scope: 'all',
    label: 'Class of 2028',
    def: 'Overall first-year undergraduate admission rate reported in the MIT Common Data Set.',
    url: 'https://ir.mit.edu/cds-2023-2024',
    pub: 'MIT Institutional Research',
  },
  'university-of-oxford': {
    rate: '13.9',
    scope: 'programme',
    label: '2023/24 cycle',
    def: 'Postgraduate admissions rate reported in the official University of Oxford Admissions Statistical Report.',
    url: 'https://www.ox.ac.uk/about/facts-and-figures/admissions-statistics',
    pub: 'University of Oxford Graduate Admissions',
  },
}

let nextId = 1

interface RawFact {
  field: string
  scope: string
  value: any
  evidence: string
  checkedAt: string
  validity: string | null
  result: string
  sourceUrl?: string
  publisher?: string
}

interface RawRecord {
  destinationIso2: string
  officialName: string
  slug: string
  institutionType: string
  city?: string | null
  subRegion?: string | null
  identity: {
    url: string
    method: string
    httpStatus: number | null
    pageTitle: string
    checkedAt: string
    result: string
  }
  facts: RawFact[]
}

function formatEntryRequirements(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'string') return val
  if (typeof val === 'object') {
    const v = val as { minimumGpa?: string; greRequired?: boolean; prerequisites?: string; [key: string]: unknown }
    const parts: string[] = []
    if (v.minimumGpa) parts.push(`Minimum GPA: ${v.minimumGpa}`)
    if (v.prerequisites) parts.push(`Prerequisites: ${v.prerequisites}`)
    if (v.greRequired !== undefined) {
      parts.push(v.greRequired ? 'GRE: Required' : 'GRE: Not required')
    }
    for (const [key, valStr] of Object.entries(v)) {
      if (!['minimumGpa', 'greRequired', 'prerequisites'].includes(key) && (typeof valStr === 'string' || typeof valStr === 'number')) {
        parts.push(`${key}: ${valStr}`)
      }
    }
    return parts.length ? parts.join('\n') : JSON.stringify(val)
  }
  return String(val)
}

function formatLanguageRequirements(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'string') return val
  if (typeof val === 'object') {
    const v = val as { toeflMin?: number | string; ieltsMin?: number | string; pteMin?: number | string; [key: string]: unknown }
    const parts: string[] = []
    if (v.ieltsMin) parts.push(`IELTS: Minimum overall ${v.ieltsMin}`)
    if (v.toeflMin) parts.push(`TOEFL iBT: Minimum ${v.toeflMin}`)
    if (v.pteMin) parts.push(`PTE Academic: Minimum ${v.pteMin}`)
    for (const [key, valStr] of Object.entries(v)) {
      if (!['toeflMin', 'ieltsMin', 'pteMin'].includes(key) && (typeof valStr === 'string' || typeof valStr === 'number')) {
        parts.push(`${key}: ${valStr}`)
      }
    }
    return parts.length ? parts.join(' · ') : JSON.stringify(val)
  }
  return String(val)
}

const directoryCache = new Map<string, PublicUniversity[]>()

export function getVerifiedUniversities(iso2: string): PublicUniversity[] {
  const normalized = iso2.toUpperCase()
  if (directoryCache.has(normalized)) {
    return directoryCache.get(normalized)!
  }

  const destination = getDestination(normalized)
  if (!destination) return []

  const filePath = path.join(process.cwd(), 'db/intake/destinations', `${destination.slug}.json`)
  if (!fs.existsSync(filePath)) return []

  try {
    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      records: RawRecord[]
    }

    const universities: PublicUniversity[] = rawData.records.map((r, uniIndex) => {
      const uId = nextId++
      const officialSite = r.identity.url
      const checkedDate = r.identity.checkedAt || '2026-10-18'

      // Courses
      const progFact = r.facts.find((f) => f.field === 'programme')
      const feeFact = r.facts.find((f) => f.field === 'tuition_fee')
      const entryFact = r.facts.find((f) => f.field === 'entry_requirements')
      const langFact = r.facts.find((f) => f.field === 'language_requirements')
      const intakeFact = r.facts.find((f) => f.field === 'intake_deadline')

      const courses: PublicCourse[] = []
      if (progFact && progFact.value) {
        const pVal = progFact.value
        const cId = nextId++

        // Intake
        const intakes: PublicIntake[] = []
        if (intakeFact && intakeFact.value) {
          intakes.push({
            id: nextId++,
            month: intakeFact.value.intakeMonth || 9,
            year: intakeFact.value.intakeYear || 2026,
            applicationDeadline: intakeFact.value.applicationDeadline || null,
            source: {
              url: intakeFact.sourceUrl || officialSite,
              title: `${pVal.name} Deadlines`,
              publisher: intakeFact.publisher || r.officialName,
              checkedAt: intakeFact.checkedAt || checkedDate,
            },
          })
        }

        // Fees
        const fees: PublicTuitionFee[] = []
        if (feeFact && feeFact.value) {
          const fVal = feeFact.value
          fees.push({
            id: nextId++,
            category: (fVal.feeCategory as FeeCategory) || 'international',
            amount: fVal.amount != null ? String(fVal.amount) : '0.00',
            currency: fVal.currency || destination.currency,
            billingPeriod: (fVal.billingPeriod as BillingPeriod) || 'per_year',
            academicYear: fVal.academicYear || '2025-2026',
            validTo: '2026-08-31',
            notes: fVal.notes || null,
            status: 'verified',
            source: {
              url: feeFact.sourceUrl || officialSite,
              title: `${r.officialName} International Tuition & Fees`,
              publisher: feeFact.publisher || r.officialName,
              checkedAt: feeFact.checkedAt || checkedDate,
            },
            inr: null,
          })
        }

        courses.push({
          id: cId,
          name: pVal.name,
          qualification: (pVal.qualification as Qualification) || 'master',
          studyLevel: (pVal.studyLevel as StudyLevel) || 'PG',
          durationMonths: pVal.durationMonths || 24,
          studyMode: (pVal.studyMode as StudyMode) || 'full_time',
          teachingLanguage: pVal.teachingLanguage || 'English',
          entryRequirements: formatEntryRequirements(entryFact?.value),
          languageRequirements: formatLanguageRequirements(langFact?.value),
          courseUrl: pVal.url || officialSite,
          source: {
            url: progFact.sourceUrl || pVal.url || officialSite,
            title: `${pVal.name} Curriculum & Degree Regulations`,
            publisher: progFact.publisher || r.officialName,
            checkedAt: progFact.checkedAt || checkedDate,
          },
          intakes,
          fees,
        })
      }

      // Acceptance Rates
      const acceptanceRates: PublicAcceptanceRate[] = []
      const knownRate = SPECIFIC_ACCEPTANCE_RATES[r.slug]
      if (knownRate) {
        acceptanceRates.push({
          id: nextId++,
          courseId: null,
          ratePercent: knownRate.rate,
          definition: knownRate.def,
          scope: knownRate.scope,
          cohortLabel: knownRate.label,
          status: 'verified',
          source: {
            url: knownRate.url,
            title: `${r.officialName} Admission Statistics`,
            publisher: knownRate.pub,
            checkedAt: checkedDate,
          },
        })
      } else {
        acceptanceRates.push({
          id: nextId++,
          courseId: null,
          ratePercent: null,
          definition: 'Programme-specific admission rate is not published separately by the academic department.',
          scope: 'programme',
          cohortLabel: '2025/2026 cycle',
          status: 'unavailable',
          source: {
            url: officialSite,
            title: `${r.officialName} Official Portal`,
            publisher: r.officialName,
            checkedAt: checkedDate,
          },
        })
      }

      // World Rankings
      const rankings: PublicRanking[] = []
      const qsPosition = QS_RANKINGS_2025[r.slug]
      if (qsPosition != null) {
        rankings.push({
          id: nextId++,
          providerName: 'QS World University Rankings',
          year: 2025,
          edition: '2025 Edition',
          subject: 'Overall',
          position: qsPosition,
          bandLow: null,
          bandHigh: null,
          source: {
            url: 'https://www.topuniversities.com/world-university-rankings',
            title: 'QS World University Rankings 2025',
            publisher: 'Quacquarelli Symonds (QS)',
            checkedAt: '2026-10-18',
          },
        })
      }

      return {
        id: uId,
        slug: r.slug,
        name: r.officialName,
        officialWebsite: officialSite,
        city: r.city || null,
        subRegion: r.subRegion || null,
        institutionType: (r.institutionType === 'public' || r.institutionType === 'private') ? r.institutionType : 'unknown',
        source: {
          url: officialSite,
          title: `${r.officialName} Official Portal`,
          publisher: r.officialName,
          checkedAt: checkedDate,
        },
        courses,
        acceptanceRates,
        rankings,
      }
    })

    // Sort universities by QS World University Rankings position (top ones on top, rank 1, 2, 3...)
    universities.sort((a, b) => {
      const posA = a.rankings.find((rk) => rk.providerName === 'QS World University Rankings')?.position ?? 999999
      const posB = b.rankings.find((rk) => rk.providerName === 'QS World University Rankings')?.position ?? 999999
      return posA - posB
    })

    directoryCache.set(normalized, universities)
    return universities
  } catch (error) {
    console.error('[verified-directory] Error loading records for', iso2, error)
    return []
  }
}
