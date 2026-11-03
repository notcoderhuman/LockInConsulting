'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// Live team status for the student chat, read from GET /api/student/presence (server-backed,
// lib/support/presence.ts). Amber while this page is still connecting or the team member's
// connection has just dropped; nothing here is decided in the browser.

interface Presence {
  state: 'online' | 'reconnecting' | 'offline'
  name: string | null
  derekAvailable: boolean
}

const POLL_MS = 30_000

export function presenceText(p: Presence | null): { tone: 'green' | 'amber' | 'grey'; label: string; detail: string | null } {
  if (!p) return { tone: 'amber', label: 'Connecting…', detail: null }
  const who = p.name ?? 'The LockIn team'
  if (p.state === 'online') return { tone: 'green', label: `${who} is online`, detail: null }
  if (p.state === 'reconnecting') return { tone: 'amber', label: `${who} may have disconnected · reconnecting…`, detail: null }
  return {
    tone: 'grey',
    label: `${who} is offline`,
    detail: p.derekAvailable
      ? 'Derek, LockIn’s AI assistant, can answer questions he can answer reliably. The team follows up when back.'
      : 'Leave your question here: the team will reply when they are back.',
  }
}

export function TeamPresence() {
  const [presence, setPresence] = useState<Presence | null>(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/student/presence', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as Presence
        if (!cancelled) setPresence(body)
      } catch {
        if (!cancelled) setPresence(null) // shown as "Connecting…", never as a guess
      }
    }
    void load()
    const timer = setInterval(() => document.visibilityState !== 'hidden' && load(), POLL_MS)
    const onBack = () => void load()
    window.addEventListener('online', onBack)
    document.addEventListener('visibilitychange', onBack)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('online', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [])

  const { tone, label, detail } = presenceText(presence)
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-sm text-foreground">
        <span
          aria-hidden="true"
          className={cn('size-2.5 shrink-0 rounded-full', tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'animate-pulse bg-amber-400' : 'bg-muted-foreground')}
        />
        {label}
      </span>
      {detail ? <span className="text-xs leading-relaxed text-muted-foreground">{detail}</span> : null}
    </div>
  )
}
