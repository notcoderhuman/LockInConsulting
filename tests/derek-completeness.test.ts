// Evidence completeness and source sanity (general, not specific to one university): prerequisite courses are never dropped for vague wording,
// and a published score that cannot be right is never repeated as a requirement.
import { beforeEach, describe, expect, it } from 'vitest'
import { completeAnswer, completenessNote, conflictingScores, englishLanguagePage, impossibleProblems, impossibleScores, prerequisiteBlocks, prerequisiteLines, PREREQ_TAG } from '@/lib/derek/completeness'
import { clearResearchCache, researchQuestion, type Page } from '@/lib/derek/research'
import { UNVERIFIED_TAG, type EvidenceItem } from '@/lib/derek/provider'

const PROGRAMME = 'https://www.example-uni.test/programmes/data-science'
const ADMIT = 'https://www.example-uni.test/data-science/admission-requirements'
const ENGLISH = 'https://www.example-uni.test/admissions/english-language-requirements'
const web = (url: string, text: string, ref = `web:${url.length}:0`): EvidenceItem => ({ ref, text: `${UNVERIFIED_TAG}: from the web page "Page": ${text}`, sourceUrl: url, publisher: 'Example', checkedAt: '2026-11-14', unverified: true })

const ADMISSION_PAGE = [
  'Applicants typically have an honours bachelor’s degree in computer science or statistics, with a minimum overall average of 78%.',
  'Applicants should have completed the following prerequisite courses or their equivalent:',
  'Intro to computer science, e.g., CS 115 and CS 116',
  'Probability, e.g., STAT 230',
  'Statistics, e.g., STAT 231',
  'Algorithms, e.g., CS 341',
  'Mathematical statistics, e.g., STAT 330 (Alt. STAT 334 **)',
  '** STAT334 does not cover all prerequisite topics, and some additional reading may be required.',
]

describe('prerequisite courses', () => {
  it('keeps every short list line that names a course code, in page order', () => {
    const lines = prerequisiteLines(ADMISSION_PAGE)
    expect(lines).toEqual([
      'Intro to computer science, e.g., CS 115 and CS 116',
      'Probability, e.g., STAT 230',
      'Statistics, e.g., STAT 231',
      'Algorithms, e.g., CS 341',
      'Mathematical statistics, e.g., STAT 330 (Alt. STAT 334 **)',
      '** STAT334 does not cover all prerequisite topics, and some additional reading may be required.',
    ])
  })
  it('finds nothing on a page that speaks of no prerequisites, however many course codes it lists', () => {
    expect(prerequisiteLines(['Fall term timetable', 'CS 115 Monday 10:00', 'STAT 230 Tuesday 11:00'])).toEqual([])
  })
  it('a researched page produces one prerequisite item next to its ordinary passages', async () => {
    clearResearchCache()
    const html = `<html><title>Admission requirements - Master of Data Science</title><body>${ADMISSION_PAGE.map((l) => `<p>${l}</p>`).join('')}</body></html>`
    const pages: Record<string, Page> = { [ADMIT]: { url: ADMIT, html, lastModified: null }, 'https://www.example-uni.test/': { url: 'https://www.example-uni.test/', html: `<html><title>Example</title><body><a href="${ADMIT}">Admission requirements for the Master of Data Science</a></body></html>`, lastModified: null } }
    const result = await researchQuestion(
      { topics: ['entry or language requirements'], course: 'Master of Data Science', universities: [], universityName: 'Example University', search: null },
      { fetchPage: async (u) => pages[u] ?? null, siteFor: async () => 'https://www.example-uni.test/' },
    )
    const blocks = prerequisiteBlocks(result.items)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].url).toBe(ADMIT)
    expect(blocks[0].lines.join(' ')).toMatch(/CS 115[\s\S]*STAT 230[\s\S]*STAT 231[\s\S]*CS 341[\s\S]*STAT 330/)
    expect(result.items.some((i) => /78%/.test(i.text))).toBe(true)
    expect(result.items[0].ref.endsWith(':prereq')).toBe(true) // ranked first: it is what a requirements answer most often leaves out
  })
  it('tells the model to list them all, and completes an answer that does not', () => {
    const items = [{ ...web(ADMIT, ''), ref: 'web:abcd1234:prereq', text: `${UNVERIFIED_TAG}: ${PREREQ_TAG} "Admission requirements" ::: ${prerequisiteLines(ADMISSION_PAGE).join(' ;; ')}` }]
    const sources = [{ url: ADMIT, title: 'Admission Requirements | Data Science | Example University' }]
    expect(completenessNote(items, sources)).toMatch(/CS 115[\s\S]*STAT 231[\s\S]*give ALL of these/)
    const vague = 'You need an honours bachelor’s degree with a 78% average and some specific prerequisite courses in computer science and statistics.'
    const done = completeAnswer(vague, items, sources)
    expect(done).toContain(vague)
    for (const code of ['CS 115', 'STAT 230', 'STAT 231', 'CS 341', 'STAT 330']) expect(done).toContain(code)
    expect(done).toContain(`](${ADMIT})`)
    expect(done).toContain('Admission Requirements')
    // Complete answers are untouched, and nothing is invented when no prerequisite evidence exists.
    const full = `${vague}\n- CS 115 and CS 116\n- STAT 230\n- STAT 231\n- CS 341\n- STAT 330`
    expect(completeAnswer(full, items, sources)).toBe(full)
    expect(completeAnswer(vague, [], sources)).toBe(vague)
  })
})

describe('scores that cannot be right, and sources that disagree', () => {
  const programme = web(PROGRAMME, 'TOEFL 5 (writing 5, speaking 5), IELTS 7.5 (writing 7.0, speaking 7.0)')
  it('flags a TOEFL total of 5 but not a real requirement', () => {
    expect(impossibleScores([programme]).map((s) => [s.test, s.value])).toEqual([['TOEFL', 5]])
    expect(impossibleProblems([programme])[0]).toMatch(/TOEFL 5 on www\.example-uni\.test\/programmes\/data-science cannot be a TOEFL total score/)
    expect(impossibleScores([web(PROGRAMME, 'TOEFL 90 (writing 22), IELTS 7.0, PTE 65, Duolingo 120')])).toEqual([])
    expect(impossibleScores([web(PROGRAMME, 'IELTS 12 and PTE 5')]).map((s) => s.test).sort()).toEqual(['IELTS', 'PTE'])
  })
  it('reports two pages that state different totals for the same test', () => {
    const a = web(PROGRAMME, 'IELTS 7.5 and TOEFL 100')
    const b = web(ENGLISH, 'IELTS 6.5 and TOEFL 100')
    const found = conflictingScores([a, b])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/^IELTS scores differ between/)
    expect(conflictingScores([a, web(ENGLISH, 'IELTS 7.5')])).toEqual([])
  })
  it('records the problem, tells the model not to repeat it, and links the English-language page', async () => {
    clearResearchCache()
    const html = (title: string, body: string) => `<html><title>${title}</title><body>${body}</body></html>`
    const pages: Record<string, Page> = {
      [PROGRAMME]: { url: PROGRAMME, lastModified: null, html: html('Master of Data Science', '<p>Applicants need an honours bachelor’s degree with a minimum overall average of 78%.</p><p>TOEFL 5 (writing 5, speaking 5), IELTS 7.5 (writing 7.0, speaking 7.0)</p>') },
      [ENGLISH]: { url: ENGLISH, lastModified: null, html: html('English language requirements', '<p>The official language of instruction is English; accepted tests include IELTS Academic and TOEFL iBT.</p>') },
    }
    const result = await researchQuestion(
      { topics: ['entry or language requirements'], course: 'Master of Data Science', universities: [], universityName: 'Example University', search: { search: async () => [PROGRAMME, ENGLISH] } },
      { fetchPage: async (u) => pages[u] ?? null, siteFor: async () => null },
    )
    expect(result.record.sourceProblems?.[0]).toMatch(/TOEFL 5 .* cannot be a TOEFL total score/)
    const note = completenessNote(result.items, result.record.sources)
    expect(note).toMatch(/SOURCE PROBLEM[\s\S]*Do not present TOEFL 5 as a requirement/)
    expect(note).toContain(`[English language requirements](${ENGLISH})`)
    expect(englishLanguagePage(result.record.sources)).toBe(ENGLISH)
  })
  it('adds a short caution when the answer repeats the impossible score without one, and not when it already cautions', () => {
    const items = [programme]
    const sources = [{ url: PROGRAMME, title: 'Master of Data Science' }, { url: ENGLISH, title: 'English language requirements' }]
    const careless = 'For English you need TOEFL 5 or IELTS 7.5.'
    const fixed = completeAnswer(careless, items, sources)
    expect(fixed).toMatch(/TOEFL figure on that page looks like a typing error, because a TOEFL total cannot be 5/)
    expect(fixed).toContain(`](${ENGLISH})`)
    const careful = 'The page lists IELTS 7.5, but its TOEFL 5 looks like an error, so please confirm the TOEFL score on the English language page.'
    expect(completeAnswer(careful, items, sources)).toBe(careful)
  })
})

beforeEach(() => clearResearchCache())
