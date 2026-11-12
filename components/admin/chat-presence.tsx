'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

// "I am in this chat": while this conversation page is open, it re-claims the chat every 15 s (also in a
// background tab) and releases it when the page closes or navigates away. The server decides whether the student
// now sees you online and Derek holds back (lib/support/availability.ts); this only reports what it said.

type Claim = { state: 'mine'; handling: boolean; available: boolean; visible: boolean } | { state: 'other'; name: string | null }

const HEARTBEAT_MS = 15_000

export function ChatPresence({ conversationId }: { conversationId: number }) {
  const [claim, setClaim] = useState<Claim | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const path = `/api/admin/conversations/${conversationId}/presence`
    let stopped = false
    const beat = async () => {
      try {
        const res = await fetch(path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: '{}' })
        if (stopped) return
        if (!res.ok) throw new Error(String(res.status))
        setClaim((await res.json()) as Claim)
        setFailed(false)
      } catch {
        if (!stopped) setFailed(true)
      }
    }
    const release = () => {
      void fetch(path, { method: 'DELETE', keepalive: true, headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
    }
    void beat()
    const timer = setInterval(beat, HEARTBEAT_MS)
    const onVisible = () => document.visibilityState === 'visible' && beat()
    const onShow = (e: PageTransitionEvent) => e.persisted && beat()
    window.addEventListener('online', beat)
    window.addEventListener('pagehide', release)
    window.addEventListener('pageshow', onShow)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('online', beat)
      window.removeEventListener('pagehide', release)
      window.removeEventListener('pageshow', onShow)
      document.removeEventListener('visibilitychange', onVisible)
      release()
    }
  }, [conversationId])

  let text: string
  let tone = 'text-muted-foreground'
  if (failed) text = 'Connection problem: the student sees you offline and Derek answers until this reconnects.'
  else if (!claim) text = 'Checking your presence…'
  else if (claim.state === 'other') text = `${claim.name ?? 'Another team member'} is handling this chat, so you are not shown to the student.`
  else if (claim.handling) {
    text = 'The student sees you online. Derek is paused for this chat while you are here.'
    tone = 'text-emerald-600'
  } else if (!claim.available) text = 'You are Offline: the student sees you offline and Derek answers.'
  else if (!claim.visible) text = 'This student is switched off for you: they see you offline and Derek answers.'
  else text = 'Connecting…'

  return (
    <p role="status" aria-live="polite" className={`text-sm ${tone}`}>
      {text}{' '}
      {claim?.state === 'mine' && !claim.handling ? (
        <Link href="/admin" className="text-primary hover:underline">
          Change availability
        </Link>
      ) : null}
    </p>
  )
}
