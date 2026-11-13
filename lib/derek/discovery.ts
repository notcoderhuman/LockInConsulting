// How Derek finds pages on the open internet (Owner brief, 13 Nov 2026; corrected the same day). LockIn's directory is a supplement, never a limit.
//
// No search engine's results are scraped, and Google Search grounding is NOT used (its terms forbid extracting links from grounded results).
// Gemini only reasons over pages that LockIn itself retrieved. Pages are found by independent, permitted means:
//   1. ROR (Research Organization Registry, CC0, no key, 2000 requests / 5 min / IP) and Wikidata (CC0, no key): a university's official website from its name.
//   2. The official site's own sitemap.xml and navigation (see research.ts): the programme, admissions, fee and scholarship pages of that site.
//   3. Official government pages for visa questions (GOV_SEEDS).
//   4. Tavily Search (free Researcher plan: 1,000 credits a month, 100 requests a minute, no card; tavilySearch below) when TAVILY_API_KEY is set: result URLs only.
// Privacy: only a public university name, a course and a topic are ever sent (the same words as the student's current question).
export interface DiscoveryDeps {
  fetchImpl?: typeof fetch
}

const STOP = new Set(
  ('a an and are at be by can could do does for from get give how i if in is it me my of on or please tell the to what whats when where which who why will with would you your about apply applying application admission admissions entry requirement requirements ' +
    'tuition fee fees cost costs price scholarship scholarships deadline deadlines intake intakes visa course courses programme programmes program programs degree degrees master masters bachelor bachelors msc mba phd bsc ba ma computer science data engineering business law medicine nursing ' +
    'international student students study studying doing need needs available there their this that these those info information details detail good best top ranking rank accommodation housing english language ielts toefl pte').split(' '),
)
const ANCHORS = ['university', 'college', 'institute', 'polytechnic', 'universität', 'universiteit', 'universidad', 'université', 'hochschule']
const ABBREVIATIONS: Record<string, string> = {
  mit: 'Massachusetts Institute of Technology',
  ucl: 'University College London',
  nus: 'National University of Singapore',
  ntu: 'Nanyang Technological University',
  ucla: 'University of California, Los Angeles',
  eth: 'ETH Zurich',
  kth: 'KTH Royal Institute of Technology',
  unsw: 'University of New South Wales',
  uts: 'University of Technology Sydney',
  rmit: 'RMIT University',
  qut: 'Queensland University of Technology',
  uoft: 'University of Toronto',
}
const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Of|And|The|De|Der|Du)\b/g, (w) => w.toLowerCase())

/**
 * The institutions a message names, most specific first: "University of Waterloo", "Massey University", "MIT".
 * Public names only; the match is by shape (University of X, X University, a known abbreviation), not by LockIn's directory.
 */
export function institutionNames(text: string): string[] {
  const tokens = text.normalize('NFKC').replace(/[?!,;:()"“”]/g, ' ').replace(/\.(?=\s|$)/g, ' ').split(/\s+/).filter(Boolean)
  const lower = tokens.map((t) => t.toLowerCase())
  const out: string[] = []
  const add = (name: string) => out.some((o) => o.toLowerCase() === name.toLowerCase()) || out.push(name)
  lower.forEach((t, i) => {
    if (ABBREVIATIONS[t] && tokens[i] === tokens[i].toUpperCase() && tokens[i].length >= 3) add(ABBREVIATIONS[t])
    if (!ANCHORS.includes(t)) return
    // "Massey University", "Technical University of Munich": up to three words before the anchor.
    const before: string[] = []
    for (let j = i - 1; j >= 0 && before.length < 3; j--) {
      if (STOP.has(lower[j]) || ['of', 'the'].includes(lower[j]) || /[^\p{L}\p{M}'’&.-]/u.test(tokens[j])) break
      before.unshift(tokens[j])
    }
    // "University of Waterloo": the words after "of" up to a stop word, at most four.
    if (lower[i + 1] === 'of' || lower[i + 1] === 'the') {
      const rest: string[] = []
      for (let j = i + (lower[i + 1] === 'the' && lower[i + 2] === 'of' ? 3 : 2); j < tokens.length && rest.length < 4; j++) {
        if (STOP.has(lower[j]) && !(rest.length && ['of', 'and', 'the'].includes(lower[j]) && !STOP.has(lower[j + 1] ?? 'x'))) break
        if (/[^\p{L}\p{M}'’&.-]/u.test(tokens[j])) break
        rest.push(tokens[j])
      }
      if (rest.length) add(title(`${[...before, tokens[i]].join(' ')} of ${rest.join(' ')}`))
    } else if (before.length) add(title(`${before.join(' ')} ${tokens[i]}`))
  })
  return out.slice(0, 2)
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * A university's official website from Wikidata (property P856), keyless. Tries the name and then shorter forms of it
 * ("University of Waterloo computer" → "University of Waterloo"). Null when nothing credible matches.
 */
async function wikidataSiteFor(name: string, signal: AbortSignal, { fetchImpl = fetch }: DiscoveryDeps = {}): Promise<string | null> {
  const words = name.split(/\s+/)
  for (let take = words.length; take >= Math.min(2, words.length) && take >= words.length - 2; take--) {
    const candidate = words.slice(0, take).join(' ')
    try {
      const search = await json(fetchImpl, `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbsearchentities', search: candidate, language: 'en', type: 'item', limit: '6', format: 'json', origin: '*' })}`, signal)
      const hits = (search.search as { id: string; label?: string; description?: string }[] | undefined) ?? []
      const likely = hits.filter((h) => /universit|college|institute|polytechnic|school|hochschule/i.test(`${h.description ?? ''} ${h.label ?? ''}`) && (norm(h.label ?? '') === norm(candidate) || norm(h.label ?? '').includes(norm(candidate)) || norm(candidate).includes(norm(h.label ?? ''))))
      if (!likely.length) continue
      const entities = await json(fetchImpl, `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: likely.map((h) => h.id).join('|'), props: 'claims', format: 'json', origin: '*' })}`, signal)
      const byId = (entities.entities ?? {}) as Record<string, { claims?: { P856?: { mainsnak?: { datavalue?: { value?: unknown } } }[] } }>
      for (const h of likely) {
        const value = byId[h.id]?.claims?.P856?.[0]?.mainsnak?.datavalue?.value
        if (typeof value === 'string') {
          const url = new URL(value.replace(/^http:\/\//i, 'https://'))
          if (url.protocol === 'https:') return url.toString()
        }
      }
    } catch {
      if (signal.aborted) return null
    }
  }
  return null
}

async function json(fetchImpl: typeof fetch, url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]), headers: { 'user-agent': 'LockInDerek/1.0 (+https://lockinconsulting.com)', accept: 'application/json' }, redirect: 'error' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

/** Official government pages on student visas, for the destinations LockIn knows. Other countries are found by search. Read when the page loads, never quoted from here. */
export const GOV_SEEDS: Record<string, string[]> = {
  GB: ['https://www.gov.uk/student-visa'],
  AU: ['https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500'],
  NZ: ['https://www.immigration.govt.nz/new-zealand-visas/visas/visa/student-visa'],
  CA: ['https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html'],
  US: ['https://travel.state.gov/content/travel/en/us-visas/study/student-visa.html'],
  IE: ['https://www.irishimmigration.ie/coming-to-study-in-ireland/'],
  DE: ['https://www.make-it-in-germany.com/en/visa-residence/types/study'],
}

/** Hosts that are never a source for a university question. */
export const NOT_A_SOURCE = /(^|\.)(facebook|instagram|twitter|x|tiktok|youtube|youtu|reddit|quora|pinterest|linkedin|medium|blogspot|wordpress|telegram|whatsapp)\.(com|be|me)$/i


const orgNames = (r: { names?: { value?: string; types?: string[] }[] }) => (r.names ?? []).map((n) => norm(n.value ?? '')).filter(Boolean)

/** A university's official website from ROR (api.ror.org, CC0, no key, 2000 requests per 5 minutes per IP): the institution whose name matches, with a website link. */
async function rorSiteFor(name: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<string | null> {
  const wanted = norm(name)
  const body = await json(fetchImpl, `https://api.ror.org/v2/organizations?${new URLSearchParams({ query: name, filter: 'types:education' })}`, signal)
  for (const item of ((body.items as { names?: { value?: string; types?: string[] }[]; links?: { type?: string; value?: string }[]; status?: string }[]) ?? []).slice(0, 5)) {
    if (item.status && item.status !== 'active') continue
    if (!orgNames(item).some((n) => n === wanted || n.includes(wanted) || (n.length > 8 && wanted.includes(n)))) continue
    const site = item.links?.find((l) => l.type === 'website')?.value
    if (site) {
      const url = new URL(site.replace(/^http:\/\//i, 'https://'))
      if (url.protocol === 'https:') return url.toString()
    }
  }
  return null
}

/**
 * A university's official website from its name, worldwide: ROR first, then Wikidata (both free, keyless and open-licensed).
 * Tries the name and then shorter forms of it ("University of Waterloo computer" → "University of Waterloo").
 */
export async function officialSiteFor(name: string, signal: AbortSignal, { fetchImpl = fetch }: DiscoveryDeps = {}): Promise<string | null> {
  const words = name.split(/\s+/)
  for (let take = words.length; take >= Math.min(2, words.length) && take >= words.length - 2; take--) {
    const candidate = words.slice(0, take).join(' ')
    const site = await rorSiteFor(candidate, signal, fetchImpl).catch(() => null)
    if (site) return site
    if (signal.aborted) return null
  }
  return wikidataSiteFor(name, signal, { fetchImpl })
}
