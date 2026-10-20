import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UniversityDirectory } from '@/components/destination/university-directory'
import { RankingsNotice } from '@/components/destination/rankings-notice'
import { getDestinationDirectory } from '@/lib/data/directory'
import type { PublicUniversity, SourceRef } from '@/lib/data/types'
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

  it('loads verified directory listings for destination without a database', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const result = await getDestinationDirectory('DE')
    expect(result.state).toBe('ready')
    if (result.state === 'ready') {
      expect(result.universities.length).toBe(10)
      expect(result.universities[0].name).toContain('Munich')
      expect(result.universities[0].rankings.length).toBeGreaterThan(0)
    }
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
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', universities: [] }} />)
    expect(html).toContain('No verified Germany listings yet.')
  })

  it('says the directory is unavailable on error, without a verification badge', () => {
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'error' }} />)
    expect(html).toContain('temporarily unavailable')
    expect(html).not.toContain('Pending verification')
  })

  it('renders unverified and unavailable fields honestly inside a listing', () => {
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', universities: [university] }} />)
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
    const html = renderToStaticMarkup(<UniversityDirectory destination={germany} directory={{ state: 'ready', universities: [withInr] }} />)
    expect(html).toContain('Source: European Central Bank')
    expect(html).toContain('ECB euro reference rates')
  })
})

describe('RankingsNotice', () => {
  it('explains that rankings are withheld while no rights are confirmed', () => {
    const html = renderToStaticMarkup(<RankingsNotice publishedCount={0} />)
    expect(html).toContain('Rankings are not published yet')
    expect(html).toContain('confirmed reuse rights')
  })
})
