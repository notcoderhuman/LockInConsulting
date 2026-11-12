import type { EvidenceItem } from './provider'

// Which qualification a student means, and which pages and records are about it (Owner request, 12 Nov 2026).
// Universities rename and replace programmes ("Master of Computer Science" became "Master of Information Sciences"; the
// old "Master of Science (Computer Science)" stopped taking new students), and similarly named programmes have different
// requirements and fees. So Derek asks the same questions of every source: is this about the qualification the student
// named (or its official successor name), or about another one? A page or record about another qualification is never
// evidence for this one. Pure and deterministic; no model, no network, nothing about the student.
// shortcut: the subject aliases are a short hand-written list; add to it when a real question names a field it does not know.

export type Level = 'master' | 'bachelor' | 'doctoral' | 'diploma'

export interface Qualification {
  /** What the student wrote. */
  text: string
  level: Level | null
  /** Words that identify the subject: the student's own, plus official names it is commonly renamed to. */
  words: string[]
}

const LEVEL_WORDS: Record<Level, RegExp> = {
  master: /\b(?:master'?s?|masters|msc|m\.sc|meng|mphil|mtech|mba)\b/i,
  bachelor: /\b(?:bachelor'?s?|bsc|b\.sc|beng|btech|undergraduate)\b/i,
  doctoral: /\b(?:phd|ph\.d|doctor(?:al|ate)?|dphil)\b/i,
  diploma: /\b(?:diploma|certificate)\b/i,
}
const ANY_LEVEL = /\b(?:master'?s?|masters|msc|m\.sc|meng|mphil|mtech|mba|postgraduate|bachelor'?s?|bsc|b\.sc|beng|btech|undergraduate|phd|ph\.d|doctor(?:al|ate)?|dphil|diploma|certificate|honours)\b/i

// Words that describe the kind of page, not the subject of the qualification.
const PAGE_WORDS = new Set(['regulations', 'regulation', 'qualification', 'qualifications', 'requirements', 'requirement', 'admission', 'admissions', 'entry', 'overview', 'guide', 'university', 'college', 'schedule', 'calendar', 'details', 'information about'])

const GENERIC = new Set(['master', 'masters', 'bachelor', 'bachelors', 'degree', 'programme', 'program', 'course', 'postgraduate', 'undergraduate', 'diploma', 'certificate', 'honours', 'with', 'from', 'that', 'this', 'what', 'about', 'study', 'studies'])

// Subject → the official names it is also known by. A word here only widens matching; the answer still names the official title.
const ALIASES: [RegExp, string[]][] = [
  [/computer science|computing/, ['computer', 'computing', 'information science', 'information sciences', 'informatics', 'software engineering', 'information technology']],
  [/information technology|\bit\b/, ['information technology', 'information systems', 'computing', 'computer science']],
  [/data science/, ['data science', 'data analytics', 'analytics', 'statistics']],
  [/artificial intelligence|machine learning/, ['artificial intelligence', 'machine learning', 'intelligent systems']],
  [/business administration|\bmba\b/, ['business administration', 'mba', 'management']],
  [/electrical/, ['electrical', 'electronic']],
  [/mechanical/, ['mechanical', 'mechatronics']],
]

const normalise = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'")

export function parseQualification(text: string | null | undefined): Qualification | null {
  const t = normalise((text ?? '').trim())
  if (t.length < 3) return null
  const level = (Object.keys(LEVEL_WORDS) as Level[]).find((l) => LEVEL_WORDS[l].test(t)) ?? null
  const own = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w))
  const aliases = ALIASES.filter(([re]) => re.test(t)).flatMap(([, list]) => list)
  const words = [...new Set([...own, ...aliases])]
  return words.length ? { text: text!.trim(), level, words } : null
}

/** The qualification named in a question ("…for Master's in Computer Science at Massey University"), when the student did not choose one beforehand. */
export function askedQualification(question: string): string | null {
  const m = normalise(question).match(/\b(?:for|of|in|on|about|into)\s+(?:the\s+|an?\s+)?((?:master|masters|master's|bachelor|bachelor's|msc|bsc|mba|phd|postgraduate|undergraduate|diploma)[^?.,;]{2,70}?)\s+(?:at|from|@)\s+[a-z]/i)
  return m ? m[1].trim() : null
}

/** Does this title, link text or address speak about the asked qualification (or a name it is commonly renamed to)? */
export function matchesQualification(label: string, q: Qualification): boolean {
  const l = normalise(label).replace(/[-_/]+/g, ' ')
  return q.words.some((w) => l.includes(w))
}

/** The degree levels a title names. */
const levelsIn = (title: string): Level[] => (Object.keys(LEVEL_WORDS) as Level[]).filter((l) => LEVEL_WORDS[l].test(normalise(title)))

/**
 * A qualification of another name: the title names a degree level but nothing of the asked subject, or names the asked subject
 * at a different level (a Bachelor's page is not evidence for a Master's).
 */
export function isOtherQualification(title: string, q: Qualification): boolean {
  if (!ANY_LEVEL.test(normalise(title))) return false
  if (!matchesQualification(title, q)) return true
  const levels = levelsIn(title)
  if (q.level != null && levels.length > 0 && !levels.includes(q.level)) return true
  // "Master of Dairy Science and Technology" shares the common word "science" with a Computer Science question but names another subject.
  const head = normalise(title).split(/\s[-–—|:]\s/)[0]
  const subject = head.split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !GENERIC.has(t) && !PAGE_WORDS.has(t))
  return subject.some((t) => !q.words.some((w) => w.includes(t) || t.includes(w)))
}

/** Lines that say a programme no longer takes new students, or is under transitional rules. */
export const CLOSED_RE = /not\s+(?:be\s+)?accept(?:ing)?\s+(?:any\s+)?new\s+enrol?ments|closed\s+to\s+new\s+(?:enrol?ments|students|applicants)|no\s+longer\s+(?:accept(?:ing)?|offered|available)|disestablish|transitional\s+provisions|not\s+open\s+for\s+(?:new\s+)?(?:enrol?ment|admission)/i

const COURSE_RECORD = /^(?:draft_)?(?:course|tuition_fee|course_intake)\b/

/**
 * Records about other courses are not evidence for the asked one: a fee, intake or requirement of the Master of Analytics
 * never answers a question about Computer Science. University listings and rankings stay.
 */
export function dropOtherCourseEvidence(evidence: EvidenceItem[], q: Qualification | null): EvidenceItem[] {
  if (!q) return evidence
  return evidence.filter((e) => !COURSE_RECORD.test(e.ref) || matchesQualification(e.text, q))
}
