// Answer-quality behaviour for everyday questions: question analysis, follow-up questions, the
// provider prompt, draft clean-up and the safeguards that keep unsourced facts out. Offline only.
import { describe, expect, it } from 'vitest'
import { analyseQuestion, detectDestinations } from '@/lib/derek/guidance'
import { DEREK_INSTRUCTIONS, DIRECTORY_LABEL, type DraftRequest, type EvidenceItem } from '@/lib/derek/provider'
import { buildGeminiRequest } from '@/lib/derek/providers/gemini'
import { MockProvider } from '@/lib/derek/providers/mock'
import { assessDraft, assessQuestion, factTopicsIn, unsupportedFigures } from '@/lib/derek/safeguards'
import { tidyDraft, wordCount } from '@/lib/derek/style'

const feeEvidence: EvidenceItem[] = [
  { ref: 'tuition_fee:7', text: 'MSc Data Science tuition fee (international): GBP 26000.00 per year, academic year 2026-2027', sourceUrl: 'https://uni.example/fees', checkedAt: '2026-10-01' },
]
const listing: EvidenceItem[] = [
  { ref: 'university:3', text: 'Example University, London (UK) is listed in the LockIn directory; official website https://uni.example/', sourceUrl: 'https://uni.example/', checkedAt: '2026-10-01' },
]
const intakeEvidence: EvidenceItem[] = [
  { ref: 'course_intake:9', text: 'MSc Data Science intake: September 2027, application deadline 2027-06-30', sourceUrl: 'https://uni.example/apply', checkedAt: '2026-10-01' },
]

async function mockDraft(question: string, evidence: EvidenceItem[] = [], earlier = '') {
  const guidance = analyseQuestion(question, evidence, earlier)
  const request: DraftRequest = { question, history: [], evidence, instructions: DEREK_INSTRUCTIONS, guidance }
  const out = await new MockProvider().generate(request, { signal: new AbortController().signal })
  const text = tidyDraft(out.text)
  return { guidance, text, risk: assessDraft(text, assessQuestion(question, evidence), evidence, { modelUncertain: out.uncertain }) }
}

describe('question analysis', () => {
  it('treats concept questions as general, with no follow-up', () => {
    for (const q of ['What is a conditional offer?', 'What does deferral mean?', 'How do I write a statement of purpose?', 'Explain UCAS clearing'])
      expect(analyseQuestion(q, []), q).toMatchObject({ kind: 'general', askFollowUp: false, followUp: null })
  })

  it('asks one focused follow-up for open-ended planning questions', () => {
    expect(analyseQuestion('I want to study abroad, where should I start?', [])).toMatchObject({
      kind: 'general',
      askFollowUp: true,
      followUp: 'Are you planning undergraduate or postgraduate study, and in which subject?',
    })
    // Already known from earlier messages: no follow-up needed.
    expect(analyseQuestion('Which course should I choose?', [], 'I want a master’s in computer science').askFollowUp).toBe(false)
  })

  it('recognises broad destination questions and what to compare', () => {
    const g = analyseQuestion('Tell me about UK universities', [])
    expect(g).toMatchObject({ kind: 'broad_destination', destinations: ['UK'], askFollowUp: true })
    expect(g.note).toMatch(/course content and structure, entry requirements for their level, total cost .*location .*application timelines/)
    expect(g.note).toMatch(/do not name or recommend specific universities/)
    expect(analyseQuestion('Should I study in Canada or Germany?', []).destinations).toEqual(['Canada', 'Germany'])
    expect(analyseQuestion('Tell me about UK universities', listing).note).toMatch(/may name them on the "From the LockIn directory:" line/)
    expect(analyseQuestion('Tell me about UK universities for a master’s in data science', []).askFollowUp).toBe(false)
  })

  it('routes specific facts to verified evidence, or to an honest "not verified" answer with a follow-up', () => {
    const missing = analyseQuestion('What are the tuition fees at Imperial College London?', [])
    expect(missing).toMatchObject({ kind: 'specific_fact', topics: ['fees or costs'], askFollowUp: true, followUp: 'Which university and course are you interested in?' })
    expect(missing.note).toMatch(/LockIn has no verified record .* Start with \[UNCERTAIN\]/)
    expect(missing.note).toMatch(/do not give any figure, date or range/)
    const sourced = analyseQuestion('What are the tuition fees for MSc Data Science at Example University?', feeEvidence)
    expect(sourced).toMatchObject({ kind: 'specific_fact', askFollowUp: false, followUp: null })
    expect(sourced.note).toMatch(/Use ONLY the matching EVIDENCE lines/)
  })

  it('detects destinations by everyday names without false matches', () => {
    expect(detectDestinations('Is Dubai good for business?').map((d) => d.iso2)).toEqual(['AE'])
    expect(detectDestinations('Can you tell us about the UK?').map((d) => d.iso2)).toEqual(['GB'])
    expect(detectDestinations('I like studying in America or NZ').map((d) => d.iso2).sort()).toEqual(['NZ', 'US'])
    expect(detectDestinations('What is a personal statement?')).toEqual([])
  })

  it('matches plural and stemmed factual topics (regression: "requirements" was missed)', () => {
    expect(factTopicsIn('What are the entry requirements?')).toEqual(['entry or language requirements'])
    expect(factTopicsIn('Any scholarships?')).toEqual(['scholarships'])
    expect(factTopicsIn('What are the deadlines and intakes?')).toEqual(['intakes or deadlines'])
    expect(factTopicsIn('Am I eligible?')).toEqual(['entry or language requirements'])
    expect(factTopicsIn('Is it expensive?')).toEqual(['fees or costs'])
    expect(factTopicsIn('How selective is it?')).toEqual(['acceptance rates'])
    expect(factTopicsIn('What is a conditional offer?')).toEqual([])
  })
})

describe('provider prompt', () => {
  it('sets style, separation of general guidance and sourced facts, and the follow-up rule', () => {
    expect(DEREK_INSTRUCTIONS).toMatch(/Usually 80 to 150 words/)
    expect(DEREK_INSTRUCTIONS).toMatch(/no greeting, no "Great question", no repeating the question, no sign-off, no filler/)
    expect(DEREK_INSTRUCTIONS).toMatch(/General guidance never contains numbers, fees, dates, rankings, percentages or test scores/)
    expect(DEREK_INSTRUCTIONS).toContain(`starts with "${DIRECTORY_LABEL}"`)
    expect(DEREK_INSTRUCTIONS).toMatch(/end with ONE short, focused follow-up question\. Never ask more than one question/)
    expect(DEREK_INSTRUCTIONS).toMatch(/Never promise or predict admission, a scholarship, a visa/)
  })

  it('sends the per-question task note to Gemini between the rules and the evidence', () => {
    const guidance = analyseQuestion('Tell me about UK universities', [])
    const text = buildGeminiRequest({ question: 'Tell me about UK universities', history: [], evidence: [], instructions: DEREK_INSTRUCTIONS, guidance }).systemInstruction.parts[0].text
    const [rules, task, evidence] = [text.indexOf('STYLE:'), text.indexOf('TASK FOR THIS QUESTION:'), text.indexOf('EVIDENCE:\n- none')]
    expect(rules).toBeGreaterThan(-1)
    expect(task).toBeGreaterThan(rules)
    expect(evidence).toBeGreaterThan(task)
    expect(text).toContain(guidance.note)
  })
})

describe('draft clean-up', () => {
  it('removes greetings, filler and markdown but keeps the answer', () => {
    expect(tidyDraft('Hi there! Great question. A **conditional offer** means you still need to meet some conditions.\n\nHope this helps!')).toBe(
      'A conditional offer means you still need to meet some conditions.',
    )
    expect(tidyDraft('## Overview\n* Course content\n* Costs\nGood luck with your applications!')).toBe('Overview\n- Course content\n- Costs')
    expect(tidyDraft('Thank you for your question. Sure, here it is.')).toBe('here it is.')
    expect(tidyDraft('Hello!')).toBe('Hello!') // never empties a draft
    expect(wordCount('one two  three\nfour')).toBe(4)
  })
})

describe('safeguards for everyday answers', () => {
  const q = assessQuestion('Tell me about deadlines', [])
  it('flags invented deadlines written as dates', () => {
    for (const d of ['Applications close on 15 January.', 'The deadline is January 15th.', 'Apply by the 1st of March.'])
      expect(assessDraft(d, q, []).level, d).toBe('high')
    expect(unsupportedFigures('The deadline is 30 June 2027.', intakeEvidence)).toEqual([])
    expect(assessDraft('Intakes are usually in September or January; check each course page.', q, []).reasons).not.toContain(expect.stringMatching(/Figures/))
  })

  it('flags visa and work-rights numbers even without a visa question', () => {
    const general = assessQuestion('What is student life like?', [])
    for (const d of ['Students can work 20 hours a week.', 'The graduate route visa lasts 2 years.', 'Post-study work rights are 3 years.'])
      expect(assessDraft(d, general, []).level, d).toBe('high')
    expect(assessDraft('Check the official government website for current visa rules.', general, []).level).toBe('low')
  })

  it('flags claims of LockIn verification when no evidence was provided', () => {
    const general = assessQuestion('Tell me about UK universities', [])
    expect(assessDraft(`${DIRECTORY_LABEL}\n- Example University is great.`, general, []).reasons).toContain('Draft claims LockIn-verified information, but no verified evidence was provided')
    expect(assessDraft('LockIn has verified that this course is excellent.', general, []).level).toBe('high')
    expect(assessDraft('LockIn has not verified the fees yet, so check the official page.', general, []).level).toBe('low')
    expect(assessDraft(`${DIRECTORY_LABEL}\n- ${listing[0].text}`, general, listing).level).toBe('low')
  })
})

describe('mock answers follow the contract end to end', () => {
  it('broad question: what to compare, no figures, one follow-up, low risk', async () => {
    const { text, risk } = await mockDraft('Tell me about UK universities')
    expect(text).toMatch(/course content and structure[\s\S]*entry requirements[\s\S]*total cost[\s\S]*location[\s\S]*application timelines/)
    expect(text).not.toContain(DIRECTORY_LABEL)
    expect(text.match(/\?/g)).toHaveLength(1)
    expect(text.trim().endsWith('?')).toBe(true)
    expect(wordCount(text)).toBeLessThanOrEqual(150)
    expect(risk.level).toBe('low')
  })

  it('broad question with verified listings: names them only on the directory line', async () => {
    const { text, risk } = await mockDraft('Tell me about UK universities', listing)
    expect(text).toContain(`${DIRECTORY_LABEL}\n- Example University, London (UK) is listed in the LockIn directory`)
    expect(risk.level).toBe('low')
  })

  it('missing verified data: explains the limitation, gives no figure, asks which university and course', async () => {
    const { text, risk } = await mockDraft('What are the tuition fees at Imperial College London?')
    expect(text).toMatch(/LockIn has not verified fees or costs yet/)
    expect(text.trim().endsWith('Which university and course are you interested in?')).toBe(true)
    expect(unsupportedFigures(text, [])).toEqual([])
    expect(risk.level).toBe('uncertain')
  })

  it('sourced fact: quotes the directory line with its source and stays low risk', async () => {
    const { text, risk } = await mockDraft('What are the tuition fees for MSc Data Science at Example University?', feeEvidence)
    expect(text).toContain(`${DIRECTORY_LABEL}\n- MSc Data Science tuition fee (international): GBP 26000.00 per year`)
    expect(text).toContain('official source: https://uni.example/fees')
    expect(risk.level).toBe('low')
  })

  it('general concept question: direct answer, no follow-up', async () => {
    const { text, guidance } = await mockDraft('What is a conditional offer?')
    expect(guidance.askFollowUp).toBe(false)
    expect(text).not.toMatch(/\?/)
  })
})
