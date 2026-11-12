'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// Live team status for the student chat, read from GET /api/student/presence (server-backed,
// lib/support/availability.ts). The server says "online" only while a team member who chose to appear online to
// THIS student has one of their chats open; nothing here is decided in the browser.
//
// When that happens (a new `joinedAt`), the student is told "<name> has joined your chat": in the page, in the tab
// title while the tab is in the background, and, if they allowed it, as one system notification shared by all their
// LockIn tabs (Web Locks + localStorage, and the notification tag). The notification never contains a message.

interface Presence {
  state: 'online' | 'reconnecting' | 'offline'
  name: string | null
  derekAvailable: boolean
  conversationId?: number | null
  joinedAt?: string | null
}

const POLL_MS = 10_000
/** Background tabs keep checking (more slowly) so a waiting student still hears that the team joined. */
const HIDDEN_POLL_MS = 20_000
const SEEN_KEY = 'lockin:team-joined'
const TAG = 'lockin-team-joined'

export function presenceText(p: Presence | null): { tone: 'green' | 'amber' | 'grey'; label: string; detail: string | null } {
  if (!p) return { tone: 'amber', label: 'Connecting…', detail: null }
  const who = p.name ?? 'The LockIn team'
  if (p.state === 'online') return { tone: 'green', label: `${who} is online`, detail: null }
  if (p.state === 'reconnecting') return { tone: 'amber', label: `${who} may have disconnected · reconnecting…`, detail: null }
  return {
    tone: 'grey',
    label: `${p.name ?? 'The LockIn team'} is offline`,
    detail: p.derekAvailable
      ? 'Derek, LockIn’s AI assistant, answers your questions now. The team follows up when back.'
      : 'Leave your question here: the team will reply when they are back.',
  }
}

export const joinedText = (name: string | null) => `${name ?? 'The LockIn team'} has joined your chat.`

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}
const writeSeen = (v: string) => {
  try {
    localStorage.setItem(SEEN_KEY, v)
  } catch {
    // Private mode: the notification tag still collapses duplicates.
  }
}

/** Runs `work` in exactly one tab per join event: the first tab to take the lock and find it unseen. */
export async function onceAcrossTabs(eventId: string, work: () => void): Promise<void> {
  const run = () => {
    if (readSeen() === eventId) return
    writeSeen(eventId)
    work()
  }
  if (typeof navigator !== 'undefined' && navigator.locks?.request) await navigator.locks.request(SEEN_KEY, async () => run())
  else run()
}

function systemNotify(name: string | null, conversationId: number | null) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification('LockIn', { body: joinedText(name), tag: TAG })
    n.onclick = () => {
      window.focus()
      const target = conversationId ? `/chat?c=${conversationId}` : '/chat'
      if (`${location.pathname}${location.search}` !== target) location.assign(target)
      n.close()
    }
  } catch {
    // Some browsers allow notifications only from a service worker: the title and in-page notice remain.
  }
}

export function TeamPresence() {
  const [presence, setPresence] = useState<Presence | null>(null)
  const [joined, setJoined] = useState<{ name: string | null; conversationId: number | null } | null>(null)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const lastJoin = useRef<string | null>(null)
  const baseTitle = useRef<string | null>(null)

  useEffect(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const restoreTitle = () => {
      if (document.visibilityState === 'visible' && document.hasFocus() && baseTitle.current != null) {
        document.title = baseTitle.current
        baseTitle.current = null
      }
    }
    async function load() {
      try {
        const res = await fetch('/api/student/presence', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as Presence
        if (cancelled) return
        setPresence(body)
        if (body.state === 'online' && body.joinedAt && body.joinedAt !== lastJoin.current) {
          lastJoin.current = body.joinedAt
          const who = { name: body.name, conversationId: body.conversationId ?? null }
          setJoined(who)
          // "Looking at it" needs focus too: a visible tab in a window behind another app is not being read.
          if (!(document.visibilityState === 'visible' && document.hasFocus())) {
            if (baseTitle.current == null) baseTitle.current = document.title
            document.title = `● ${joinedText(body.name)}`
            await onceAcrossTabs(body.joinedAt, () => systemNotify(who.name, who.conversationId))
          } else writeSeen(body.joinedAt) // seen here: no other tab notifies for it
        }
        if (body.state !== 'online') setJoined(null)
      } catch {
        if (!cancelled) setPresence(null) // shown as "Connecting…", never as a guess
      }
    }
    const schedule = () => {
      if (cancelled) return
      timer = setTimeout(async () => {
        await load()
        schedule()
      }, document.visibilityState === 'hidden' ? HIDDEN_POLL_MS : POLL_MS)
    }
    void load().then(schedule)
    const onBack = () => {
      restoreTitle()
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('online', onBack)
    window.addEventListener('focus', restoreTitle)
    document.addEventListener('visibilitychange', onBack)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      restoreTitle()
      window.removeEventListener('focus', restoreTitle)
      window.removeEventListener('online', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [])

  async function askPermission() {
    if (typeof Notification === 'undefined') return
    setPermission(await Notification.requestPermission())
  }

  const { tone, label, detail } = presenceText(presence)
  return (
    <div className="flex flex-col gap-1">
      <div role="status" aria-live="polite" className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-sm text-foreground">
          <span
            aria-hidden="true"
            className={cn('size-2.5 shrink-0 rounded-full', tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'animate-pulse bg-amber-400' : 'bg-muted-foreground')}
          />
          {label}
        </span>
        {detail ? <span className="text-xs leading-relaxed text-muted-foreground">{detail}</span> : null}
        {joined ? (
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            {joinedText(joined.name)}
            {joined.conversationId ? (
              <>
                {' '}
                <a href={`/chat?c=${joined.conversationId}`} className="underline underline-offset-2">
                  Open the conversation
                </a>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      {permission === 'default' ? (
        <button type="button" onClick={() => void askPermission()} className="self-start text-xs text-primary hover:underline">
          Notify me when the team joins my chat
        </button>
      ) : null}
    </div>
  )
}
