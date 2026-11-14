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
      'Mathematical statistics, e.g., STAT 330 (Alt. STAT 334)',
      'Note: STAT334 does not cover all prerequisite topics, and some additional reading may be required.',
    ])
    expect(lines.join(' ')).not.toContain('*') // no stray Markdown reaches the student
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

describe('the evidence cap never drops a whole source', () => {
  it('keeps one item for every page used, then the best-ranked rest', async () => {
    const { capEvidence } = await import('@/lib/derek/research')
    const item = (url: string, n: number) => ({ sourceUrl: url, n })
    const items = [...Array.from({ length: 8 }, (_, n) => item('https://a.test/x', n)), item('https://b.test/y', 0), item('https://c.test/z', 0), item('https://b.test/y', 1)]
    const capped = capEvidence(items, 5)
    expect(capped).toHaveLength(5)
    expect(new Set(capped.map((i) => i.sourceUrl))).toEqual(new Set(['https://a.test/x', 'https://b.test/y', 'https://c.test/z']))
    expect(capped.map((i) => i.n)).toEqual([0, 1, 0, 0, 1].length === 5 ? capped.map((i) => i.n) : [])
    expect(capEvidence(items.slice(0, 3), 10)).toEqual(items.slice(0, 3))
  })
})

describe('false alarms the evaluation found', () => {
  it('only a score written right after the test name counts, and a zero filler is ignored', () => {
    const w = (text: string) => web(PROGRAMME, text)
    expect(impossibleScores([w('TOEFL scores are valid for 2 years; IELTS results for 2 years')])).toEqual([])
    expect(impossibleScores([w('Program | TOEFL | 0 ; TOEFL 0')])).toEqual([])
    expect(impossibleScores([w('IELTS Academic: 6.5 overall; TOEFL iBT score of 90; PTE Academic minimum score of 65')])).toEqual([])
    expect(impossibleScores([w('Applicants need TOEFL iBT total of 5')]).map((s) => s.value)).toEqual([5])
    expect(impossibleScores([w('TOEFL 5 (writing 5, speaking 5)')]).map((s) => s.value)).toEqual([5])
  })
  it('pages of one site never make a fee "conflict" (application fee versus tuition)', async () => {
    const { findConflicts } = await import('@/lib/derek/research')
    const a = web('https://grad.example.test/application-fee', 'The tuition and application fee for international applicants is CDN $168.25')
    const b = web('https://grad.example.test/tuition', 'Tuition fee for international students is CDN $9,000 per year')
    const c = web('https://other-site.test/fees', 'Tuition fee for international students is CDN $12,500 per year')
    expect(findConflicts([a, b], ['fees or costs'])).toEqual([])
    expect(findConflicts([b, c], ['fees or costs'])).toHaveLength(1) // two different sites disagreeing is still reported
  })
  it('the uncertainty marker is removed wherever the model puts it, and still marks the answer uncertain', async () => {
    const { parseGeminiResponse } = await import('@/lib/derek/providers/gemini')
    const body = (text: string) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] })
    const mid = parseGeminiResponse(body('Apply online.\n\n[UNCERTAIN] These pages are old, so confirm on the page.'), 'm')
    expect(mid.uncertain).toBe(true)
    expect(mid.text).toBe('Apply online.\n\nThese pages are old, so confirm on the page.')
    const start = parseGeminiResponse(body('[UNCERTAIN] I could not confirm the fee.'), 'm')
    expect(start).toMatchObject({ uncertain: true, text: 'I could not confirm the fee.' })
    expect(parseGeminiResponse(body('A plain answer.'), 'm').uncertain).toBe(false)
  })
  it('a comparison question yields the course too ("for a master’s in computer science")', async () => {
    const { askedQualification } = await import('@/lib/derek/qualification')
    expect(askedQualification('Compare the University of Toronto and the University of British Columbia for a master’s in computer science.')).toBe("master's in computer science")
    expect(askedQualification('What are the entry requirements for the MSc in Data Science at University of Waterloo?')).toBe('msc in data science')
    expect(askedQualification('How do I apply to a master’s programme at McGill University?')).toBe("master's programme")
    expect(askedQualification('How do I write a statement of purpose?')).toBeNull()
  })
})

describe('fee and date conflicts need two focused claims, not two tables', () => {
  it('pages that list many amounts never contradict each other', async () => {
    const { findConflicts } = await import('@/lib/derek/research')
    const table = (url: string, amounts: string[]) => web(url, `Tuition fee table: ${amounts.join(', ')}`)
    const a = table('https://cs.example-a.test/fees', ['CAD 8,622', 'CAD 9,608', 'CAD 9,892', 'CAD 9,570'])
    const b = table('https://sgs.example-b.test/fees', ['CAD 5,738', 'CAD 10,081', 'CAD 1,203'])
    expect(findConflicts([a, b], ['fees or costs'])).toEqual([])
    const one = web('https://one.example-c.test/fees', 'The tuition fee is CAD 9,000 per year')
    const two = web('https://two.example-d.test/fees', 'The tuition fee is CAD 12,000 per year')
    expect(findConflicts([one, two], ['fees or costs'])).toHaveLength(1)
  })
})

describe('shortening a researched answer keeps its substance', () => {
  it('asks for a tightened rewrite with figures and links, not four short bullets', async () => {
    const { shorteningInstruction } = await import('@/lib/derek/drafts')
    const researched = shorteningInstruction('x'.repeat(3200), true)
    expect(researched).toMatch(/about 1,600 to 2,200 characters/)
    expect(researched).toMatch(/keep the most important requirements, figures \(with their currency\) and the official page links/)
    expect(researched).not.toMatch(/at most four short bullets/)
    expect(shorteningInstruction('x'.repeat(1200))).toMatch(/at most four short bullets/) // the short, country-level form is unchanged
  })
})

describe('the answer rules ask for stated amounts and never call a stated amount missing', () => {
  it('says so in the fixed instructions', async () => {
    const { DEREK_INSTRUCTIONS } = await import('@/lib/derek/provider')
    expect(DEREK_INSTRUCTIONS).toMatch(/Include the main amounts, scores, deadlines and durations that EVIDENCE states/)
    expect(DEREK_INSTRUCTIONS).toMatch(/never say an amount is "not stated" while any EVIDENCE line gives it/)
    expect(DEREK_INSTRUCTIONS).toMatch(/Give the currency with every amount/)
    expect(DEREK_INSTRUCTIONS).toMatch(/answer the question that was asked, in your first sentence/)
  })
})
