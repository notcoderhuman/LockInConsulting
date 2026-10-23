import { describe, expect, it } from 'vitest'
import { analyseQuestion } from '@/lib/derek/guidance'
import { DEREK_INSTRUCTIONS } from '@/lib/derek/provider'
import { MockProvider } from '@/lib/derek/providers/mock'
import { assessDraft } from '@/lib/derek/safeguards'
import { styleIssues, tidyDraft } from '@/lib/derek/style'

// Editorial quality checks (Wikipedia: Signs of AI writing, used as a style guide). These are not
// AI-detection scores: they flag specific, fixable habits and accept many natural answer shapes.

describe('natural answers pass, whatever their shape', () => {
  it('accepts a short paragraph, a useful list, an honest "not verified", and varied sentences', () => {
    for (const text of [
      'A conditional offer means the university will hold a place for you once you meet the remaining conditions, usually your final results or an English test. Read the offer letter carefully: it lists each condition and the date by which you must meet it.',
      'For a master’s in data science, compare these on each official course page:\n- modules and how much is taught versus project work\n- entry requirements for your degree and marks\n- total cost, including living costs in that city\n- the application deadline for your intake\nIf you tell me which countries you are considering, I can narrow this down.',
      'LockIn has not verified the fee for that course yet, so I won’t guess. The university’s official course page lists the current fee and the academic year it applies to.',
      'Yes, you can apply with a gap year. Most universities only ask you to explain it briefly in your statement of purpose. Say what you did and what you learned from it.',
    ])
      expect(styleIssues(text), text.slice(0, 40)).toEqual([])
  })

  it('accepts the offline mock’s own answers', async () => {
    const provider = new MockProvider()
    for (const question of ['What is a statement of purpose?', 'Tell me about UK universities', 'What are the fees at Synthetic University?']) {
      const guidance = analyseQuestion(question, [])
      const { text } = await provider.generate({ question, history: [], evidence: [], instructions: DEREK_INSTRUCTIONS, guidance }, { signal: new AbortController().signal })
      expect(styleIssues(text), question).toEqual([])
    }
  })
})

describe('flags the habits the style rules forbid', () => {
  const cases: [string, string][] = [
    ['Great question! A SOP is a short essay about your goals.', 'Starts with filler instead of the answer'],
    ['Certainly, a SOP is a short essay about your goals.', 'Starts with filler instead of the answer'],
    ['A SOP is a short essay about your goals. I hope this helps!', 'Chatbot sign-off or filler phrase'],
    ['Let me know if you have more questions about the SOP.', 'Chatbot sign-off or filler phrase'],
    ['Oxford is a prestigious, world-class university for your studies.', 'Promotional wording'],
    ['Embark on your journey to a top university abroad.', 'Promotional wording'],
    ['Canada has a vibrant, thriving student life and a seamless application process.', 'Cluster of buzzwords'],
    ['Studying abroad opens up endless opportunities for a bright future.', 'Vague claim about significance or opportunities'],
    ['It is not just a degree, but a life-changing experience.', '"Not just X, but Y" construction'],
    ['Based on available information, the course is popular.', 'Generic hedge or disclaimer'],
    ['**Fees** depend on the course. 🎓', 'Decorative formatting (bold, headings or emoji)'],
    ['## Requirements\nCheck the course page.', 'Decorative formatting (bold, headings or emoji)'],
    [Array.from({ length: 9 }, (_, i) => `- point ${i}`).join('\n'), 'Long list'],
    ['You should check the course page. You should compare costs. You should apply early.', 'Repetitive sentence openings'],
    [Array.from({ length: 230 }, () => 'word').join(' '), 'Long reply (230 words)'],
  ]
  it.each(cases)('%s', (text, issue) => {
    expect(styleIssues(text)).toContain(issue)
  })

  it('treats a claim to be a person as high risk, never as a style nit', () => {
    for (const text of ['I am a LockIn counsellor and I can help.', 'As a human adviser, I suggest the UK.', 'I’m a member of the LockIn team.'])
      expect(assessDraft(text, { level: 'low', reasons: [] }, []), text).toMatchObject({ level: 'high', reasons: ['Draft claims to be a person'] })
    expect(assessDraft('I’m Derek, LockIn’s AI assistant.', { level: 'low', reasons: [] }, []).level).toBe('low')
  })

  it('tidies removable filler, and the checks still catch what tidying cannot fix', () => {
    expect(tidyDraft('Great question! A SOP explains your goals. Hope this helps!')).toBe('A SOP explains your goals.')
    expect(styleIssues(tidyDraft('Great question! Oxford is a world-class university.'))).toEqual(['Promotional wording'])
  })
})
