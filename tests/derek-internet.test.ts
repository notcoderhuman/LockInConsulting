// Derek's internet research: finding institutions the directory does not hold, Google Search grounding (discovery only),
// Wikidata official sites, government visa pages, and failure handling. Synthetic pages and injected fetches: no network.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { institutionNames, officialSiteFor } from '@/lib/derek/discovery'
import { clearResearchCache, rankSitemapUrls, researchQuestion, resetTavilyLimits, searchProviderFrom, TAVILY, tavilyProviderFrom, type Page } from '@/lib/derek/research'
import { buildGeminiRequest, GeminiProvider } from '@/lib/derek/providers/gemini'
import { assessDraft, assessQuestion, factTopicsIn, VISA_INFO_REASON } from '@/lib/derek/safeguards'

const signal = new AbortController().signal
const page = (url: string, html: string): Page => ({ url, html, lastModified: null })

describe('institutions named anywhere in the world', () => {
  it('finds a university that LockIn does not list', () => {
    expect(institutionNames('What are the tuition fees at University of Waterloo for international students?')).toEqual(['University of Waterloo'])
    expect(institutionNames('entry requirements for Deakin University?')).toEqual(['Deakin University'])
    expect(institutionNames('tell me about the msc in data science at technical university of munich')).toEqual(['Technical University of Munich'])
    expect(institutionNames('fees at university of galway')).toEqual(['University of Galway'])
    expect(institutionNames('Is MIT good for engineering?')).toEqual(['Massachusetts Institute of Technology'])
    expect(institutionNames('How much does a master’s cost?')).toEqual([])
    expect(institutionNames('Which course should I choose?')).toEqual([])
  })
})

describe('Tavily is the independent web search: result URLs only, within its free limits', () => {
  const ok = (urls: string[]) => (async () => Response.json({ results: urls.map((url) => ({ url, title: 't', content: 'snippet' })) })) as unknown as typeof fetch
  beforeEach(() => resetTavilyLimits())

  it('is off without a key, so nothing is sent anywhere', () => {
    expect(tavilyProviderFrom({}, ok([]))).toBeNull()
    expect(searchProviderFrom({})).toBeNull()
    expect(searchProviderFrom({ DEREK_SEARCH_PROVIDER: 'brave' })).toBeNull() // paid Brave stays off without its own key
  })

  it('sends only the short public query, with the key in a header, asks for no answer or page content, and returns https URLs', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), init: init as RequestInit })
      return Response.json({ results: [{ url: 'https://www.uwaterloo.ca/x' }, { url: 'http://insecure.example/y' }, { url: 'https://uwaterloo.ca/z' }] })
    }) as unknown as typeof fetch
    const provider = tavilyProviderFrom({ TAVILY_API_KEY: 'tvly-test' }, fetchImpl)!
    expect(await provider.search('University of Waterloo Master of Data Science entry requirements official', signal)).toEqual(['https://www.uwaterloo.ca/x', 'https://uwaterloo.ca/z'])
    expect(calls[0].url).toBe('https://api.tavily.com/search')
    const sent = JSON.parse(String(calls[0].init.body))
    expect(sent).toMatchObject({ search_depth: 'basic', include_answer: false, include_raw_content: false })
    expect(Object.keys(sent).sort()).toEqual(['include_answer', 'include_images', 'include_raw_content', 'max_results', 'query', 'search_depth'])
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tvly-test')
    expect(calls[0].url).not.toContain('tvly-test')
  })

  it('stops asking when the free quota or rate limit is reached, instead of risking a charge', async () => {
    let n = 0
    const fetchImpl = (async () => (n++, new Response('{}', { status: 432 }))) as unknown as typeof fetch
    const provider = tavilyProviderFrom({ TAVILY_API_KEY: 'k' }, fetchImpl)!
    await expect(provider.search('q', signal)).rejects.toMatchObject({ retryable: false })
    await expect(provider.search('q', signal)).rejects.toThrow() // circuit open: no second request
    expect(n).toBe(1)
  })

  it('keeps below its own monthly budget and per-minute rate', async () => {
    const provider = tavilyProviderFrom({ TAVILY_API_KEY: 'k' }, ok(['https://a.edu/']))!
    for (let i = 0; i < TAVILY.perMinute; i++) await provider.search('q', signal)
    await expect(provider.search('q', signal)).rejects.toThrow(/budget/)
  })
})

describe('no search engine is scraped and Google Search grounding is not used', () => {
  it('the Gemini request carries no search tool and the adapter has no discovery call', () => {
    const req = buildGeminiRequest({ question: 'q', history: [], evidence: [], instructions: 'i' } as never)
    expect(JSON.stringify(req)).not.toMatch(/google_search|googleSearch|grounding/i)
    expect((GeminiProvider.prototype as unknown as Record<string, unknown>).discover).toBeUndefined()
  })
  it('the code never requests a search-engine results page or grounding links', () => {
    for (const file of ['lib/derek/discovery.ts', 'lib/derek/research.ts', 'lib/derek/providers/gemini.ts', 'lib/derek/drafts.ts']) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(source, file).not.toMatch(/google\.com\/search|bing\.com\/search|duckduckgo\.com\/html|vertexaisearch|groundingChunks|google_search:/i)
    }
  })
})

describe('ROR and Wikidata give a university’s official website without a key', () => {
  const rorBody = (name: string, site: string) => ({ items: [{ status: 'active', names: [{ value: name, types: ['ror_display'] }], links: [{ type: 'website', value: site }] }] })
  it('ROR is tried first and its website is used', async () => {
    const calls: string[] = []
    const fetchImpl = (async (input: URL | RequestInfo) => (calls.push(String(input)), Response.json(rorBody('University of Galway', 'http://www.universityofgalway.ie/')))) as unknown as typeof fetch
    expect(await officialSiteFor('University of Galway', signal, { fetchImpl })).toBe('https://www.universityofgalway.ie/')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('https://api.ror.org/v2/organizations')
    expect(calls[0]).not.toMatch(/student|email/i)
  })
  it('does not accept a different institution that merely resembles the name', async () => {
    const fetchImpl = (async (input: URL | RequestInfo) => (String(input).includes('ror.org') ? Response.json(rorBody('Galway Clinic', 'https://galwayclinic.com/')) : Response.json({ search: [] }))) as unknown as typeof fetch
    expect(await officialSiteFor('University of Galway', signal, { fetchImpl })).toBeNull()
  })
  const wikidata = (calls: string[]) =>
    (async (input: URL | RequestInfo) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('ror.org')) return Response.json({ items: [] })
      if (url.includes('wbsearchentities'))
        return Response.json({ search: [{ id: 'Q1', label: 'University of Galway', description: 'university in Galway, Ireland' }, { id: 'Q2', label: 'Galway', description: 'city in Ireland' }] })
      return Response.json({ entities: { Q1: { claims: { P856: [{ mainsnak: { datavalue: { value: 'http://www.universityofgalway.ie/' } } }] } } } })
    }) as unknown as typeof fetch
  it('Wikidata is the second source', async () => {
    const calls: string[] = []
    expect(await officialSiteFor('University of Galway', signal, { fetchImpl: wikidata(calls) })).toBe('https://www.universityofgalway.ie/')
    expect(calls.every((u) => /^https:\/\/(www\.wikidata\.org|api\.ror\.org)\//.test(u))).toBe(true)
  })
  it('returns null when nothing credible matches or both services fail', async () => {
    expect(await officialSiteFor('Galway', signal, { fetchImpl: (async () => Response.json({ items: [], search: [{ id: 'Q2', label: 'Galway', description: 'city in Ireland' }] })) as unknown as typeof fetch })).toBeNull()
    expect(await officialSiteFor('University of Galway', signal, { fetchImpl: (async () => new Response('', { status: 503 })) as unknown as typeof fetch })).toBeNull()
  })
})

describe('a site’s own sitemap is searched for the asked topic', () => {
  it('ranks programme, admissions and fee pages for the subject above unrelated pages', () => {
    const urls = [
      'https://www.example-uni.test/news/2026/graduation-photos',
      'https://www.example-uni.test/study/master-of-data-science/entry-requirements',
      'https://www.example-uni.test/study/bachelor-of-arts/entry-requirements',
      'https://www.example-uni.test/about/history',
      'https://www.example-uni.test/international/tuition-fees',
    ]
    const ranked = rankSitemapUrls(urls, ['entry or language requirements'], 'Master of Data Science', null).map((r) => r.url)
    expect(ranked[0]).toBe('https://www.example-uni.test/study/master-of-data-science/entry-requirements')
    expect(ranked).not.toContain('https://www.example-uni.test/news/2026/graduation-photos')
    expect(ranked).not.toContain('https://www.example-uni.test/about/history')
  })
})


describe('research for a university missing from LockIn’s directory', () => {
  beforeEach(() => clearResearchCache())
  const HOME = 'https://www.example-uni.test/'
  const FEES = 'https://www.example-uni.test/international/tuition-fees/'
  const pages: Record<string, Page> = {
    [HOME]: page(HOME, '<html><title>Example University</title><body><a href="/international/tuition-fees/">Tuition fees for international students</a></body></html>'),
    [FEES]: page(FEES, '<html><title>International tuition fees</title><body><p>The international tuition fee for the Master of Data Science is EUR 14,200 per year for 2026 entry.</p></body></html>'),
  }
  const fetchPage = async (u: string) => pages[u] ?? null

  it('finds the official site on the internet, reads the fees page and cites it', async () => {
    const result = await researchQuestion(
      { topics: ['fees or costs'], course: 'Master of Data Science', universities: [], universityName: 'Example University', search: null },
      { fetchPage, siteFor: async () => HOME },
    )
    expect(result.record.failure).toBeNull()
    expect(result.items.some((i) => i.sourceUrl === FEES && /14,200/.test(i.text))).toBe(true)
    expect(result.record.official).toContain(HOME)
  })

  it('needs no search service at all: the official site’s sitemap leads to the fees page', async () => {
    const result = await researchQuestion(
      { topics: ['fees or costs'], course: null, universities: [], universityName: 'Example University', search: null },
      { fetchPage: async (u) => pages[u] ?? null, siteFor: async () => 'https://www.example-uni.test/', sitemap: async () => [FEES, 'https://www.example-uni.test/news/party'] },
    )
    expect(result.items.some((i) => i.sourceUrl === FEES && /14,200/.test(i.text))).toBe(true)
    expect(result.items.every((i) => !/party/.test(i.sourceUrl))).toBe(true)
  })

  it('uses a web search service for pages the site crawl does not reach, retrying once, official hosts first', async () => {
    const search = { search: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(['https://www.reddit.com/x', FEES]) }
    const result = await researchQuestion(
      { topics: ['fees or costs'], course: null, universities: [], universityName: 'Example University', search },
      { fetchPage, siteFor: async () => null },
    )
    expect(search.search).toHaveBeenCalledTimes(2)
    expect(result.items.some((i) => i.sourceUrl === FEES)).toBe(true)
    expect(result.items.some((i) => /reddit/.test(i.sourceUrl))).toBe(false)
  })

  it('says honestly that the internet search failed and invents nothing', async () => {
    const search = { search: vi.fn().mockRejectedValue(new Error('down')) }
    const result = await researchQuestion({ topics: ['fees or costs'], course: null, universities: [], universityName: 'Example University', search }, { fetchPage: async () => null, siteFor: async () => null })
    expect(result.items).toEqual([])
    expect(result.record.failure).toMatch(/internet search could not be completed/)
  })

  it('a visa question about a known destination reads the government page', async () => {
    const gov = 'https://www.gov.uk/student-visa'
    const result = await researchQuestion(
      { topics: ['visa and immigration rules'], course: null, universities: [], destinations: [{ iso2: 'GB', name: 'United Kingdom' }], search: null },
      { fetchPage: async (u) => (u === gov ? page(gov, '<html><title>Student visa - GOV.UK</title><body><p>You can apply for a Student visa if you have been offered a place on a course by a licensed student sponsor.</p></body></html>') : null) },
    )
    expect(result.items[0]?.sourceUrl).toBe(gov)
    expect(result.items[0]?.text).toMatch(/licensed student sponsor/)
  })
})

describe('visa questions: information is answered carefully, adverse cases go to a person', () => {
  it('an ordinary visa question is a cautious, preliminary answer, not a hold', () => {
    for (const q of ['Do I need a student visa for Germany?', 'What is the post-study work visa in the UK?', 'How do I apply for a Canadian study permit?']) {
      const r = assessQuestion(q, [{ ref: 'web:1:0', text: 'x visa', sourceUrl: 'https://www.gov.uk/student-visa', publisher: 'GOV.UK', checkedAt: '2026-11-13' }], { general: false })
      expect(r.level, q).toBe('uncertain')
      expect(r.reasons, q).toContain(VISA_INFO_REASON)
    }
    expect(factTopicsIn('Do I need a student visa for Germany?')).toContain('visa and immigration rules')
  })
  it('refusals, deportation, permanent residence and appeals stay with a person', () => {
    for (const q of ['My visa was refused, what now?', 'Can I be deported if I overstay?', 'How do I get permanent residence?', 'I want to appeal the decision', 'Will my student visa be approved?'])
      expect(assessQuestion(q, [], { general: true }).level, q).toBe('high')
  })
  it('a visa figure is allowed when an official page in the evidence states it, and blocked when invented', () => {
    const ev = [{ ref: 'web:1:0', text: 'Student visa holders may work up to 20 hours a week during term.', sourceUrl: 'https://www.gov.uk/student-visa', publisher: 'GOV.UK', checkedAt: '2026-11-13', unverified: true as const }]
    const ok = 'According to [GOV.UK](https://www.gov.uk/student-visa), a student visa lets you work up to 20 hours a week in term time. Always check the official page.'
    expect(assessDraft(ok, { level: 'low', reasons: [] }, ev).reasons.join()).not.toMatch(/visa or work-rights rule/)
    const invented = 'A student visa lets you work up to 40 hours a week in term time. See [GOV.UK](https://www.gov.uk/student-visa).'
    expect(assessDraft(invented, { level: 'low', reasons: [] }, ev).reasons.join()).toMatch(/visa or work-rights rule/)
  })
})

describe('a programme’s full official name is still the asked programme', () => {
  it('does not treat "Master of Data Science and Artificial Intelligence" as another qualification, but still rejects other subjects', async () => {
    const { isOtherQualification, parseQualification } = await import('@/lib/derek/qualification')
    const q = parseQualification('Master of Data Science')!
    expect(isOtherQualification('Master of Data Science and Artificial Intelligence', q)).toBe(false)
    expect(isOtherQualification('Master of Dairy Science and Technology', q)).toBe(true)
    expect(isOtherQualification('Bachelor of Data Science', q)).toBe(true)
  })
})
