'use client'

import { useEffect, useState } from 'react'
import { ThinkingOrb, type OrbState } from 'thinking-orbs'

// Derek's thinking indicator in the student chat, using the Thinking Orbs component from Libraries.dev (libraries.dev/orbs).
// It mirrors the SERVER's state only: `pending` is the conversation's replyPending (Derek really is generating, or reading
// university pages) and `phase` says which stage. The browser never starts it on its own, so it cannot spin without
// cause; when the server says Derek is done, handed over, failed, or the allowance is used up, it fades out and is
// removed. The wrapper is a polite live region that stays mounted so the wording is announced; the orb itself is hidden
// from assistive technology (the words are the announcement). The library draws a still frame under prefers-reduced-motion
// and stops animating in a background tab.

export type DerekPhase = 'thinking' | 'researching' | 'solving'

/** The orb's own states: writing an answer, reading university pages, a long or multi-part question. */
export const ORB_STATE: Record<DerekPhase, OrbState> = {
  thinking: 'working',
  researching: 'searching',
  solving: 'solving',
}

export const THINKING_TEXT: Record<DerekPhase, string> = {
  thinking: 'Derek is thinking…',
  researching: 'Derek is checking university sources…',
  solving: 'Derek is thinking…',
}

const FADE_MS = 320
/** LockIn gold (--primary), as the orb's ink on the dark chat. */
const GOLD = '#d4b47a'

export function DerekThinking({ pending, phase }: { pending: boolean; phase: DerekPhase | null }) {
  const [shown, setShown] = useState(pending)
  const [leaving, setLeaving] = useState(false)
  const [label, setLabel] = useState<DerekPhase>(phase ?? 'thinking')

  useEffect(() => {
    if (pending) {
      setShown(true)
      setLeaving(false)
      setLabel(phase ?? 'thinking')
      return
    }
    if (!shown) return
    setLeaving(true)
    const t = setTimeout(() => {
      setShown(false)
      setLeaving(false)
    }, FADE_MS)
    return () => clearTimeout(t)
    // `shown` is deliberately not a dependency: only a change of the server's state starts or ends the indicator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, phase])

  return (
    <div role="status" aria-live="polite" className="self-start">
      {shown ? (
        <div className="derek-thinking flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3" data-leaving={leaving ? 'true' : undefined}>
          <ThinkingOrb state={ORB_STATE[label]} size={64} theme="dark" color={GOLD} aria-hidden="true" />
          <span className="text-sm text-muted-foreground">{THINKING_TEXT[label]}</span>
        </div>
      ) : null}
    </div>
  )
}
