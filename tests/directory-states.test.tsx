import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UniversityDirectory } from '@/components/destination/university-directory'
import { RankingsNotice } from '@/components/destination/rankings-notice'
import { GET } from '@/app/api/destinations/[iso2]/universities/route'
import { getDestinationDirectory } from '@/lib/data/directory'
import type { DirectoryEntry, ProvisionalUniversity, PublicUniversity, SourceRef } from '@/lib/data/types'
import { getDestination } from '@/lib/destinations'

const germany = getDestination('DE')!
const source: SourceRef = { url: 'https://example.org/fees', title: 'Fees', publisher: 'Example University', checkedAt: '2026-10-01' }

const university: PublicUniversity = {
  id: 1,
  slug: 'example',
  name: 'Example University',
  officialWebsite: 'https://example.org/',
  city: 'Berlin',
  subRegion: null,
  institutionType: 'public',
  source,
  acceptanceRates: [],
  rankings: [],
  courses: [
    {
      id: 10,
      name: 'MSc Example',
      qualification: 'master',
      studyLevel: 'PG',
      durationMonths: 24,
      studyMode: null,
      teachingLanguage: null,
      entryRequirements: null,
      languageRequirements: null,
      courseUrl: null,
      source,
      intakes: [],
      fees: [
        {
          id: 100,
          category: 'international',
          amount: null,
          currency: 'EUR',
          billingPeriod: 'per_semester',
          academicYear: null,
          validTo: null,
          notes: null,
          status: 'unavailable',
          source,
          inr: null,
        },
      ],
    },
  ],
}

describe('getDestinationDirectory', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reports not_configured without a database, never private research data (R-029)', async () => {
    vi.stubEnv('DATABASE_URL', '')
    expect(await getDestinationDirectory('DE')).toEqual({ state: 'not_configured' })
  })

  it('reports not_configured for an unconfigured destination', async () => {
    vi.stubEnv('DATABASE_URL', '')
    expect(await getDestinationDirectory('XX')).toEqual({ state: 'not_configured' })
  })

  it('reports an error state when the database is unreachable', async () => {
    vi.stubEnv('DATABASE_URL', 'mysql://nobody:nothing@127.0.0.1:1/none')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getDestinationDirectory('DE')).toEqual({ state: 'error' })
    expect(spy).toHaveBeenCalled()
  })
})

describe('UniversityDirectory missing-data states', () => {
  it('shows a pending-verification empty state when nothing is published', () => {
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'not_configured' }} />)
    expect(html).toContain('Pending verification')
    expect(html).toContain('No verified Germany listings yet.')
    expect(html).not.toMatch(/€|EUR \d/)
  })

  it('treats a connected-but-empty directory the same way', () => {
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', entries: [], total: 0, verifiedTotal: 0 }} />)
    expect(html).toContain('No verified Germany listings yet.')
  })

  it('says the directory is unavailable on error, without a verification badge', () => {
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'error' }} />)
    expect(html).toContain('temporarily unavailable')
    expect(html).not.toContain('Pending verification')
  })

  it('renders unverified and unavailable fields honestly inside a listing', () => {
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', entries: [{ ...university, listing: 'verified' as const }], total: 1, verifiedTotal: 1 }} />)
    expect(html).toContain('Example University')
    expect(html).toContain('2 years')
    expect(html).toContain('Not publicly available')
    expect(html).toContain('Not verified')
    expect(html).toContain('Unpublished')
    expect(html).toContain('checked 1 Oct 2026')
    expect(html).not.toMatch(/#\d/)
  })

  it('renders provider attribution when an INR estimate is available', () => {
    const withInr: PublicUniversity = {
      ...university,
      courses: [
        {
          ...university.courses[0],
          fees: [
            {
              ...university.courses[0].fees[0],
              amount: '10000.00',
              status: 'verified',
              academicYear: '2026-2027',
              inr: {
                amountInr: 1065000,
                rate: '106.5',
                rateDate: '2026-10-14',
                sourceTitle: 'ECB euro reference rates',
                sourceUrl: 'https://www.ecb.europa.eu/stats/',
                providerName: 'European Central Bank',
                attributionText: 'Source: European Central Bank',
              },
            },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', entries: [{ ...withInr, listing: 'verified' as const }], total: 1, verifiedTotal: 1 }} />)
    expect(html).toContain('Source: European Central Bank')
    expect(html).toContain('ECB euro reference rates')
  })
})

describe('licensed rankings on a listing', () => {
  it('shows the rank with the provider, year and the attribution the licence requires', () => {
    const ranked: PublicUniversity = {
      ...university,
      rankings: [{ id: 1, providerName: 'QS Quacquarelli Symonds', year: 2026, edition: null, subject: '', position: 120, bandLow: null, bandHigh: null, attribution: 'Source: synthetic attribution', aiUseAllowed: false, source }],
    }
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', entries: [{ ...ranked, listing: 'verified' as const }], total: 1, verifiedTotal: 1 }} />)
    expect(html).toContain('#120')
    expect(html).toContain('QS Quacquarelli Symonds')
    expect(html).toContain('Source: synthetic attribution')
  })
})

describe('provisional entries (D-043)', () => {
  const provisional: ProvisionalUniversity = {
    listing: 'provisional',
    id: 7,
    slug: 'provisional-example',
    name: 'Provisional Example University',
    identityStatus: 'checked',
    category: 'university',
    officialWebsite: 'https://provisional.example.edu/',
    city: 'Leipzig',
    identityCheckedAt: '2026-10-26',
  }
  const render = (entries: DirectoryEntry[], total = entries.length, verifiedTotal = entries.filter((e) => e.listing === 'verified').length) =>
    renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', entries, total, verifiedTotal }} />)

  it('shows only the name, official website, city and check date, labelled Not yet verified', () => {
    const html = render([provisional])
    expect(html).toContain('Provisional Example University')
    expect(html).toContain('href="https://provisional.example.edu/"')
    expect(html).toContain('Leipzig')
    expect(html).toContain('Official website checked 26 Oct 2026')
    expect(html.match(/Not yet verified/g)!.length).toBeGreaterThanOrEqual(2) // the card and the section notice
    expect(html).toContain('Course availability, tuition, rankings, entry requirements and other details are still being checked')
    expect(html).toContain('No university here has verified course or tuition details yet')
    expect(html).toContain('Being listed is not the same as a verified profile')
  })

  it('cannot display detail fields even if a provisional object somehow carries them', () => {
    // Simulates a bug upstream: details attached to a provisional entry must still never render.
    const leaky = { ...provisional, courses: university.courses, rankings: [{ position: 3 }], acceptanceRates: [{ ratePercent: '12' }], source } as unknown as ProvisionalUniversity
    const html = render([leaky])
    expect(html).not.toContain('MSc Example')
    expect(html).not.toMatch(/#\d|12%|EUR|€|Acceptance rate|World ranking|Courses</)
    expect(html).not.toMatch(/>Verified</)
    expect(html).not.toMatch(/top 1,?000/i)
  })

  it('shows a pending candidate by name only, with no website, city or date', () => {
    const html = render([{ ...provisional, identityStatus: 'pending', officialWebsite: null, city: null, identityCheckedAt: null }])
    expect(html).toContain('Provisional Example University')
    expect(html).toContain('Identity/source check pending')
    expect(html).toContain('QS eligibility pending verification')
    expect(html).not.toContain('href="https://provisional.example.edu/"')
    expect(html).not.toContain('Official website checked')
    expect(html).not.toContain('Other institution type')
  })

  it('never shows a website for a pending candidate, even if one is passed by mistake', () => {
    const html = render([{ ...provisional, identityStatus: 'pending' }])
    expect(html).not.toContain('href="https://provisional.example.edu/"')
    expect(html).not.toContain('Leipzig')
  })

  it('labels an institution that is not established as a university', () => {
    const html = render([{ ...provisional, category: 'other' }])
    expect(html).toContain('Other institution type — classification pending')
    expect(html).not.toContain('>Identity/source check pending</li>')
  })

  it('labels a verified listing without a licensed QS rank as QS eligibility pending', () => {
    expect(render([{ ...university, listing: 'verified' }])).toContain('QS eligibility pending verification')
  })

  it('omits the city when the official website does not state it', () => {
    const html = render([{ ...provisional, city: null }])
    expect(html).not.toContain('Leipzig')
  })

  it('labels verified listings Verified, and drops the notice when every entry is verified', () => {
    const html = render([{ ...university, listing: 'verified' }])
    expect(html).toMatch(/>Verified</)
    expect(html).not.toContain('Not yet verified')
  })

  it('shows the notice when later pages hold provisional entries, even if the first page is all verified', () => {
    expect(render([{ ...university, listing: 'verified' }], 9, 1)).toContain('Some universities are not yet verified')
  })
})

describe('See more universities', () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ ...university, listing: 'verified' as const, id: i + 1, slug: `u${i + 1}`, name: `University ${i + 1}` }))

  it('shows the first five and a See more button while the server holds more', () => {
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', entries: five, total: 12, verifiedTotal: 12 }} />)
    expect(html.match(/<li tabindex="-1"/g)).toHaveLength(5)
    expect(html).toContain('See more universities')
    expect(html).toContain('Showing 5 of 12 universities.')
    expect(html).toContain('aria-live="polite"')
  })

  it('counts a mixed list as institutions, with the university split, keeping five per page', () => {
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', entries: five, total: 10, verifiedTotal: 10, otherTotal: 2 }} />)
    expect(html).toContain('Showing 5 of 10 institutions (8 universities, 2 other institution types).')
    expect(html).toContain('See more institutions')
    expect(html).not.toContain('See more universities')
    expect(html.match(/<li tabindex="-1"/g)).toHaveLength(5)
  })

  it('shows no button when every listing is already on the page', () => {
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', entries: five.slice(0, 3), total: 3, verifiedTotal: 3 }} />)
    expect(html).not.toContain('See more universities')
    expect(html).toContain('Showing 3 of 3 universities.')
  })
})

describe('GET /api/destinations/[iso2]/universities', () => {
  afterEach(() => vi.unstubAllEnvs())
  const call = (iso2: string, offset: string) =>
    GET(new Request(`http://localhost/api/destinations/${iso2}/universities?offset=${offset}`), { params: Promise.resolve({ iso2 }) })

  it('refuses unknown destinations and offsets that are not a page within the first 50', async () => {
    for (const [iso2, offset] of [['XX', '5'], ['de', '5'], ['DE', '-5'], ['DE', '3'], ['DE', '50'], ['DE', '1e9'], ['DE', 'abc']])
      expect((await call(iso2, offset)).status, `${iso2} ${offset}`).toBe(404)
  })

  it('answers 503, never fake data, when no database is connected', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const res = await call('DE', '5')
    expect(res.status).toBe(503)
    expect(await res.json()).not.toHaveProperty('entries')
  })
})

describe('RankingsNotice', () => {
  it('explains that rankings are withheld while no rights are confirmed', () => {
    const html = renderToStaticMarkup(<RankingsNotice publishedCount={0} />)
    expect(html).toContain('Rankings are not published yet')
    expect(html).toContain('confirmed reuse rights')
  })
})
