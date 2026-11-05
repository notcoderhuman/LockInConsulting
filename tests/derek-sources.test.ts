// Source references, promises and INR in Derek drafts (lib/derek/safeguards.ts). Pure: no DB, no network.
import { describe, expect, it } from 'vitest'
import { autoReplyContentBlockers } from '@/lib/derek/auto-reply'
import { analyseQuestion } from '@/lib/derek/guidance'
import { DIRECTORY_LABEL, type EvidenceItem } from '@/lib/derek/provider'
import { MockProvider } from '@/lib/derek/providers/mock'
import { assessDraft, assessQuestion } from '@/lib/derek/safeguards'
import { DEREK_INSTRUCTIONS } from '@/lib/derek/provider'

const pub = 'Example University (synthetic)'
const fee: EvidenceItem = { ref: 'tuition_fee:7', text: 'MSc Data tuition fee (international): EUR 15000.00 per year, academic year 2026-2027', publisher: pub, sourceUrl: 'https://uni.example/fees', checkedAt: '2026-10-01' }
const inr: EvidenceItem = { ref: 'tuition_fee:7:inr', text: 'MSc Data tuition fee (international) in Indian rupees: approximately INR 1350000 at EUR 1 = INR 90.00 (rate date 2026-11-04)', publisher: 'Synthetic FX', sourceUrl: 'https://fx.example/eur-inr', checkedAt: '2026-11-04' }
const course: EvidenceItem = { ref: 'course:3', text: 'Example U offers MSc Data; course and admissions page https://uni.example/msc-data', publisher: pub, sourceUrl: 'https://uni.example/courses', checkedAt: '2026-10-01' }
const q = (text: string, evidence: EvidenceItem[]) => assessDraft(text, assessQuestion('What is the fee at Example U?', evidence), evidence)

describe('every sourced fact carries its source', () => {
  it('accepts a fact with its official source, and holds one without', () => {
    const ok = `${DIRECTORY_LABEL}\n- ${fee.text} (official source: ${fee.sourceUrl}, ${pub}, checked 2026-10-01)`
    expect(q(ok, [fee])).toEqual({ level: 'low', reasons: [] })
    const bare = `${DIRECTORY_LABEL}\n- ${fee.text}`
    expect(q(bare, [fee]).reasons).toContain('Directory facts without their official source reference')
    // A figure from evidence outside the directory line still needs a source.
    expect(q('Tuition is EUR 15000.00 per year.', [fee]).level).toBe('uncertain')
    // A source that is not in the evidence does not count.
    expect(q(`${DIRECTORY_LABEL}\n- ${fee.text} (https://elsewhere.example/)`, [fee]).level).not.toBe('low')
  })

  it('the mock (and so the contract) cites URL, publisher and checked date', async () => {
    const evidence = [fee]
    const guidance = analyseQuestion('What is the tuition fee at Example U?', evidence)
    const r = await new MockProvider().generate({ question: 'What is the tuition fee at Example U?', history: [], evidence, instructions: DEREK_INSTRUCTIONS, guidance }, { signal: new AbortController().signal })
    expect(r.text).toContain(`(official source: ${fee.sourceUrl}, ${pub}, checked 2026-10-01)`)
    expect(q(r.text, evidence).level).toBe('low')
  })
})

describe('INR is only ever quoted, never computed', () => {
  it('allows the INR estimate stated in evidence, with its FX source', () => {
    const text = `${DIRECTORY_LABEL}\n- ${fee.text} (official source: ${fee.sourceUrl}, ${pub}, checked 2026-10-01)\n- That is approximately INR 1350000 at EUR 1 = INR 90.00 (official source: ${inr.sourceUrl}, Synthetic FX, checked 2026-11-04)`
    expect(q(text, [fee, inr])).toEqual({ level: 'low', reasons: [] })
  })
  it('flags a conversion when no INR line exists, and an INR figure that differs from evidence', () => {
    expect(q(`Roughly INR 1350000 a year (official source: ${fee.sourceUrl}).`, [fee]).reasons).toContain('Draft converts to INR')
    expect(q(`About INR 1400000 a year (official source: ${inr.sourceUrl}).`, [fee, inr]).level).toBe('high')
  })
})

describe('no promises of admission, scholarships or visas', () => {
  it.each([
    'Your scholarship is guaranteed if you apply early.',
    'It is easy to get admission there.',
    'You will surely receive a scholarship.',
    'You’ll qualify for the scholarship with these marks.',
  ])('flags "%s"', (text) => {
    expect(assessDraft(text, { level: 'low', reasons: [] }, []).level).toBe('high')
  })
})

describe('comparisons and links', () => {
  it('asks for facts per university when the evidence covers several', () => {
    const two: EvidenceItem[] = [
      { ...course, ref: 'university:1', text: 'Alpha University, official website https://alpha.example/' },
      { ...course, ref: 'university:2', text: 'Beta University, official website https://beta.example/' },
      fee,
    ]
    const g = analyseQuestion('Compare the tuition fees at Alpha University and Beta University', two)
    expect(g.kind).toBe('specific_fact')
    expect(g.note).toMatch(/compares 2 universities.*Never fill a gap/)
  })
  it('lets an unreviewed reply link the official course page named in evidence, nothing else', () => {
    expect(autoReplyContentBlockers('Apply on the course page: https://uni.example/msc-data.', [course])).toEqual([])
    expect(autoReplyContentBlockers('See https://made-up.example/apply', [course])).toContain('Contains a link that is not from verified evidence')
  })
})
