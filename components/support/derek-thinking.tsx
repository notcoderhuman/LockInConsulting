'use client'

import { useEffect, useState } from 'react'

// Derek's thinking indicator in the student chat. It mirrors the SERVER's state only: `pending` is the conversation's
// replyPending (Derek really is generating, or reading university pages) and `phase` says which. It is never started
// by the browser on its own, so it cannot spin without cause; when the server says Derek is done, handed over, failed,
// or the allowance is used up, it fades out and is removed. The wrapper is a polite live region that stays mounted so
// the change of wording is announced; the animation is CSS/SVG only and stops under prefers-reduced-motion.

export type DerekPhase = 'thinking' | 'researching'

export const THINKING_TEXT: Record<DerekPhase, string> = {
  thinking: 'Derek is thinking…',
  researching: 'Derek is checking university sources…',
}

const FADE_MS = 320

export function DerekOrb({ leaving = false }: { leaving?: boolean }) {
  return (
    <span className="derek-orb" data-leaving={leaving ? 'true' : undefined} aria-hidden="true">
      <svg viewBox="0 0 64 64" className="derek-orb-svg" focusable="false">
        <defs>
          <radialGradient id="derek-orb-core" cx="38%" cy="34%" r="70%">
            <stop offset="0%" stopColor="#fff3d6" />
            <stop offset="38%" stopColor="#e6c98e" />
            <stop offset="78%" stopColor="#a8823f" />
            <stop offset="100%" stopColor="#3a2c14" />
          </radialGradient>
          <linearGradient id="derek-orb-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f3dca6" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#d4b47a" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#d4b47a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle className="derek-orb-halo" cx="32" cy="32" r="26" fill="#d4b47a" />
        <g className="derek-orb-ring-a">
          <circle cx="32" cy="32" r="29" fill="none" stroke="url(#derek-orb-ring)" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="70 112" />
        </g>
        <g className="derek-orb-ring-b">
          <circle cx="32" cy="32" r="24.5" fill="none" stroke="url(#derek-orb-ring)" strokeWidth="1" strokeLinecap="round" strokeDasharray="44 110" />
        </g>
        <circle className="derek-orb-core" cx="32" cy="32" r="15" fill="url(#derek-orb-core)" />
      </svg>
    </span>
  )
}

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
          <DerekOrb leaving={leaving} />
          <span className="text-sm text-muted-foreground">{THINKING_TEXT[label]}</span>
        </div>
      ) : null}
    </div>
  )
}
