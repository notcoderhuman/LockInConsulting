// Derek's thinking indicator: wording, accessibility, reduced motion, and that it only follows the server's state.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DerekThinking, THINKING_TEXT } from '@/components/support/derek-thinking'

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8')

describe('Derek thinking indicator', () => {
  it('shows the orb with the right wording while the server says Derek is working, and nothing otherwise', () => {
    const thinking = renderToStaticMarkup(<DerekThinking pending phase="thinking" />)
    expect(thinking).toContain('Derek is thinking…')
    expect(thinking).toContain('role="status"')
    expect(thinking).toContain('aria-live="polite"')
    expect(thinking).toContain('derek-orb')
    expect(thinking).toMatch(/class="derek-orb"[^>]*aria-hidden="true"/) // the picture is decoration; the words are the announcement
    expect(renderToStaticMarkup(<DerekThinking pending phase="researching" />)).toContain('Derek is checking university sources…')
    expect(THINKING_TEXT).toEqual({ thinking: 'Derek is thinking…', researching: 'Derek is checking university sources…' })
    // Not working: only the empty live region remains, so there is no orb and no words (waiting for Dev, exhausted allowance, failure).
    const idle = renderToStaticMarkup(<DerekThinking pending={false} phase={null} />)
    expect(idle).not.toContain('derek-orb')
    expect(idle).not.toContain('Derek is')
  })

  it('is driven only by the conversation’s server state, never started or kept alive by the browser', () => {
    const chat = read('components/support/student-chat.tsx')
    expect(chat).toMatch(/<DerekThinking pending=\{replyPending && selected != null/)
    expect(chat).toMatch(/setReplyPending\(conv\.replyPending === true\)/)
    expect(chat).toMatch(/setReplyPhase\(conv\.replyPending === true \? \(conv\.replyPhase \?\? 'thinking'\) : null\)/)
    expect(chat).toMatch(/setReplyPending\(false\)\s+setReplyPhase\(null\)/) // switching conversation clears it
    const widget = read('components/support/derek-thinking.tsx')
    expect(widget).not.toMatch(/setInterval|setTimeout\([^)]*,\s*\d{4,}/) // no timer of its own that could spin indefinitely
    expect(widget).not.toMatch(/reasoning|chain of thought/i)
  })

  it('is CSS and SVG only and stops moving under prefers-reduced-motion', () => {
    const css = read('app/globals.css')
    for (const rule of ['derek-orb-glow', 'derek-orb-spin', 'derek-thinking-in', 'derek-thinking-out']) expect(css).toContain(`@keyframes ${rule}`)
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.derek-orb-ring-a[\s\S]*animation: none !important/)
    expect(css).toMatch(/var\(--primary\)/) // the existing gold, not a new palette
  })
})
