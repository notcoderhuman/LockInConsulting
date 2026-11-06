'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useTransition } from 'react'
import { nextDelay, POLL_MS } from '@/lib/support/live'

// Keeps a Live Inbox page current without a manual refresh. Every few seconds, while the tab is visible, it asks
// /api/admin/inbox/pulse for a tiny change token and re-renders the server page only when the token changes, so
// quiet minutes cost almost nothing. What you are typing in a reply box is kept. Pauses while the tab is hidden
// and checks at once when it comes back; backs off after errors and stops on unmount.
export function LiveRefresh({ conversationId, scrollToLatest = false }: { conversationId?: number; scrollToLatest?: boolean }) {
  const router = useRouter()
  const [refreshing, startTransition] = useTransition()
  const stickToBottom = useRef(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = POLL_MS
    let last: string | null = null
    let stopped = false
    const url = `/api/admin/inbox/pulse${conversationId != null ? `?c=${conversationId}` : ''}`

    async function tick() {
      timer = undefined
      if (stopped || document.visibilityState === 'hidden') return
      let ok = false
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const { token } = (await res.json()) as { token?: string }
          ok = typeof token === 'string'
          if (ok && last !== null && token !== last) {
            // Follow the conversation down only if the reader was already at the bottom.
            stickToBottom.current = scrollToLatest && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160
            startTransition(() => router.refresh())
          }
          if (ok) last = token!
        } else if (res.status === 401 || res.status === 403) {
          return // signed out: stop quietly, the next navigation shows the sign-in page
        }
      } catch {
        // offline: back off below
      }
      delay = nextDelay(delay, ok)
      if (!stopped) timer = setTimeout(tick, delay)
    }

    function onVisible() {
      if (document.visibilityState === 'visible' && !timer && !stopped) {
        delay = POLL_MS
        void tick()
      }
    }

    document.addEventListener('visibilitychange', onVisible)
    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [conversationId, scrollToLatest, router])

  useEffect(() => {
    if (!refreshing && stickToBottom.current) {
      stickToBottom.current = false
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
    }
  }, [refreshing])

  return null
}
