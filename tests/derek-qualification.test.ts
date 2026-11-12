// Which qualification a student means, and the Massey regression: the pages and rules that answer
// "What are the entry requirements for Master's in Computer Science at Massey University?" (fixtures, no network).
import { describe, expect, it } from 'vitest'
import { askedQualification, CLOSED_RE, dropOtherCourseEvidence, isOtherQualification, matchesQualification, parseQualification } from '@/lib/derek/qualification'
import { researchQuestion } from '@/lib/derek/research'
import type { EvidenceItem } from '@/lib/derek/provider'
import { ANALYTICS_RULE, MASSEY, masseyPages, PATHWAYS } from './fixtures/massey-site'

const NOW = new Date('2026-11-12T10:00:00Z')
const site = { name: 'Massey University', officialWebsite: MASSEY.home, courseUrls: [MASSEY.analytics] } // LockIn only holds the Master of Analytics page

describe('qualification matching', () => {
  const cs = parseQualification('Master’s in Computer Science')!

  it('knows the level and the official names a subject is also known by', () => {
    expect(cs.level).toBe('master')
    for (const name of ['Master of Information Sciences', 'Master of Science', 'Master of Computing', 'Master of Software Engineering'])
      expect(matchesQualification(name, cs), name).toBe(true)
    expect(parseQualification('MBA')?.level).toBe('master')
    expect(parseQualification('Bachelor of Engineering')?.level).toBe('bachelor')
    expect(parseQualification('x')).toBeNull()
  })

  it('does not confuse similarly named programmes', () => {
    for (const other of ['Master of Analytics', 'Master of Business Administration', 'Bachelor of Nursing', 'Master of Engineering Studies', 'Master of Dairy Science and Technology', 'Master of Health Science', 'Bachelor of Information Sciences', 'Postgraduate Diploma in Information Sciences'])
      expect(isOtherQualification(other, cs), other).toBe(true)
    // A generic page is not "another qualification".
    for (const generic of ['Entry requirements to study at Massey University', 'All qualifications and degrees']) expect(isOtherQualification(generic, cs), generic).toBe(false)
    // The renamed qualification and the old pathway are both about the asked subject.
    expect(isOtherQualification('Master of Information Sciences - Qualification regulations', cs)).toBe(false)
    expect(isOtherQualification('Master of Information Sciences – MInfSc – Massey University', cs)).toBe(false) // a code after the name is not a subject
    expect(isOtherQualification('Master of Science', cs)).toBe(false)
    // Data science is not silently Computer Science, but its own alias list knows analytics.
    const ds = parseQualification('Master of Data Science')!
    expect(matchesQualification('Master of Analytics', ds)).toBe(true)
    expect(isOtherQualification('Master of Analytics', cs)).toBe(true)
  })

  it('finds the qualification in a question, and the closed-programme wording', () => {
    expect(askedQualification('What are the entry requirements for Master’s in Computer Science at Massey University?')).toBe("master's in computer science")
    expect(askedQualification('What are the fees for the Bachelor of Nursing at Otago?')).toBe('bachelor of nursing')
    expect(askedQualification('How do I write a statement of purpose?')).toBeNull()
    for (const closed of ['The Master of Science with a major in Computer Science is not accepting new enrolments.', 'This programme is closed to new students.', 'It is available under transitional provisions.', 'No longer offered from 2025.'])
      expect(CLOSED_RE.test(closed), closed).toBe(true)
    expect(CLOSED_RE.test('Applications for the 2027 intake are open.')).toBe(false)
  })

  it('drops records about another course and keeps the rest', () => {
    const item = (ref: string, text: string): EvidenceItem => ({ ref, text, sourceUrl: 'https://x.example/', publisher: 'x', checkedAt: '2026-11-12' })
    const kept = dropOtherCourseEvidence(
      [item('draft_university:74', 'Massey University, official website https://www.massey.ac.nz/'), item('draft_course:59', 'Master of Analytics offers a degree'), item('draft_course:59:requirements', 'Master of Analytics entry requirements: C+ average'), item('draft_tuition_fee:31', 'Master of Analytics tuition fee: NZD 9000'), item('course:7', 'Master of Information Sciences offers 180 credits')],
      cs,
    )
    expect(kept.map((e) => e.ref)).toEqual(['draft_university:74', 'course:7'])
    expect(dropOtherCourseEvidence([item('course:1', 'Anything')], null)).toHaveLength(1)
  })
})

describe('Massey entry requirements (regression fixture)', () => {
  const run = () =>
    researchQuestion(
      { topics: ['entry or language requirements'], course: 'Master’s in Computer Science', universities: [site] },
      { fetchPage: async (u) => masseyPages[u] ?? null, search: null, now: () => NOW },
    )

  it('reaches the programme pages and the regulations, never reads the Master of Analytics', async () => {
    const out = await run()
    const urls = out.record.sources.map((s) => s.url)
    for (const wanted of [MASSEY.minfsc, MASSEY.minfscRegulations, MASSEY.mscRegulations, MASSEY.entry]) expect(urls, wanted).toContain(wanted)
    expect(urls).not.toContain(MASSEY.analytics)
    expect(out.record.failure).toBeNull()
    const text = out.items.map((i) => i.text).join('\n')
    expect(text).not.toContain(ANALYTICS_RULE)
    expect(text).not.toMatch(/C\+ average/)
    // The three published pathways, exactly as the programme page states them.
    for (const pathway of PATHWAYS) expect(text).toContain(pathway)
    expect(text).toContain('180-credit')
    expect(text).toMatch(/English language requirements/)
    expect(text).toContain('Computer Science is among the subjects available under transitional provisions')
    // The old pathway is reported as closed, from the regulations.
    expect(out.items.find((i) => i.sourceUrl === MASSEY.mscRegulations)?.text).toMatch(/not accepting new enrolments/)
    // The programme's own pages come first.
    expect(out.items[0].sourceUrl).not.toBe(MASSEY.entry)
  })

  it('stops at the generic admissions page only when nothing programme-specific is published', async () => {
    const generic = Object.fromEntries(Object.entries(masseyPages).filter(([u]) => ![MASSEY.minfsc, MASSEY.minfscRegulations, MASSEY.mscRegulations].includes(u as never)))
    const out = await researchQuestion({ topics: ['entry or language requirements'], course: 'Master’s in Computer Science', universities: [site] }, { fetchPage: async (u) => generic[u] ?? null, search: null, now: () => NOW })
    const urls = out.record.sources.map((s) => s.url)
    expect(urls).toContain(MASSEY.entry)
    for (const specific of [MASSEY.minfsc, MASSEY.minfscRegulations, MASSEY.mscRegulations, MASSEY.analytics]) expect(urls).not.toContain(specific)
    expect(out.items.map((i) => i.text).join('\n')).not.toContain(ANALYTICS_RULE)
  })
})

describe('answers about requirements are not blocked for being honest or complete', () => {
  it('does not treat "does not guarantee admission" as a guarantee, but still catches a real one', async () => {
    const { assessDraft } = await import('@/lib/derek/safeguards')
    const none = { level: 'low' as const, reasons: [] }
    for (const honest of ['Meeting the minimum does not guarantee admission.', 'Admission is not guaranteed.', 'There is no guarantee of a place.', 'We cannot guarantee admission, and nobody can.'])
      expect(assessDraft(honest, none, []).reasons, honest).not.toContain('Draft makes a guarantee')
    for (const bad of ['We guarantee admission.', 'Meeting the minimum does not guarantee admission, but we guarantee you a place.', 'Your place is guaranteed.'])
      expect(assessDraft(bad, none, []).level, bad).toBe('high')
  })

  it('lets a list of pathways start alike and ignores citations when judging repetitive openings, but still flags a templated paragraph', async () => {
    const { styleIssues } = await import('@/lib/derek/style')
    const list = ['Entry routes:', '- A bachelor’s degree with a B- average (source: https://x.example/a, X, accessed 2026-11-12)', '- A bachelor’s degree with experience (source: https://x.example/a, X, accessed 2026-11-12)', '- A bachelor’s degree with honours (source: https://x.example/a, X, accessed 2026-11-12)'].join('\n')
    expect(styleIssues(list)).not.toContain('Repetitive sentence openings')
    expect(styleIssues('The course is good. The course is long. The course is hard.')).toContain('Repetitive sentence openings')
  })

  it('allows a longer answer only when it rests on the university’s own pages', async () => {
    const { maxCharsFor, AUTO_REPLY_LIMITS } = await import('@/lib/derek/auto-reply')
    const item = (ref: string): EvidenceItem => ({ ref, text: 't', sourceUrl: 'https://x.example/', publisher: 'x', checkedAt: '2026-11-12' })
    expect(maxCharsFor([item('tuition_fee:1')])).toBe(AUTO_REPLY_LIMITS.maxChars)
    expect(maxCharsFor([item('web:abc:0')])).toBe(AUTO_REPLY_LIMITS.maxCharsResearched)
    expect(AUTO_REPLY_LIMITS.maxCharsResearched).toBeLessThan(4000) // still fits a message
  })
})
