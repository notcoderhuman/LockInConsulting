import { createHash } from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { screenForFreeTier } from './free-tier'
import { UNVERIFIED_TAG, type EvidenceItem } from './provider'

// Derek's web research (Owner request, 12 Nov 2026). Order of knowledge: LockIn's verified records first
// (lib/derek/evidence.ts), then, only when those do not answer a factual question, the university's OWN website:
//   1. the pages LockIn already holds for the university (official website, course/admissions pages), then
//   2. same-site pages those link to that look relevant (admissions, fees, deadlines, requirements, scholarships), and
//   3. results of a search provider, when one is configured (lib/derek/research.ts → searchProviderFrom).
// What is found becomes UNVERIFIED evidence ("not yet checked by LockIn") with its URL and read date, so the existing
// safeguards apply unchanged: Derek may quote only what the page says, must cite it, and any figure or link that is
// not in the evidence sends the draft to a person. Nothing here is a model call.
//
// Privacy: nothing about the student is ever sent. Fetches go to URLs from LockIn's own university records (or to a
// search provider, with a general query of university, course and topic only). The course text is screened like any
// free-tier question and dropped when it looks personal. Pages are public, so a process-local cache may keep them.
// shortcut: the cache is per server process and 6 hours; move it to the database if the app runs on several instances.

export const RESEARCH = {
  pageTimeoutMs: 6_000,
  totalBudgetMs: 18_000,
  maxBytes: 400_000,
  maxPages: 6,
  maxRedirects: 3,
  passagesPerPage: 4,
  /** A page last changed longer ago than this is described as possibly outdated. */
  outdatedDays: 548,
  cacheMs: 6 * 3_600_000,
} as const

export interface ResearchSource {
  url: string
  publisher: string
  title: string
  retrievedAt: string
  /** The page's own last-updated date when it states one (header, meta tag or "last updated" text). */
  published: string | null
  outdated: boolean
  via: 'lockin_record' | 'linked_page' | 'search'
}

export interface ResearchRecord {
  attempted: true
  query: string | null
  sources: ResearchSource[]
  conflicts: string[]
  outdated: string[]
  /** The official pages LockIn holds for the universities asked about (their website and course pages). */
  official?: string[]
  /** Why nothing could be used (no site known, fetch failed, no relevant text); null when something was found. */
  failure: string | null
}

export interface ResearchResult {
  items: EvidenceItem[]
  record: ResearchRecord
}

export interface UniversitySite {
  name: string
  officialWebsite: string
  courseUrls: string[]
}

export interface Page {
  url: string
  html: string
  lastModified: string | null
}

export interface SearchProvider {
  search(query: string, signal: AbortSignal): Promise<string[]>
}

export interface ResearchDeps {
  fetchPage?: (url: string, signal: AbortSignal) => Promise<Page | null>
  search?: SearchProvider | null
  now?: () => Date
}

// ---------------------------------------------------------------------------------------------
// Safe fetching: https only, public addresses only, manual redirects, size and time caps, robots.txt.
// ---------------------------------------------------------------------------------------------

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224)
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return false
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? isPublicAddress(mapped[1]) : true
  }
  return false
}

export async function assertPublicUrl(raw: string, lookup: typeof dns.lookup = dns.lookup): Promise<URL> {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('not a plain https URL')
  if (net.isIP(url.hostname)) throw new Error('IP literal')
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || !addresses.every((a) => isPublicAddress(a.address))) throw new Error('not a public address')
  return url
}

const cache = new Map<string, { at: number; page: Page | null }>()
const robotsCache = new Map<string, { at: number; disallow: string[] }>()

/** Test hook. */
export const clearResearchCache = () => (cache.clear(), robotsCache.clear())

async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).slice(0, max)
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < max) {
    const { done, value } = await reader.read()
    if (done || !value) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => {})
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks).subarray(0, max))
}

const AGENT = 'LockInDerek/1.0 (+https://lockinconsulting.com)'

async function robotsAllow(url: URL, signal: AbortSignal): Promise<boolean> {
  const hit = robotsCache.get(url.origin)
  let disallow = hit && Date.now() - hit.at < RESEARCH.cacheMs ? hit.disallow : null
  if (!disallow) {
    disallow = []
    try {
      const res = await fetch(`${url.origin}/robots.txt`, { signal, headers: { 'user-agent': AGENT }, redirect: 'manual' })
      if (res.ok) {
        let applies = false
        for (const line of (await readLimited(res, 100_000)).split(/\r?\n/)) {
          const [k, ...rest] = line.split('#')[0].split(':')
          const key = k.trim().toLowerCase()
          const value = rest.join(':').trim()
          if (key === 'user-agent') applies = value === '*' || /derek/i.test(value)
          else if (applies && key === 'disallow' && value) disallow.push(value)
        }
      }
    } catch {
      // No robots.txt reachable: nothing is disallowed.
    }
    robotsCache.set(url.origin, { at: Date.now(), disallow })
  }
  return !disallow.some((rule) => url.pathname.startsWith(rule.replace(/\*.*$/, '')))
}

/** One public page, or null. Never throws: a failure is simply "no page". */
export async function fetchPublicPage(raw: string, signal: AbortSignal): Promise<Page | null> {
  const hit = cache.get(raw)
  if (hit && Date.now() - hit.at < RESEARCH.cacheMs) return hit.page
  let page: Page | null = null
  try {
    let url = await assertPublicUrl(raw)
    for (let hop = 0; hop <= RESEARCH.maxRedirects; hop++) {
      if (!(await robotsAllow(url, signal))) break
      const res = await fetch(url, { signal, redirect: 'manual', headers: { 'user-agent': AGENT, accept: 'text/html,text/plain;q=0.9' } })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = await assertPublicUrl(new URL(res.headers.get('location') as string, url).toString())
        continue
      }
      const type = res.headers.get('content-type') ?? ''
      if (res.ok && /text\/(html|plain)|application\/xhtml/i.test(type)) page = { url: url.toString(), html: await readLimited(res, RESEARCH.maxBytes), lastModified: res.headers.get('last-modified') }
      else await res.body?.cancel().catch(() => {})
      break
    }
  } catch {
    page = null
  }
  if (cache.size > 200) cache.clear()
  cache.set(raw, { at: Date.now(), page })
  return page
}

// ---------------------------------------------------------------------------------------------
// Reading a page
// ---------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', pound: '£' }
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m)))

export function pageText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

export const pageTitle = (html: string) => decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim()).slice(0, 140)

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december'
const dateOf = (s: string): string | null => {
  // "3 March 2023" has no zone: read it as UTC so the day never shifts with the server's timezone.
  const t = Date.parse(/(?:GMT|UTC|Z|[+-]\d{2}:?\d{2})$|^\d{4}-\d{2}-\d{2}$/i.test(s.trim()) ? s : `${s} UTC`)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null
}

/** The page's own statement of when it was last changed: a meta tag, "last updated …" text, or the Last-Modified header. */
export function pageDate(html: string, lastModified: string | null): string | null {
  const meta = html.match(/<meta[^>]+(?:property|name|itemprop)=["'](?:article:modified_time|og:updated_time|dateModified|last-modified|date)["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["'](?:article:modified_time|og:updated_time|dateModified|last-modified)["']/i)
  const text = pageText(html).match(new RegExp(`(?:last (?:updated|modified|reviewed)|updated on|page updated)\\s*:?\\s*((?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})|(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?,?)\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4})`, 'i'))
  return (meta && dateOf(meta[1])) || (text && dateOf(text[1].replace(/(\d)(st|nd|rd|th)/i, '$1'))) || (lastModified && dateOf(lastModified)) || null
}

export function isOutdated(published: string | null, today: Date): boolean {
  return published != null && (today.getTime() - Date.parse(published)) / 86_400_000 > RESEARCH.outdatedDays
}

const TOPIC_WORDS: Record<string, string[]> = {
  fees: ['tuition', 'fee', 'fees', 'cost', 'costs', 'per year', 'per annum', 'per point'],
  deadlines: ['deadline', 'deadlines', 'apply by', 'closing date', 'closes', 'intakes', 'application period', 'applications open', 'application window'],
  requirements: ['requirement', 'requirements', 'eligib', 'admission', 'entry', 'ielts', 'toefl', 'pte', 'duolingo', 'gpa', 'degree', 'prerequisite', 'language'],
  scholarships: ['scholarship', 'scholarships', 'bursary', 'funding', 'financial aid', 'grant'],
  visa: ['visa', 'immigration', 'residence permit', 'study permit'],
  other: ['admission', 'apply', 'application'],
}

function wordsFor(topics: string[]): string[] {
  const out = new Set<string>()
  for (const t of topics.length ? topics : ['other']) {
    const key = /fee|tuition|cost/.test(t) ? 'fees' : /deadline|intake|date/.test(t) ? 'deadlines' : /requirement|eligib|entry|language|score/.test(t) ? 'requirements' : /scholar|fund|bursar/.test(t) ? 'scholarships' : /visa|immigr|permit/.test(t) ? 'visa' : 'other'
    for (const w of TOPIC_WORDS[key]) out.add(w)
  }
  return [...out]
}

/** A line only counts when it carries what the topic needs: a figure or date for fees and deadlines, a figure or a named qualification for requirements. */
function substantive(line: string, topics: string[]): boolean {
  const key = topics.join(' ')
  if (/fee|tuition|cost|deadline|intake|date/.test(key)) return /\d/.test(line)
  if (/requirement|eligib|entry|language|score/.test(key)) return /\d|\b(?:degree|bachelor|master|ielts|toefl|pte|duolingo|gpa|grade|diploma|certificate|english)\b/i.test(line)
  return true
}

/** The lines of a page that speak about the topic, best first. */
export function relevantPassages(text: string, topics: string[], course: string | null, max: number = RESEARCH.passagesPerPage): string[] {
  const words = wordsFor(topics)
  const courseWords = (course ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
  const lines = [...new Set(text.split('\n').flatMap((l) => (l.length > 400 ? l.split(/(?<=[.!?])\s+/) : [l])).map((l) => l.trim()).filter((l) => l.length >= 40 && l.length <= 400))]
  return lines
    .map((line, i) => {
      const lower = line.toLowerCase()
      const hits = words.filter((w) => lower.includes(w)).length
      return { line, i, score: hits * 2 + courseWords.filter((w) => lower.includes(w)).length + (/\d/.test(line) ? 1 : 0) }
    })
    .filter((x) => x.score >= 2 && substantive(x.line, topics))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.line)
}

const HREF = /<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
/** Same-site links whose address or text matches the topic, best first. */
export function relevantLinks(html: string, base: string, topics: string[], course: string | null): string[] {
  const words = wordsFor(topics)
  const courseWords = (course ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
  const host = new URL(base).hostname.replace(/^www\./, '')
  const scored = new Map<string, number>()
  for (const m of html.matchAll(HREF)) {
    try {
      const u = new URL(m[1], base)
      const h = u.hostname.replace(/^www\./, '')
      if (u.protocol !== 'https:' || !(h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`))) continue
      // Student portals, logins and learning systems say nothing about admissions.
      if (/(^|[.-])(my|login|sso|moodle|portal|intranet|mail|webmail|lms|canvas|blackboard)[a-z]*\./i.test(u.hostname) || /\/(login|signin|sign-in|account|portal)\b/i.test(u.pathname)) continue
      if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) continue
      u.hash = ''
      const hay = `${u.pathname} ${pageText(m[2])}`.toLowerCase()
      const score = words.filter((w) => hay.includes(w)).length + courseWords.filter((w) => hay.includes(w)).length * 2
      if (score > 0 && u.toString() !== base) scored.set(u.toString(), Math.max(scored.get(u.toString()) ?? 0, score))
    } catch {
      // Not a usable link.
    }
  }
  return [...scored].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 4)
}

// ---------------------------------------------------------------------------------------------
// Conflicts between sources
// ---------------------------------------------------------------------------------------------

const MONEY = /(?:€|£|\$|₹|\b(?:EUR|GBP|USD|INR|CAD|AUD|NZD|PLN|SAR|AED)\b)\s?\d[\d,.  ]*\d/gi
const DATE_RE = new RegExp(`\\b(?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?|(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{4}-\\d{2}-\\d{2})`, 'gi')
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9€£$₹]/g, '')

/** Sources that give different fee figures, or different deadlines, for the same thing. Empty when they agree or only one speaks. */
export function findConflicts(items: EvidenceItem[], topics: string[]): string[] {
  const out: string[] = []
  const check = (label: string, re: RegExp, pick: (i: EvidenceItem) => boolean) => {
    const bySource = new Map<string, Set<string>>()
    for (const i of items.filter(pick)) {
      const found = [...i.text.matchAll(re)].map((m) => squash(m[0]))
      if (found.length) bySource.set(i.sourceUrl, new Set([...(bySource.get(i.sourceUrl) ?? []), ...found]))
    }
    const entries = [...bySource]
    for (let a = 0; a < entries.length; a++)
      for (let b = a + 1; b < entries.length; b++)
        if (![...entries[a][1]].some((v) => entries[b][1].has(v))) out.push(`${label} differ between ${new URL(entries[a][0]).hostname} and ${new URL(entries[b][0]).hostname}`)
  }
  if (topics.some((t) => /fee|tuition|cost/.test(t))) check('Fee figures', MONEY, (i) => /tuition|fee/i.test(i.text))
  if (topics.some((t) => /deadline|intake|date/.test(t))) check('Application deadlines', DATE_RE, (i) => /deadline|apply by|closing date|closes/i.test(i.text))
  return [...new Set(out)]
}

// ---------------------------------------------------------------------------------------------
// The workflow
// ---------------------------------------------------------------------------------------------

type Queryable = Pick<Pool, 'query'>
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** The universities the student's text names, with the official pages LockIn holds for them. Public records only; no student data. */
export async function findUniversitySites(db: Queryable, text: string): Promise<UniversitySite[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, name, slug, official_website FROM universities WHERE official_website IS NOT NULL AND publication_status <> 'unpublished' AND listing_hidden = 0",
  )
  const q = ` ${norm(text)} `
  const named = rows.filter((u) => q.includes(` ${norm(String(u.name))} `) || q.includes(` ${norm(String(u.slug))} `)).slice(0, 2)
  const out: UniversitySite[] = []
  for (const u of named) {
    const [courses] = await db.query<RowDataPacket[]>("SELECT course_url FROM courses WHERE university_id = ? AND course_url IS NOT NULL AND publication_status <> 'unpublished' LIMIT 5", [u.id])
    out.push({ name: String(u.name), officialWebsite: String(u.official_website), courseUrls: courses.map((c) => String(c.course_url)) })
  }
  return out
}

const TOPIC_EVIDENCE: [RegExp, RegExp][] = [
  [/fee|cost/i, /tuition|fee/i],
  [/rank/i, /rank/i],
  [/intake|deadline/i, /intake|deadline/i],
  [/acceptance/i, /acceptance/i],
  [/requirement/i, /requirement/i],
  [/scholarship/i, /scholarship/i],
]
const GENERIC_COURSE_WORDS = new Set(['master', 'masters', 'bachelor', 'bachelors', 'degree', 'programme', 'program', 'course', 'postgraduate', 'undergraduate', 'diploma', 'honours', 'with', 'from'])

/**
 * Whether LockIn already holds what the student asked: for every topic, a record about it, and, when the student chose a course,
 * a record that mentions that course. Another course's fee at the same university does not answer the question.
 */
export function evidenceCovers(evidence: EvidenceItem[], topics: string[], course: string | null): boolean {
  const words = (course ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC_COURSE_WORDS.has(w))
  const facts = evidence.filter((e) => !/^(draft_)?university:/.test(e.ref))
  if (!topics.length) return facts.length > 0
  return topics.every((topic) => {
    const wanted = TOPIC_EVIDENCE.find(([t]) => t.test(topic))?.[1]
    return facts.some((e) => (wanted ? wanted.test(e.text) || wanted.test(e.ref) : true) && (!words.length || words.some((w) => e.text.toLowerCase().includes(w))))
  })
}

/** The general search query: university, course and what is being asked. Nothing else, and never anything personal. */
export function buildQuery(universityName: string, course: string | null, topics: string[]): string {
  const safeCourse = course && course.length <= 80 && screenForFreeTier(course) === null ? course : null
  const what = topics.length ? topics.join(' ') : 'admissions'
  return [universityName, safeCourse, what, 'official'].filter(Boolean).join(' ').slice(0, 200)
}

/** Brave Search API (api.search.brave.com): only when DEREK_SEARCH_PROVIDER=brave and BRAVE_SEARCH_API_KEY are set. A paid service: not enabled by default. */
export function searchProviderFrom(env: Record<string, string | undefined> = process.env): SearchProvider | null {
  if (env.DEREK_SEARCH_PROVIDER !== 'brave') return null
  const key = (env.BRAVE_SEARCH_API_KEY ?? '').trim()
  if (!key) return null
  return {
    async search(query, signal) {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: '5', safesearch: 'strict' })}`, {
        signal,
        headers: { accept: 'application/json', 'x-subscription-token': key },
      })
      if (!res.ok) throw new Error(`search ${res.status}`)
      const body = (await res.json()) as { web?: { results?: { url?: string }[] } }
      return (body.web?.results ?? []).map((r) => r.url).filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
    },
  }
}

const OFFICIAL_HOST = /(^|\.)(edu|ac|gov)(\.[a-z]{2})?$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$|\.gov\.[a-z]{2}$/i

const ref = (url: string, i: number) => `web:${createHash('sha256').update(url).digest('hex').slice(0, 8)}:${i}`

export interface ResearchInput {
  topics: string[]
  course: string | null
  universities: UniversitySite[]
  /** Fallback university name for the search query when no site is known. */
  universityName?: string | null
}

/**
 * Reads the university's own pages for the asked topic. Never throws; a failed or empty search is reported in the
 * record (and the draft is then flagged for a person), never replaced by guesses.
 */
export async function researchQuestion(input: ResearchInput, deps: ResearchDeps = {}): Promise<ResearchResult> {
  const now = deps.now?.() ?? new Date()
  const today = now.toISOString().slice(0, 10)
  const controller = new AbortController()
  const budget = setTimeout(() => controller.abort(), RESEARCH.totalBudgetMs)
  const get = deps.fetchPage ?? ((u: string, s: AbortSignal) => fetchPublicPage(u, AbortSignal.any([s, AbortSignal.timeout(RESEARCH.pageTimeoutMs)])))
  const search = deps.search === undefined ? searchProviderFrom() : deps.search
  const items: EvidenceItem[] = []
  const sources: ResearchSource[] = []
  const outdated: string[] = []
  let failure: string | null = null
  const topical = new Map<string, boolean>()
  const name = input.universities[0]?.name ?? input.universityName ?? null
  const query = name ? buildQuery(name, input.course, input.topics) : null
  try {
    const queue: { url: string; via: ResearchSource['via']; publisher: string; depth: number }[] = []
    for (const u of input.universities) {
      for (const url of [...u.courseUrls.slice(0, 2), u.officialWebsite]) queue.push({ url, via: 'lockin_record', publisher: u.name, depth: 0 })
    }
    if (search && query) {
      try {
        const known = input.universities.map((u) => new URL(u.officialWebsite).hostname.replace(/^www\./, ''))
        const found = await search.search(query, controller.signal)
        const official = found.filter((u) => {
          const h = new URL(u).hostname.replace(/^www\./, '')
          return known.some((k) => h === k || h.endsWith(`.${k}`)) || OFFICIAL_HOST.test(h)
        })
        for (const url of (official.length ? official : found).slice(0, 3)) queue.push({ url, via: 'search', publisher: new URL(url).hostname, depth: 0 })
      } catch {
        failure = 'The search service could not be reached.'
      }
    }
    if (!queue.length && !failure) failure = 'LockIn holds no official page for this university, so there was nothing to read.'
    const seen = new Set<string>()
    const topicWords = wordsFor(input.topics)
    // Pages are read three at a time, so the budget goes to more pages rather than waiting on one slow site.
    let n = 0
    while (n < queue.length && sources.length < RESEARCH.maxPages && !controller.signal.aborted) {
      const batch = queue.slice(n, n + 3)
      n += batch.length
      const wave = batch.filter((q) => !seen.has(q.url))
      wave.forEach((q) => seen.add(q.url))
      const pages = await Promise.all(wave.map((q) => get(q.url, controller.signal).catch(() => null)))
      wave.forEach((next, w) => {
        const page = pages[w]
        if (!page) return
        const text = pageText(page.html)
        const published = pageDate(page.html, page.lastModified)
        const stale = isOutdated(published, now)
        const passages = relevantPassages(text, input.topics, input.course)
        // Follow the page's own links to the admissions, fees or deadlines page (up to two hops from a page LockIn holds).
        if (next.depth < 2) for (const link of relevantLinks(page.html, page.url, input.topics, input.course)) queue.push({ url: link, via: 'linked_page', publisher: next.publisher, depth: next.depth + 1 })
        const title = pageTitle(page.html) || new URL(page.url).hostname
        const onTopic = topicWords.some((word) => `${new URL(page.url).pathname} ${title}`.toLowerCase().includes(word))
        // A page about the topic is kept as a source even when its text gives no readable figure (tables and PDFs), so the answer can point to it.
        if (!passages.length && !onTopic) return
        topical.set(page.url, onTopic)
        sources.push({ url: page.url, publisher: next.publisher, title, retrievedAt: today, published, outdated: stale, via: next.via })
        if (stale) outdated.push(`${new URL(page.url).hostname} (page last updated ${published})`)
        if (!passages.length)
          items.push({
            ref: ref(page.url, 0),
            text: `${UNVERIFIED_TAG}: the university's page "${title}" is about this topic, but its text gave no figure or date that could be read automatically; the student must check the page itself`,
            sourceUrl: page.url,
            publisher: next.publisher,
            checkedAt: today,
            unverified: true,
          })
        passages.forEach((pass, i) =>
          items.push({
            ref: ref(page.url, i),
            text: `${UNVERIFIED_TAG}: from the web page "${title}"${stale ? ` (last updated ${published}, possibly out of date)` : ''}: ${pass}`,
            sourceUrl: page.url,
            publisher: next.publisher,
            checkedAt: today,
            unverified: true,
          }),
        )
      })
    }
  } finally {
    clearTimeout(budget)
  }
  // A page whose address or title is about the topic outranks a home page that merely mentions it: when such pages exist,
  // passages from the others are dropped (news items on a home page are not an answer about fees).
  if ([...topical.values()].some(Boolean)) {
    for (let i = items.length - 1; i >= 0; i--) if (!topical.get(items[i].sourceUrl)) items.splice(i, 1)
    for (let i = sources.length - 1; i >= 0; i--) if (!topical.get(sources[i].url)) sources.splice(i, 1)
    outdated.splice(0, outdated.length, ...sources.filter((x) => x.outdated).map((x) => `${new URL(x.url).hostname} (page last updated ${x.published})`))
  }
  items.sort((a, b) => Number(/\d/.test(b.text)) - Number(/\d/.test(a.text)))
  if (!items.length && !failure) failure = 'The university pages that could be read did not state this.'
  return { items, record: { attempted: true, query, sources, conflicts: findConflicts(items, input.topics), outdated, official: input.universities.flatMap((u) => [...u.courseUrls.slice(0, 1), u.officialWebsite]), failure } }
}
