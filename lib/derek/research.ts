import { createHash } from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { conflictingScores, impossibleProblems, PREREQ_TAG, prerequisiteLines } from './completeness'
import { GOV_SEEDS, NOT_A_SOURCE, officialSiteFor } from './discovery'
import { screenForFreeTier } from './free-tier'
import { type AskedLevel, CLOSED_RE, isOtherQualification, matchesQualification, parseQualification, type Qualification, wrongLevelPage } from './qualification'
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
  totalBudgetMs: 22_000,
  maxBytes: 400_000,
  maxPages: 10,
  /** Every page read, relevant or not: bounds the time and load of one answer. */
  maxFetches: 20,
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
  /** Figures a page publishes that cannot be right (a TOEFL total of 5): the answer must not repeat them as settled, and the team follows up. */
  sourceProblems?: string[]
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
  /** Resolves a university name to its official website (default: Wikidata). */
  siteFor?: (name: string, signal: AbortSignal) => Promise<string | null>
  /** The page addresses in a site's sitemap (default: its sitemap.xml). */
  sitemap?: (site: string, signal: AbortSignal) => Promise<string[]>
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
const robotsCache = new Map<string, { at: number; rules: RobotsRules }>()

interface RobotsRules {
  allow: string[]
  disallow: string[]
}

/** The rules of a robots.txt that apply to "*" or to Derek, with grouped User-agent lines handled as the standard describes. */
export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [] }
  let applies = false
  let afterAgent = false
  for (const line of text.split(/\r?\n/)) {
    const [k, ...rest] = line.split('#')[0].split(':')
    const key = k.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (key === 'user-agent') {
      const mine = value === '*' || /derek/i.test(value)
      applies = afterAgent ? applies || mine : mine
      afterAgent = true
      continue
    }
    afterAgent = false
    if (!applies || !value) continue
    if (key === 'disallow') rules.disallow.push(value)
    else if (key === 'allow') rules.allow.push(value)
  }
  return rules
}

/** Whether a path (with query) may be fetched: the longest matching rule wins, Allow beating Disallow on a tie; `*` is any text and `$` ends the path. */
export function robotsPermits(rules: RobotsRules, pathAndQuery: string): boolean {
  const matchLength = (rule: string) => {
    const anchored = rule.endsWith('$')
    const core = anchored ? rule.slice(0, -1) : rule
    const pattern = core.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(pathAndQuery) ? core.length : -1
  }
  const blocked = Math.max(-1, ...rules.disallow.map(matchLength))
  if (blocked < 0) return true
  return Math.max(-1, ...rules.allow.map(matchLength)) >= blocked
}

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
  let rules = hit && Date.now() - hit.at < RESEARCH.cacheMs ? hit.rules : null
  if (!rules) {
    rules = { allow: [], disallow: [] }
    try {
      const res = await fetch(`${url.origin}/robots.txt`, { signal, headers: { 'user-agent': AGENT }, redirect: 'manual' })
      if (res.ok) rules = parseRobots(await readLimited(res, 100_000))
    } catch {
      // No robots.txt reachable: nothing is disallowed.
    }
    robotsCache.set(url.origin, { at: Date.now(), rules })
  }
  return robotsPermits(rules, url.pathname + url.search)
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
      .replace(/<(script|style|noscript|svg|template|nav|footer|header|form|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Line breaks inside the source ("graduate\nfee\nschedules") are not line breaks of the page: only block tags are.
      .replace(/\s+/g, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br|ul|ol|table|dd|dt|caption)\s*>|<br\s*\/?>|<\/t[dh]>(?=\s*<t[dh])/gi, (m) => (/^<\/t[dh]/i.test(m) ? ' | ' : '\n'))
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
  requirements: ['requirement', 'requirements', 'eligib', 'admission', 'entry', 'ielts', 'toefl', 'pte', 'duolingo', 'gpa', 'prerequisite', 'language', 'pathway', 'average', 'professional experience', 'portfolio', 'credits', 'new enrolments', 'new enrollments', 'transitional'],
  scholarships: ['scholarship', 'scholarships', 'bursary', 'funding', 'financial aid', 'grant'],
  application: ['how to apply', 'apply', 'application', 'steps', 'documents', 'checklist', 'supporting documents', 'submit', 'enrol', 'requirement', 'requirements', 'eligib', 'admission', 'average', 'pathway'],
  visa: ['visa', 'immigration', 'residence permit', 'study permit'],
  other: ['admission', 'apply', 'application'],
}

function wordsFor(topics: string[]): string[] {
  const out = new Set<string>()
  for (const t of topics.length ? topics : ['other']) {
    const key = /fee|tuition|cost/.test(t) ? 'fees' : /deadline|intake|date/.test(t) ? 'deadlines' : /requirement|eligib|entry|language|score/.test(t) ? 'requirements' : /scholar|fund|bursar/.test(t) ? 'scholarships' : /appl|document|step/.test(t) ? 'application' : /visa|immigr|permit/.test(t) ? 'visa' : 'other'
    for (const w of TOPIC_WORDS[key]) out.add(w)
  }
  return [...out]
}

/** A line only counts when it carries what the topic needs: a figure or date for fees and deadlines, a figure or a named qualification for requirements. */
function substantive(line: string, topics: string[]): boolean {
  const key = topics.join(' ')
  if (/fee|tuition|cost|deadline|intake|date/.test(key)) return /\d/.test(line)
  if (/appl|document|step/.test(key)) return CLOSED_RE.test(line) || /\b(?:apply|application|submit|documents?|checklist|portal|online|step|deadline|degree|bachelor|master|average|experience|portfolio|english)\b/i.test(line)
  if (/requirement|eligib|entry|language|score/.test(key)) return CLOSED_RE.test(line) || /\d|\b(?:degree|bachelor|master|ielts|toefl|pte|duolingo|gpa|grade|diploma|certificate|english|average|experience|portfolio|interview)\b/i.test(line)
  return true
}

const QUALIFICATION_NAME = /\b(?:Master|Bachelor|Doctor|Postgraduate Diploma|Graduate Diploma|Diploma|Certificate)\s+(?:of|in)\s+[A-Z][A-Za-z&-]*(?:\s+(?:and|of|in|&)?\s*[A-Z][A-Za-z&-]*){0,4}/g

/** A line about "the Master of Analytics" says nothing about a Computer Science question: lines naming only other qualifications are dropped. */
function namesOnlyOtherQualifications(line: string, q: Qualification): boolean {
  const names = line.match(QUALIFICATION_NAME) ?? []
  // Only the subject counts here: a Bachelor of the same subject is a prerequisite named in a Master's admission rule, not a competing programme.
  return names.length > 0 && names.every((n) => isOtherQualification(n, q, { ignoreLevel: true }))
}

/** A short table row or list item that is itself a fact: an amount, a percentage, a test score or a course code. */
const SHORT_FACT = /(?:[$€£₹]|\b(?:CAD|USD|EUR|GBP|AUD|NZD)\b)\s?\d|\d\s?%|\b(?:IELTS|TOEFL|PTE|Duolingo)\b.{0,20}\d|\b[A-Z]{2,5}\s?\d{3,4}[A-Z]?\b/

/** The lines of a page that speak about the topic, best first. */
export function relevantPassages(text: string, topics: string[], course: string | null, max: number = RESEARCH.passagesPerPage, q: Qualification | null = null): string[] {
  const words = wordsFor(topics)
  const courseWords = q ? q.words : (course ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
  const lines = [...new Set(text.split('\n').flatMap((l) => (l.length > 400 ? l.split(/(?<=[.!?])\s+/) : [l])).map((l) => l.trim()).filter((l) => (l.length >= 40 && l.length <= 400) || (l.length >= 12 && l.length < 40 && SHORT_FACT.test(l))))]
  return lines
    .map((line, i) => {
      const lower = line.toLowerCase()
      const hits = words.filter((w) => lower.includes(w)).length
      // A line that says the programme is closed to new students, or under transitional rules, is always worth keeping.
      return { line, i, score: hits * 2 + courseWords.filter((w) => lower.includes(w)).length + (/\d/.test(line) ? 1 : 0) + (CLOSED_RE.test(line) ? 4 : 0) + (line.length < 40 && SHORT_FACT.test(line) ? 3 : 0) }
    })
    .filter((x) => x.score >= 2 && substantive(x.line, topics) && !(q && namesOnlyOtherQualifications(x.line, q)))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.line)
}

const HREF = /<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
/** Same-site links whose address or text matches the topic, best first. */
export function relevantLinks(html: string, base: string, topics: string[], course: string | null, q: Qualification | null = null): string[] {
  return scoredLinks(html, base, topics, course, q).map((l) => l.url)
}

/** The same links with their scores, best first, so the crawl can read the most promising page next. */
export function scoredLinks(html: string, base: string, topics: string[], course: string | null, q: Qualification | null = null): { url: string; score: number; topic: number }[] {
  const words = wordsFor(topics)
  const courseWords = q ? q.words : (course ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
  // Pages that list qualifications and their regulations lead to the programme-specific rules.
  const hubWords = q ? ['qualification', 'regulation', 'calendar', 'postgraduate', 'programme'] : []
  // A phrase ("information sciences") says far more than a common word ("science"), which also names every college and news item.
  const weight = (w: string) => (w.includes(' ') ? 4 : 1)
  const host = new URL(base).hostname.replace(/^www\./, '')
  const scored = new Map<string, { score: number; topic: number }>()
  for (const m of html.matchAll(HREF)) {
    try {
      const u = new URL(m[1], base)
      const h = u.hostname.replace(/^www\./, '')
      if (u.protocol !== 'https:' || !(h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`))) continue
      // Student portals, logins and learning systems say nothing about admissions.
      if (/(^|[.-])(my|login|sso|moodle|portal|intranet|mail|webmail|lms|canvas|blackboard)[a-z]*\./i.test(u.hostname) || /\/(login|signin|sign-in|account|portal)\b/i.test(u.pathname)) continue
      if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) continue
      u.hash = ''
      const label = pageText(m[2])
      const hay = `${u.pathname.replace(/[-_/]+/g, ' ')} ${label}`.toLowerCase()
      // A link that names a different qualification is not followed: its requirements would not be this one's.
      if (q && isOtherQualification(label, q)) continue
      // The page that lists every qualification is the way to the programme-specific rules, so it outranks general admissions pages.
      const listing = q && /(?:all|find|browse|list of)[^.]{0,30}qualification|qualifications?\s+(?:and|&)\s+degrees|degrees?\s+(?:and|&)\s+programmes?|(?:programmes?|courses?)\s+a[\s-]*z/.test(label.toLowerCase()) ? 8 : 0
      const noise = /\b(?:college|colleges|school of|research|news|staff|people|events|alumni|campus|careers|giving)\b/.test(hay) ? 5 : 0
      // A link that speaks of the asked topic (fees, requirements, deadlines) outranks a link that only repeats the programme's name.
      const topic = words.filter((w) => hay.includes(w)).length
      const score = topic * 3 + courseWords.filter((w) => hay.includes(w)).reduce((n, w) => n + weight(w), 0) + hubWords.filter((w) => hay.includes(w)).length + listing - noise
      if (score > 0 && u.toString() !== base) scored.set(u.toString(), { score: Math.max(scored.get(u.toString())?.score ?? 0, score), topic: Math.max(scored.get(u.toString())?.topic ?? 0, topic) })
    } catch {
      // Not a usable link.
    }
  }
  return [...scored].sort((a, b) => b[1].score - a[1].score).slice(0, 8).map(([url, v]) => ({ url, score: v.score, topic: v.topic }))
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
        // Pages of one site (a tuition page, an application-fee page, a programme page) legitimately state different amounts; only different sites can contradict each other.
        if (new URL(entries[a][0]).hostname !== new URL(entries[b][0]).hostname && ![...entries[a][1]].some((v) => entries[b][1].has(v))) out.push(`${label} differ between ${new URL(entries[a][0]).hostname} and ${new URL(entries[b][0]).hostname}`)
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
  [/application/i, /appl(?:y|ication)|documents?|checklist/i],
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

/**
 * The independent web search (Owner brief, 13 Nov 2026): Tavily Search, free Researcher plan (1,000 credits a month, a basic search is 1 credit,
 * 100 requests a minute, no card), used only when TAVILY_API_KEY is set. Only result URLs are used: LockIn fetches and reads the pages itself.
 * Never Google or any search engine's result pages. Rate-limited here as well: a minute window, a monthly budget below the free credits,
 * and a circuit breaker when Tavily says the quota is gone, so a quota problem becomes an honest "search unavailable", never a paid charge
 * (Tavily bills pay-as-you-go only if the Owner switched it on).
 */
const tavily = { minute: [] as number[], month: '', used: 0, openUntil: 0 }
export const TAVILY = { perMinute: 30, monthlyBudget: 900 }
export function tavilyProviderFrom(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): SearchProvider | null {
  const key = (env.TAVILY_API_KEY ?? '').trim()
  if (!key) return null
  return {
    async search(query, signal) {
      const now = Date.now()
      const month = new Date(now).toISOString().slice(0, 7)
      if (tavily.month !== month) Object.assign(tavily, { month, used: 0 })
      tavily.minute = tavily.minute.filter((t) => now - t < 60_000)
      if (now < tavily.openUntil || tavily.minute.length >= TAVILY.perMinute || tavily.used >= TAVILY.monthlyBudget) throw Object.assign(new Error('search budget'), { retryable: false })
      tavily.minute.push(now)
      tavily.used++
      const res = await fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: query.slice(0, 300), search_depth: 'basic', max_results: 6, include_answer: false, include_raw_content: false, include_images: false }),
        redirect: 'error',
      })
      if (!res.ok) {
        void res.body?.cancel().catch(() => {})
        // 429 rate limit, 432/433 plan or pay-as-you-go limit exceeded, 401 bad key: stop asking for an hour.
        if ([401, 429, 432, 433].includes(res.status)) tavily.openUntil = now + 3_600_000
        throw Object.assign(new Error(`search ${res.status}`), { retryable: false })
      }
      const body = (await res.json()) as { results?: { url?: string }[] }
      return (body.results ?? []).map((r) => r.url).filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
    },
  }
}

/** Test hook. */
export const resetTavilyLimits = () => Object.assign(tavily, { minute: [], month: '', used: 0, openUntil: 0 })

/** The configured web search: Tavily when its key is set, else Brave when explicitly chosen (paid: off by default), else none. */
export function searchProviderFrom(env: Record<string, string | undefined> = process.env): SearchProvider | null {
  const free = tavilyProviderFrom(env)
  if (free) return free
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

/**
 * At most `max` evidence items, but never dropping a whole source: every page the research used keeps its best item, so any page the answer links is
 * in the evidence the link check reads. The rest of the room goes to the best-ranked items, in rank order.
 */
export function capEvidence<T extends { sourceUrl: string }>(items: T[], max: number): T[] {
  const firstOf = new Set<T>()
  const seen = new Set<string>()
  for (const i of items) if (!seen.has(i.sourceUrl) && firstOf.size < max) (seen.add(i.sourceUrl), firstOf.add(i))
  const rest = items.filter((i) => !firstOf.has(i)).slice(0, Math.max(0, max - firstOf.size))
  const keep = new Set([...firstOf, ...rest])
  return items.filter((i) => keep.has(i))
}

/** One spelling of a page address: no fragment, tracking query or trailing slash. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase()
  } catch {
    return raw
  }
}

/** Pages about people, news or the department itself say nothing about entry requirements, fees or deadlines. */
const NOT_ABOUT_ADMISSION = /\/(?:[^/]*-)?(?:advisory-board|board|contacts?|people|staff|faculty-members|news|events?|stories|story|alumni|blog|careers|giving|media)(?:-[^/]*)?(?:\/|$)/i

const SITEMAP_BYTES = 1_500_000

/** Page addresses listed in a site's sitemap.xml (robots.txt "Sitemap:" line, else /sitemap.xml), one level of sitemap index followed. Public https only. */
export async function fetchSitemapUrls(site: string, signal: AbortSignal): Promise<string[]> {
  const read = async (raw: string): Promise<string> => {
    const url = await assertPublicUrl(raw)
    const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(RESEARCH.pageTimeoutMs)]), redirect: 'manual', headers: { 'user-agent': AGENT, accept: 'application/xml,text/xml,text/plain' } })
    if (!res.ok) {
      void res.body?.cancel().catch(() => {})
      return ''
    }
    return readLimited(res, SITEMAP_BYTES)
  }
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*(https:\/\/[^<\s\]]+)/gi)].map((m) => m[1])
  try {
    const origin = new URL(site).origin
    const robots = await read(`${origin}/robots.txt`).catch(() => '')
    const declared = robots.match(/^\s*sitemap:\s*(https:\/\/\S+)/im)?.[1]
    let urls = locs(await read(declared ?? `${origin}/sitemap.xml`))
    // An index lists other sitemaps: read the first few that look like pages of programmes, admissions or fees.
    const children = urls.filter((u) => /\.xml(\.gz)?$/i.test(u) || /sitemap/i.test(u)).slice(0, 4)
    if (children.length && children.length === urls.length) urls = (await Promise.all(children.map((c) => read(c).then(locs).catch(() => [])))).flat()
    const host = new URL(site).hostname.replace(/^www\./, '')
    return urls.filter((u) => { try { const h = new URL(u).hostname.replace(/^www\./, ''); return (h === host || h.endsWith(`.${host}`)) && !/\.(xml|pdf|jpe?g|png|gif|zip|docx?|xlsx?)(\.gz)?$/i.test(u) } catch { return false } }).slice(0, 20_000)
  } catch {
    return []
  }
}

/** The sitemap pages that look most like the asked topic and qualification (a site search that needs no search engine). */
export function rankSitemapUrls(urls: string[], topics: string[], course: string | null, q: Qualification | null): { url: string; score: number }[] {
  const words = wordsFor(topics)
  const courseWords = q ? q.words : (course ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
  const scored: { url: string; score: number }[] = []
  for (const url of urls) {
    const path = decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, ' ').toLowerCase()
    if (/\b(news|events?|staff|people|alumni|blog|careers|giving|research|media|stories|story)\b/.test(path)) continue
    const topic = words.filter((w) => path.includes(w)).length
    const subject = courseWords.filter((w) => path.includes(w)).length
    if (!topic && !subject) continue
    // Both a topic and the asked subject beat either alone; shallow pages beat deep ones.
    const score = topic * 2 + subject * 3 + (topic && subject ? 4 : 0) - Math.min(3, path.split(' ').length / 6)
    if (score >= 2) scored.push({ url, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 6)
}

const OFFICIAL_HOST =/(^|\.)(edu|ac|gov)(\.[a-z]{2})?$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$|\.gov\.[a-z]{2}$/i

const ref = (url: string, i: number) => `web:${createHash('sha256').update(url).digest('hex').slice(0, 8)}:${i}`

export interface ResearchInput {
  topics: string[]
  course: string | null
  universities: UniversitySite[]
  /** The institution the student named, which may be absent from LockIn's directory (found on the internet instead). */
  universityName?: string | null
  /** Graduate or undergraduate study, from the student's words: pages about the other level are not read. */
  level?: AskedLevel | null
  /** Destination countries the question is about (ISO codes and names), for visa and country-level questions. */
  destinations?: { iso2: string; name: string }[]
  /** Internet search for this answer (Gemini Google Search grounding); omitted = none beyond the optional Brave setting. */
  search?: SearchProvider | null
}

/** The query for a question that names no institution: the topic and the country, nothing about the student. */
export function buildTopicQuery(topics: string[], countries: string[]): string {
  return [countries.slice(0, 2).join(' and '), topics.length ? topics.join(' ') : 'study', 'for international students official'].filter(Boolean).join(' ').slice(0, 200)
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
  const search = input.search !== undefined ? input.search : deps.search === undefined ? searchProviderFrom() : deps.search
  const items: EvidenceItem[] = []
  const sources: ResearchSource[] = []
  const outdated: string[] = []
  let failure: string | null = null
  let searchFailure: string | null = null
  const topical = new Map<string, boolean>()
  const name = input.universities[0]?.name ?? input.universityName ?? null
  const q = parseQualification(input.course)
  const query = name ? buildQuery(name, input.course, input.topics) : input.destinations?.length ? buildTopicQuery(input.topics, input.destinations.map((d) => d.name)) : null
  const official: string[] = input.universities.flatMap((u) => [...u.courseUrls.slice(0, 1), u.officialWebsite])
  try {
    const queue: { url: string; via: ResearchSource['via']; publisher: string; depth: number; score: number }[] = []
    for (const u of input.universities) {
      for (const url of [...u.courseUrls.slice(0, 2), u.officialWebsite]) queue.push({ url, via: 'lockin_record', publisher: u.name, depth: 0, score: 100 })
    }
    // 1. A university LockIn does not hold: its official website from Wikidata (free, no key).
    if (!input.universities.length && name) {
      const site = await (deps.siteFor ?? ((n: string, s: AbortSignal) => officialSiteFor(n, s)))(name, controller.signal).catch(() => null)
      if (site) {
        queue.push({ url: site, via: 'search', publisher: name, depth: 0, score: 100 })
        official.push(site)
      }
    }
    // The official site's own sitemap is searched for the asked topic and qualification: a site search that needs no search engine.
    const sites = [...new Set([...input.universities.map((u) => u.officialWebsite), ...official.filter((u) => !input.universities.some((x) => x.officialWebsite === u) && /^https:\/\/[^/]+\/?$/.test(u))])].slice(0, 2)
    for (const site of sites) {
      const urls = await (deps.sitemap ?? (deps.fetchPage ? async () => [] : fetchSitemapUrls))(site, controller.signal).catch(() => [])
      for (const hit of rankSitemapUrls(urls, input.topics, input.course, q)) queue.push({ url: hit.url, via: 'linked_page', publisher: name ?? new URL(site).hostname, depth: 1, score: 80 + hit.score })
    }
    // 2. Official government pages for a visa question about a destination LockIn knows.
    if (input.topics.some((t) => /visa|immigr|permit/.test(t)))
      for (const d of input.destinations ?? []) for (const url of GOV_SEEDS[d.iso2] ?? []) queue.push({ url, via: 'search', publisher: new URL(url).hostname.replace(/^www\./, ''), depth: 0, score: 95 })
    // 3. Internet search (Gemini Google Search grounding): up to two attempts, the second with a plainer query. A failure is
    //    reported and the pages found above are still read; nothing is invented to fill the gap.
    if (search && query) {
      const known = [...input.universities.map((u) => u.officialWebsite), ...official].map((u) => new URL(u).hostname.replace(/^www\./, ''))
      const attempts = [query, name ? `${name} ${input.topics[0] ?? 'admissions'} official site` : query]
      let searchError: string | null = null
      for (const attempt of attempts) {
        if (controller.signal.aborted) break
        try {
          const found = (await search.search(attempt, controller.signal)).filter((u) => {
            try {
              return new URL(u).protocol === 'https:' && !NOT_A_SOURCE.test(new URL(u).hostname) && !wrongLevelPage(u, '', input.level ?? null)
            } catch {
              return false
            }
          })
          const preferred = found.filter((u) => {
            const h = new URL(u).hostname.replace(/^www\./, '')
            return known.some((k) => h === k || h.endsWith(`.${k}`)) || OFFICIAL_HOST.test(h)
          })
          // Official-looking pages first; other reputable pages only when no official one turned up.
          for (const url of (preferred.length ? preferred : found).slice(0, 4)) queue.push({ url, via: 'search', publisher: new URL(url).hostname.replace(/^www\./, ''), depth: 0, score: 90 })
          searchError = null
          if (found.length) break
        } catch (e) {
          searchError = 'The internet search could not be completed.'
          if ((e as { retryable?: boolean })?.retryable === false) break
        }
      }
      searchFailure = searchError
    }
    if (!queue.length && !failure) failure = 'No official page could be found for this online, so there was nothing to read.'
    const seen = new Set<string>()
    const topicWords = wordsFor(input.topics)
    // Pages are read three at a time, so the budget goes to more pages rather than waiting on one slow site.
    const readPages = new Set<string>()
    let fetched = 0
    let onTopicCount = 0 // pages about the asked topic; side pages read on the way do not use up the allowance
    for (;;) {
      if (onTopicCount >= RESEARCH.maxPages || fetched >= RESEARCH.maxFetches || controller.signal.aborted) break
      // The most promising unread page goes next: a link that names the asked qualification beats a general admissions page.
      const wave = queue.filter((x) => !seen.has(x.url)).sort((x, y) => y.score - x.score).slice(0, 3)
      if (!wave.length) break
      wave.forEach((x) => seen.add(x.url))
      fetched += wave.length
      const pages = await Promise.all(wave.map((q) => get(q.url, controller.signal).catch(() => null)))
      wave.forEach((next, w) => {
        const page = pages[w]
        if (!page) return
        // The same page reached by two spellings (trailing slash, redirect, tracking query) is read once.
        const pageKey = canonicalUrl(page.url)
        if (readPages.has(pageKey)) return
        readPages.add(pageKey)
        const text = pageText(page.html)
        const published = pageDate(page.html, page.lastModified)
        const stale = isOutdated(published, now)
        const title = pageTitle(page.html) || new URL(page.url).hostname
        // A page about another qualification is not read for evidence at all (and not followed from).
        if (q && isOtherQualification(title, q)) return
        // Undergraduate pages for a master's question (or the reverse) say nothing about the asked programme.
        if (wrongLevelPage(page.url, title, input.level ?? null)) return
        const passages = relevantPassages(text, input.topics, input.course, /requirement|eligib|entry/.test(input.topics.join(' ')) ? 10 : RESEARCH.passagesPerPage, q)
        // Follow the page's own links to the admissions, fees or deadlines page (up to two hops from a page LockIn holds).
        if (next.depth < 3) for (const link of scoredLinks(page.html, page.url, input.topics, input.course, q).filter((l) => !wrongLevelPage(l.url, '', input.level ?? null))) queue.push({ url: link.url, via: 'linked_page', publisher: next.publisher, depth: next.depth + 1, score: link.topic >= 2 ? 82 + Math.min(12, link.score) : link.score })
        const onTopic = topicWords.some((word) => `${new URL(page.url).pathname} ${title}`.toLowerCase().includes(word)) || (q != null && matchesQualification(`${new URL(page.url).pathname} ${title}`, q))
        // A page about the topic is kept as a source even when its text gives no readable figure (tables and PDFs), so the answer can point to it.
        if (!passages.length && !onTopic) return
        // A people, news or department page that happens to share the programme's name is not a source for this answer.
        if (NOT_ABOUT_ADMISSION.test(new URL(page.url).pathname) && !topicWords.some((word) => new URL(page.url).pathname.toLowerCase().includes(word))) return
        topical.set(page.url, onTopic)
        if (onTopic) onTopicCount++
        sources.push({ url: page.url, publisher: next.publisher, title, retrievedAt: today, published, outdated: stale, via: next.via })
        if (stale) outdated.push(`${new URL(page.url).hostname} (page last updated ${published})`)
        // Prerequisite courses are kept whole and apart from the general passages (short list lines would otherwise be dropped).
        const prereq = onTopic && /requirement|eligib|entry/.test(input.topics.join(' ')) ? prerequisiteLines(text.split('\n')) : []
        if (prereq.length)
          items.push({
            ref: `${ref(page.url, 0).slice(0, -2)}:prereq`,
            text: `${UNVERIFIED_TAG}: ${PREREQ_TAG} "${title}" ::: ${prereq.join(' ;; ')}`,
            sourceUrl: page.url,
            publisher: next.publisher,
            checkedAt: today,
            unverified: true,
          })
        if (!passages.length)
          items.push({
            ref: ref(page.url, 0),
            text: `${UNVERIFIED_TAG}: the university's page "${title}" is about this topic, but its text gave no figure or date that could be read automatically; the student must check the page itself`,
            sourceUrl: page.url,
            publisher: next.publisher,
            checkedAt: today,
            unverified: true,
          })
        passages.filter((p) => !prereq.includes(p.replace(/\s+/g, ' ').trim())).forEach((pass, i) =>
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
  // Only a page the answer actually rests on can make it "possibly out of date": an old, unrelated page that gave no passage does not.
  const usedUrls = new Set(items.filter((i) => !/text gave no figure/.test(i.text)).map((i) => i.sourceUrl))
  outdated.splice(0, outdated.length, ...sources.filter((x) => x.outdated && usedUrls.has(x.url)).map((x) => `${new URL(x.url).hostname} (page last updated ${x.published})`))
  // Best first: lines from pages about the asked qualification, lines that say a programme is closed, then lines with figures.
  const aboutAsked = new Set(sources.filter((x) => q != null && matchesQualification(`${new URL(x.url).pathname} ${x.title}`, q)).map((x) => x.url))
  const rank = (i: EvidenceItem) => (aboutAsked.has(i.sourceUrl) ? 4 : 0) + (CLOSED_RE.test(i.text) ? 2 : 0) + (/english language|admission requirements/i.test(i.text) ? 2 : 0) + (/\d/.test(i.text) ? 1 : 0) + (i.ref.endsWith(':prereq') ? 5 : 0)
  items.sort((x, y) => rank(y) - rank(x))
  if (!items.length && searchFailure) failure = searchFailure
  if (!items.length && !failure) failure = 'The university pages that could be read did not state this.'
  const sourceProblems = impossibleProblems(items)
  return { items, record: { attempted: true, query, sources, conflicts: [...findConflicts(items, input.topics), ...conflictingScores(items)], outdated, official, ...(sourceProblems.length ? { sourceProblems } : {}), failure } }
}

const NO_RESEARCH: ResearchResult = { items: [], record: { attempted: true, query: null, sources: [], conflicts: [], outdated: [], failure: 'The university pages could not be read.' } }

/** Two research results as one: items interleaved so each university is represented, sources, conflicts and problems joined. */
export function mergeResearch(results: ResearchResult[]): ResearchResult {
  if (results.length === 1) return results[0]
  const items: EvidenceItem[] = []
  for (let i = 0; results.some((r) => i < r.items.length); i++) for (const r of results) if (i < r.items.length) items.push(r.items[i])
  const failures = results.map((r) => r.record.failure).filter((f): f is string => f != null)
  return {
    items,
    record: {
      attempted: true,
      query: results.map((r) => r.record.query).filter(Boolean).join(' || ') || null,
      sources: results.flatMap((r) => r.record.sources),
      conflicts: results.flatMap((r) => r.record.conflicts),
      outdated: results.flatMap((r) => r.record.outdated),
      official: results.flatMap((r) => r.record.official ?? []),
      ...(results.some((r) => r.record.sourceProblems?.length) ? { sourceProblems: results.flatMap((r) => r.record.sourceProblems ?? []) } : {}),
      failure: items.length ? null : (failures[0] ?? 'The university pages that could be read did not state this.'),
    },
  }
}

/**
 * Research for one named university, or for two when the student compares them: each is researched on its own (in parallel, each with its own time
 * budget and web search) and the evidence is merged. `run` is the single-university research (researchQuestion with the search provider attached).
 */
export async function researchAll(
  run: (input: ResearchInput) => Promise<ResearchResult>,
  input: ResearchInput,
  names: string[],
  directory: UniversitySite[] = [],
): Promise<ResearchResult> {
  const targets = names.length >= 2 ? names.slice(0, 2) : [input.universityName ?? null]
  const results = await Promise.all(
    targets.map((name) => {
      const own = name ? directory.filter((u) => norm(u.name).includes(norm(name)) || norm(name).includes(norm(u.name))) : directory
      const one = run({ ...input, universityName: name, universities: targets.length > 1 ? own : input.universities })
      // In a comparison one failing university does not lose the other; a single research that fails still fails (the caller routes it to a person).
      return targets.length > 1 ? one.catch(() => NO_RESEARCH) : one
    }),
  )
  return mergeResearch(results)
}
