// How Derek's answers are shown to students (components/support/message-body.tsx) and the clean-up that keeps internal
// wording away from them (lib/derek/style.ts studentFacingText).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { friendlyLink, MessageBody, parseBlocks } from '@/components/support/message-body'
import { studentFacingText } from '@/lib/derek/style'

const html = (text: string) => renderToStaticMarkup(<MessageBody text={text} />)

describe('message rendering', () => {
  it('keeps paragraphs apart, renders bold, bullet lists and numbered steps', () => {
    const out = html('First paragraph with **a key term**.\n\nSecond paragraph.\nSame paragraph, next line.\n\n- one\n- two\n\n1. apply online\n2. upload documents')
    expect(out.match(/<p>/g)).toHaveLength(2)
    expect(out).toContain('<strong class="font-semibold">a key term</strong>')
    expect(out).toContain('<br/>') // a line break inside a paragraph survives
    expect(out).toMatch(/<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/)
    expect(out).toMatch(/<ol[^>]*><li>apply online<\/li><li>upload documents<\/li><\/ol>/)
    expect(parseBlocks('Intro:\n- a\n- b\nAfter.').map((b) => b.kind)).toEqual(['p', 'ul', 'p'])
  })

  it('shows source links as clean, descriptive, safe links', () => {
    const out = html('Start with the [Massey Master of Information Sciences page](https://www.massey.ac.nz/study/all-qualifications-and-degrees/master-of-information-sciences-PMINS/) and see https://www.massey.ac.nz/study/all-qualifications-and-degrees/master-of-information-sciences-PMINS/.')
    expect(out).toContain('>Massey Master of Information Sciences page<')
    // A bare address becomes a readable label, never the long raw URL as text.
    expect(out).toContain('massey.ac.nz: Master of information sciences')
    expect(out).not.toMatch(/>https?:\/\//)
    expect(out.match(/<a /g)).toHaveLength(2)
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).toContain('(opens in a new tab)')
    expect(friendlyLink('https://www.massey.ac.nz/about/university-calendar-and-regulations/qualification-regulations/master-of-information-sciences/')).toBe('massey.ac.nz: Master of information sciences regulations')
    expect(friendlyLink('https://www.example.edu/')).toBe('example.edu')
    expect(friendlyLink('https://www.example.edu/fees-and-funding/tuition-fees-ABC12/')).toBe('example.edu: Tuition fees')
  })

  it('never makes unsafe links or markup', () => {
    const out = html('[click](javascript:alert(1)) <script>alert(1)</script> [x](data:text/html,hi) <b>bold</b>')
    expect(out).not.toContain('<a ')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toContain('<b>')
  })

  it('keeps a long answer scannable: many short blocks rather than one dense block', () => {
    const long = ['Intro sentence for the answer.', '', ...Array.from({ length: 6 }, (_, i) => `Paragraph ${i} explaining one idea clearly.`).flatMap((p) => [p, '']), '- list item', '- another item', '', 'Closing next step.'].join('\n')
    const blocks = parseBlocks(long)
    expect(blocks.length).toBeGreaterThanOrEqual(8)
    expect(html(long)).toContain('gap-2.5') // consistent spacing between blocks
  })
})

describe('what a student never sees', () => {
  it('turns internal labels, evidence tags and citation brackets into plain Markdown', () => {
    const raw = [
      'The programme is open to international students.',
      '',
      'Not yet checked by LockIn (unverified):',
      '- UNVERIFIED, not yet checked by LockIn: from the web page "Entry requirements": Applicants need a B average. (source: https://www.example.edu/entry/, Example University, accessed 2026-11-12)',
      '- Massey University, Palmerston North, official website https://www.massey.ac.nz [university:74] (official source: https://www.massey.ac.nz/, Massey University, checked 2026-11-05)',
      '',
      'From the LockIn directory:',
      '- Example University is listed [draft_course:59].',
    ].join('\n')
    const out = studentFacingText(raw)
    expect(out).not.toMatch(/Not yet checked by LockIn|UNVERIFIED|From the LockIn directory|\(source:|\(official source:|accessed 20|checked 20|\[university:|\[draft_course:|from the web page/i)
    expect(out).toContain('Applicants need a B average. ([Example University](https://www.example.edu/entry/))')
    expect(out).toContain('([Massey University](https://www.massey.ac.nz/))')
    expect(out).toContain('The programme is open to international students.')
    // Already natural text is left alone, and the clean-up never empties an answer.
    const natural = 'Massey’s [Master of Information Sciences page](https://www.massey.ac.nz/x/) lists three routes in.'
    expect(studentFacingText(natural)).toBe(natural)
    expect(studentFacingText('From the LockIn directory:')).toBe('From the LockIn directory:')
  })
})
