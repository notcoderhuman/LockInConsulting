import type { EvidenceItem } from './provider'

// Evidence completeness and source sanity (Owner request, 14 Nov 2026). Two general checks, nothing specific to one university:
//   1. Prerequisite courses (named, with course codes) published by an official page are extracted as their own evidence, told to the
//      model by name, and, if the written answer still leaves any out, appended from the evidence itself (never invented).
//   2. English test scores that cannot be right (a TOEFL iBT total of 5) or that two pages state differently are reported as a source
//      problem: Derek explains the discrepancy, links the page, and the team is asked to follow up. They are never repeated as settled.

const COURSE_CODE = /\b[A-Z]{2,5}\s?\d{3,4}[A-Z]?\b/g
const BACKGROUND_CUE = /prerequisite|prior (?:course|study|knowledge)|required background|background (?:in|required)|qualifying course|foundation course|must have (?:completed|taken)|should have (?:completed|taken)|equivalent (?:of|to) the following/i

/** The lines of a page that name prerequisite courses, in page order, when the page speaks of prerequisites at all. */
export function prerequisiteLines(pageLines: string[]): string[] {
  const text = pageLines.join('\n')
  if (!BACKGROUND_CUE.test(text)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of pageLines) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length < 6 || line.length > 260 || !/\b[A-Z]{2,5}\s?\d{3,4}[A-Z]?\b/.test(line)) continue
    // A prose sentence that only mentions a code in passing is a passage, not a list entry; list entries are short.
    if (line.length > 140 && !/e\.g\.|alt\./i.test(line)) continue
    if (seen.has(line.toLowerCase())) continue
    seen.add(line.toLowerCase())
    out.push(line)
    if (out.length >= 16) break
  }
  return out
}

export const PREREQ_TAG = 'the prerequisite courses listed on the page'
const stripTag = (t: string) => t.replace(/^UNVERIFIED[^:]*: /, '')

export interface PrerequisiteBlock {
  url: string
  lines: string[]
}

/** The prerequisite lists found in the research evidence, one per page, with the page the student can open. */
export function prerequisiteBlocks(items: EvidenceItem[]): PrerequisiteBlock[] {
  return items
    .filter((i) => i.ref.endsWith(':prereq'))
    .map((i) => ({ url: i.sourceUrl, lines: (stripTag(i.text).split(' ::: ')[1] ?? '').split(' ;; ').map((l) => l.trim()).filter(Boolean) }))
}

const codesIn = (text: string) => new Set([...text.matchAll(COURSE_CODE)].map((m) => m[0].replace(/\s/g, '').toUpperCase()))

// ---------------------------------------------------------------------------------------------
// English test scores
// ---------------------------------------------------------------------------------------------

type Test = 'TOEFL' | 'IELTS' | 'PTE' | 'Duolingo'
const SCORE = /\b(TOEFL(?: iBT)?|IELTS(?: Academic)?|PTE(?: Academic)?|Duolingo(?: English Test)?)\b[^0-9\n.]{0,24}(\d{1,3}(?:\.\d)?)/gi
// What a total score can be, and the lowest total any university plausibly asks for.
const RANGE: Record<Test, [number, number, number]> = { TOEFL: [0, 120, 40], IELTS: [0, 9, 4], PTE: [10, 90, 30], Duolingo: [10, 160, 70] }
const testName = (raw: string): Test => (/toefl/i.test(raw) ? 'TOEFL' : /ielts/i.test(raw) ? 'IELTS' : /pte/i.test(raw) ? 'PTE' : 'Duolingo')

export interface ScoreMention {
  test: Test
  value: number
  line: string
  url: string
}

export function scoreMentions(items: EvidenceItem[]): ScoreMention[] {
  const out: ScoreMention[] = []
  for (const i of items) {
    if (!i.ref.startsWith('web:') || i.ref.endsWith(':prereq')) continue
    const text = stripTag(i.text)
    for (const m of text.matchAll(SCORE)) {
      const value = Number(m[2])
      if (Number.isFinite(value)) out.push({ test: testName(m[1]), value, line: text.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + m[0].length + 60).replace(/\s+/g, ' ').trim(), url: i.sourceUrl })
    }
  }
  return out
}

/** Scores that cannot be a total score for that test, as published ("TOEFL 5"). */
export function impossibleScores(items: EvidenceItem[]): ScoreMention[] {
  return scoreMentions(items).filter((s) => s.value < RANGE[s.test][2] || s.value > RANGE[s.test][1])
}

/** The same test with different required totals on different pages. */
export function conflictingScores(items: EvidenceItem[]): string[] {
  const valid = scoreMentions(items).filter((s) => s.value >= RANGE[s.test][2] && s.value <= RANGE[s.test][1])
  const out: string[] = []
  for (const test of ['TOEFL', 'IELTS', 'PTE', 'Duolingo'] as Test[]) {
    const byUrl = new Map<string, Set<number>>()
    for (const s of valid.filter((x) => x.test === test)) byUrl.set(s.url, new Set([...(byUrl.get(s.url) ?? []), s.value]))
    const entries = [...byUrl]
    for (let a = 0; a < entries.length; a++)
      for (let b = a + 1; b < entries.length; b++)
        if (![...entries[a][1]].some((v) => entries[b][1].has(v))) out.push(`${test} scores differ between ${new URL(entries[a][0]).hostname}${new URL(entries[a][0]).pathname} and ${new URL(entries[b][0]).hostname}${new URL(entries[b][0]).pathname}`)
  }
  return [...new Set(out)]
}

/** One natural-language source problem per impossible score, for the research record and the team's follow-up note. */
export function impossibleProblems(items: EvidenceItem[]): string[] {
  const host = (u: string) => `${new URL(u).hostname}${new URL(u).pathname}`
  return [...new Set(impossibleScores(items).map((s) => `${s.test} ${s.value} on ${host(s.url)} cannot be a ${s.test} total score, so the page probably has an error`))]
}

/** The university-wide English-language page among the pages read, the authoritative place to send the student for test scores. */
export function englishLanguagePage(sources: { url: string; title: string }[]): string | null {
  return sources.find((s) => /english[-\s]?language|language[-\s]?proficiency|\belp\b|english[-\s]?requirements/i.test(`${new URL(s.url).pathname} ${s.title}`))?.url ?? null
}

// ---------------------------------------------------------------------------------------------
// What the model is told, and what is added when it still leaves a published fact out
// ---------------------------------------------------------------------------------------------

/** Extra instructions for the model: every prerequisite course by code, and how to handle a score that cannot be right. */
export function completenessNote(items: EvidenceItem[], sources: { url: string; title: string }[]): string {
  const parts: string[] = []
  const blocks = prerequisiteBlocks(items)
  if (blocks.length)
    parts.push(
      `The university publishes prerequisite courses (${blocks[0].url}): ${blocks[0].lines.join('; ')}. When you explain the entry requirements, give ALL of these in a short bulleted list with their codes and subjects, as published, and say they are on that page. Do not call them "specific courses" or "certain areas".`,
    )
  const bad = impossibleScores(items)
  if (bad.length) {
    const ealp = englishLanguagePage(sources)
    parts.push(
      `SOURCE PROBLEM: the page ${bad[0].url} publishes "${bad[0].line}", but a ${bad[0].test} total cannot be ${bad[0].value}, so that figure is almost certainly a typing error on the university's page. Do not present ${bad[0].test} ${bad[0].value} as a requirement. Say naturally that the page's ${bad[0].test} figure looks like an error, give the other test scores as published, and tell the student to confirm the exact ${bad[0].test} score ${ealp ? `on the university's English-language requirements page, which you link as [English language requirements](${ealp}),` : 'with the university,'} before booking a test.`,
    )
  }
  return parts.join(' ')
}

/**
 * The completed answer: when the written answer leaves out prerequisite courses that an official page lists (or repeats an impossible score
 * without any caution), a short factual addendum built from the evidence itself is added. Returns the answer unchanged when it is complete.
 */
export function completeAnswer(answer: string, items: EvidenceItem[], sources: { url: string; title: string }[]): string {
  let out = answer
  const blocks = prerequisiteBlocks(items)
  if (blocks.length) {
    const have = codesIn(out)
    // A line counts as covered when the answer names any course of it (alternatives and footnotes need no repeat).
    const missing = blocks[0].lines.filter((l) => !l.startsWith('*') && codesIn(l).size > 0 && ![...codesIn(l)].some((c) => have.has(c)))
    if (missing.length) {
      const title = sources.find((s) => s.url === blocks[0].url)?.title.split(/\s[|–-]\s/)[0].trim() || 'the university’s page'
      out += `\n\nThe university also lists these prerequisite courses on [${title}](${blocks[0].url}):\n${blocks[0].lines.map((l) => `- ${l}`).join('\n')}`
    }
  }
  for (const s of impossibleScores(items).slice(0, 1)) {
    const repeated = new RegExp(`${s.test}[^.\\n]{0,40}\\b${s.value}\\b`, 'i').test(out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'))
    const cautioned = /\b(?:error|typo|mistake|looks? (?:incorrect|wrong|odd|unusual)|appears? (?:incorrect|to be an error)|cannot be right|not a valid|unusual)\b/i.test(out)
    if (repeated && !cautioned) {
      const ealp = englishLanguagePage(sources)
      out += `\n\nOne note: the ${s.test} figure on that page looks like a typing error, because a ${s.test} total cannot be ${s.value}. Please confirm the ${s.test} score ${ealp ? `on the university’s [English language requirements](${ealp}) page` : 'with the university'} before you book a test.`
    }
  }
  return out
}
