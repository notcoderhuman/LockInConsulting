// Derek's thinking indicator (Thinking Orbs from Libraries.dev): wording, state mapping, accessibility, reduced motion,
// and that it only follows the server's state.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DerekThinking, ORB_STATE, THINKING_TEXT } from '@/components/support/derek-thinking'

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8')

describe('Derek thinking indicator', () => {
  it('shows the library orb with the right wording while the server says Derek is working, and nothing otherwise', () => {
    const thinking = renderToStaticMarkup(<DerekThinking pending phase="thinking" />)
    expect(thinking).toContain('Derek is thinking…')
    expect(thinking).toContain('role="status"')
    expect(thinking).toContain('aria-live="polite"')
    expect(thinking).toMatch(/<canvas[^>]*aria-hidden="true"/) // the orb is a canvas from thinking-orbs; the words are the announcement
    expect(thinking).toMatch(/width:\s*20px/i) // the 20 px inline size
    expect(thinking).toMatch(/height:\s*20px/i)
    expect(thinking).not.toMatch(/rounded-xl|border-border|bg-background|px-4 py-3/) // no separate card around it
    expect(thinking).toMatch(/inline-flex items-center/)
    expect(renderToStaticMarkup(<DerekThinking pending phase="researching" />)).toContain('Derek is checking university sources…')
    expect(renderToStaticMarkup(<DerekThinking pending phase="solving" />)).toContain('Derek is thinking…')
    expect(THINKING_TEXT).toEqual({ thinking: 'Derek is thinking…', researching: 'Derek is checking university sources…', solving: 'Derek is thinking…' })
    // Not working: only the empty live region remains (waiting for Dev, exhausted allowance, failure, handover).
    const idle = renderToStaticMarkup(<DerekThinking pending={false} phase={null} />)
    expect(idle).not.toContain('canvas')
    expect(idle).not.toContain('Derek is')
  })

  it('maps Derek’s real stages onto the orb’s own states', () => {
    expect(ORB_STATE).toEqual({ thinking: 'working', researching: 'searching', solving: 'solving' })
  })

  it('is driven only by the conversation’s server state, never started or kept alive by the browser', () => {
    const chat = read('components/support/student-chat.tsx')
    expect(chat).toMatch(/<DerekThinking pending=\{replyPending && selected != null/)
    expect(chat).toMatch(/setReplyPending\(conv\.replyPending === true\)/)
    expect(chat).toMatch(/setReplyPhase\(conv\.replyPending === true \? \(conv\.replyPhase \?\? 'thinking'\) : null\)/)
    expect(chat).toMatch(/setReplyPending\(false\)\s+setReplyPhase\(null\)/) // switching conversation clears it
    const widget = read('components/support/derek-thinking.tsx')
    expect(widget).toMatch(/from 'thinking-orbs'/)
    expect(widget).not.toMatch(/setInterval|requestAnimationFrame/) // no loop of its own that could spin indefinitely
    expect(widget).not.toMatch(/<svg|canvas\.getContext/) // the orb is the library's, not a custom drawing
  })

  it('uses the published library, and keeps the row’s fade still under prefers-reduced-motion', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['thinking-orbs']).toMatch(/^\^?0\.3\./)
    const css = read('app/globals.css')
    expect(css).not.toMatch(/derek-orb/) // the earlier custom orb is gone
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.derek-thinking[\s\S]*animation: none !important/)
  })
})
