// Derek's web research and the daily allowance clock, without a database or a network.
import { describe, expect, it, vi } from 'vitest'
import { istDay, nextIstMidnight, DEREK_DAILY_LIMIT } from '@/lib/derek/allowance'
import {
  assertPublicUrl,
  buildQuery,
  findConflicts,
  isOutdated,
  isPublicAddress,
  pageDate,
  pageText,
  relevantLinks,
  relevantPassages,
  researchQuestion,
  searchProviderFrom,
  type Page,
} from '@/lib/derek/research'
import type { EvidenceItem } from '@/lib/derek/provider'

const NOW = new Date('2026-11-12T10:00:00Z')
const site = { name: 'Example University', officialWebsite: 'https://www.example.edu/', courseUrls: [] as string[] }

const page = (url: string, body: string, head = ''): Page => ({ url, html: `<html><head><title>${head || 'Page'}</title></head><body>${body}</body></html>`, lastModified: null })
const fetcher = (pages: Record<string, Page | null>) => vi.fn(async (u: string) => pages[u] ?? null)

describe('daily allowance clock (Asia/Kolkata)', () => {
  it('rolls over at 18:30 UTC, which is midnight in India', () => {
    expect(DEREK_DAILY_LIMIT).toBe(10)
    expect(istDay(new Date('2026-11-12T18:29:59.999Z'))).toBe('2026-11-12')
    expect(istDay(new Date('2026-11-12T18:30:00.000Z'))).toBe('2026-11-13')
    expect(istDay(new Date('2026-11-12T00:00:00Z'))).toBe('2026-11-12')
    expect(nextIstMidnight(new Date('2026-11-12T10:00:00Z')).toISOString()).toBe('2026-11-12T18:30:00.000Z')
    expect(nextIstMidnight(new Date('2026-11-12T18:30:00Z')).toISOString()).toBe('2026-11-13T18:30:00.000Z')
  })
})

describe('safe fetching', () => {
  it('refuses private, loopback, metadata and non-https addresses', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) expect(isPublicAddress(ip), ip).toBe(false)
    for (const ip of ['93.184.216.34', '2606:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true)
    const lookup = (async (host: string) => [{ address: host === 'internal.example' ? '10.0.0.5' : '93.184.216.34', family: 4 }]) as never
    await expect(assertPublicUrl('http://www.example.edu/', lookup)).rejects.toThrow()
    await expect(assertPublicUrl('https://169.254.169.254/latest', lookup)).rejects.toThrow()
    await expect(assertPublicUrl('https://user:pw@www.example.edu/', lookup)).rejects.toThrow()
    await expect(assertPublicUrl('https://internal.example/', lookup)).rejects.toThrow()
    await expect(assertPublicUrl('https://www.example.edu/admissions', lookup)).resolves.toBeInstanceOf(URL)
  })
})

describe('reading a page', () => {
  it('reduces HTML to text, finds the date and picks the passages about the topic', () => {
    const html = `<html><head><title>Fees</title><meta property="article:modified_time" content="2025-01-10T09:00:00Z"></head><body><nav>Home Menu</nav>
      <script>var x = 'tuition 999'</script><p>Tuition fees for MSc Data Science are EUR 1,500 per semester for international students.</p>
      <p>Our campus has a lovely library and many cafes to enjoy.</p></body></html>`
    const text = pageText(html)
    expect(text).not.toMatch(/Home Menu|var x/)
    expect(relevantPassages(text, ['fees or costs'], 'MSc Data Science')).toEqual(['Tuition fees for MSc Data Science are EUR 1,500 per semester for international students.'])
    expect(pageDate(html, null)).toBe('2025-01-10')
    expect(pageDate('<p>Last updated: 3 March 2023</p>', null)).toBe('2023-03-03')
    expect(pageDate('<p>no date</p>', 'Wed, 01 Oct 2025 08:00:00 GMT')).toBe('2025-10-01')
    expect(isOutdated('2025-01-10', NOW)).toBe(true)
    expect(isOutdated('2026-06-01', NOW)).toBe(false)
    expect(isOutdated(null, NOW)).toBe(false)
  })

  it('follows only same-site links that look relevant', () => {
    const html = '<a href="/admissions/fees">Tuition and fees</a><a href="https://other.example/fees">Fees elsewhere</a><a href="/about">About</a><a href="/brochure.pdf">Fees PDF</a>'
    expect(relevantLinks(html, 'https://www.example.edu/', ['fees or costs'], null)).toEqual(['https://www.example.edu/admissions/fees'])
  })
})

describe('web research', () => {
  const home = page('https://www.example.edu/', '<p>Welcome to Example University.</p><a href="/admissions/fees">Tuition and fees</a>', 'Example University')
  const fees = page(
    'https://www.example.edu/admissions/fees',
    '<p>Tuition fee for the MSc Computer Science is EUR 3,200 per year for international students.</p><p>Last updated: 5 September 2026</p>',
    'Tuition and fees',
  )

  it('reads the university’s own pages, one hop, and returns unverified evidence with its link and read date', async () => {
    const get = fetcher({ 'https://www.example.edu/': home, 'https://www.example.edu/admissions/fees': fees })
    const out = await researchQuestion({ topics: ['fees or costs'], course: 'MSc Computer Science', universities: [site] }, { fetchPage: get, search: null, now: () => NOW })
    expect(get.mock.calls.map((c) => c[0])).toEqual(['https://www.example.edu/', 'https://www.example.edu/admissions/fees'])
    expect(out.items).toHaveLength(1)
    expect(out.items[0]).toMatchObject({ sourceUrl: 'https://www.example.edu/admissions/fees', publisher: 'Example University', checkedAt: '2026-11-12', unverified: true })
    expect(out.items[0].text).toContain('EUR 3,200 per year')
    expect(out.items[0].text).toMatch(/^UNVERIFIED, not yet checked by LockIn/)
    expect(out.record).toMatchObject({ attempted: true, failure: null, conflicts: [], outdated: [], sources: [{ url: 'https://www.example.edu/admissions/fees', published: '2026-09-05', outdated: false, via: 'linked_page' }] })
  })

  it('keeps a page about the topic as a source even when it gives no readable figure, so the answer can point to it', async () => {
    const feesPage = page('https://www.example.edu/study/tuition-fees/', '<p>See the fee table below for your programme.</p>', 'Tuition fees for international students')
    const out = await researchQuestion({ topics: ['fees or costs'], course: null, universities: [site] }, { fetchPage: fetcher({ 'https://www.example.edu/': page('https://www.example.edu/', '<a href="/study/tuition-fees/">Tuition fees</a>'), 'https://www.example.edu/study/tuition-fees/': feesPage }), search: null, now: () => NOW })
    expect(out.record.sources.map((x) => x.url)).toEqual(['https://www.example.edu/study/tuition-fees/'])
    expect(out.items).toHaveLength(1)
    expect(out.items[0].text).toContain('gave no figure or date that could be read automatically')
    expect(out.record.official).toEqual(['https://www.example.edu/'])
  })

  it('flags an outdated page and says so in the evidence', async () => {
    const old = page('https://www.example.edu/', '<p>Tuition fee for the MSc is EUR 2,000 per year.</p><p>Last updated: 1 March 2023</p>')
    const out = await researchQuestion({ topics: ['fees or costs'], course: null, universities: [site] }, { fetchPage: fetcher({ 'https://www.example.edu/': old }), search: null, now: () => NOW })
    expect(out.record.outdated).toEqual(['www.example.edu (page last updated 2023-03-01)'])
    expect(out.items[0].text).toContain('possibly out of date')
  })

  it('reports conflicting figures between sources', () => {
    const item = (url: string, text: string): EvidenceItem => ({ ref: url, text, sourceUrl: url, publisher: 'x', checkedAt: '2026-11-12' })
    const fee = (url: string, amount: string) => item(url, `MSc tuition fee: ${amount} per year`)
    expect(findConflicts([fee('https://a.example/f', 'EUR 3,200'), fee('https://b.example/f', 'EUR 4,100')], ['fees or costs'])).toEqual(['Fee figures differ between a.example and b.example'])
    expect(findConflicts([fee('https://a.example/f', 'EUR 3,200'), fee('https://b.example/f', 'EUR 3,200 per year')], ['fees or costs'])).toEqual([])
    expect(findConflicts([fee('https://a.example/f', 'EUR 3,200')], ['fees or costs'])).toEqual([])
    const date = (url: string, d: string) => item(url, `Application deadline: ${d}`)
    expect(findConflicts([date('https://a.example/d', '15 January 2027'), date('https://b.example/d', '1 March 2027')], ['intakes or deadlines'])).toEqual(['Application deadlines differ between a.example and b.example'])
  })

  it('fails cleanly, without inventing anything, when nothing can be read', async () => {
    const none = await researchQuestion({ topics: ['fees or costs'], course: null, universities: [site] }, { fetchPage: fetcher({}), search: null, now: () => NOW })
    expect(none.items).toEqual([])
    expect(none.record.failure).toMatch(/did not state this/)
    const unknown = await researchQuestion({ topics: ['fees or costs'], course: null, universities: [] }, { fetchPage: fetcher({}), search: null, now: () => NOW })
    expect(unknown.items).toEqual([])
    expect(unknown.record.failure).toMatch(/holds no official page/)
    const throwing = { search: async () => { throw new Error('boom') } }
    const broken = await researchQuestion({ topics: ['fees or costs'], course: null, universities: [site] }, { fetchPage: fetcher({}), search: throwing, now: () => NOW })
    expect(broken.items).toEqual([])
    expect(broken.record.failure).toMatch(/search service could not be reached/)
  })

  it('searches with only university, course and topic, prefers official hosts, and never includes personal text', async () => {
    const seen: string[] = []
    const search = { search: async (q: string) => (seen.push(q), ['https://blog.example.com/fees', 'https://www.example.edu/admissions/fees']) }
    const get = fetcher({ 'https://www.example.edu/admissions/fees': fees })
    await researchQuestion({ topics: ['fees or costs'], course: 'MSc Computer Science', universities: [site] }, { fetchPage: get, search, now: () => NOW })
    expect(seen).toEqual(['Example University MSc Computer Science fees or costs official'])
    expect(get.mock.calls.map((c) => c[0])).not.toContain('https://blog.example.com/fees')
    // A course that looks personal is left out of the wording altogether.
    expect(buildQuery('Example University', 'my name is Asha Rao MSc', ['fees or costs'])).toBe('Example University fees or costs official')
    expect(buildQuery('Example University', 'asha@example.com', [])).toBe('Example University admissions official')
    expect(buildQuery('Example University', null, ['intakes or deadlines'])).toBe('Example University intakes or deadlines official')
  })

  it('leaves the search provider off unless both settings exist', () => {
    expect(searchProviderFrom({})).toBeNull()
    expect(searchProviderFrom({ DEREK_SEARCH_PROVIDER: 'brave' })).toBeNull()
    expect(searchProviderFrom({ BRAVE_SEARCH_API_KEY: 'k' })).toBeNull()
    expect(searchProviderFrom({ DEREK_SEARCH_PROVIDER: 'brave', BRAVE_SEARCH_API_KEY: 'k' })).not.toBeNull()
  })
})
