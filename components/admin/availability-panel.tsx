'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// Dev's availability for student chats (lib/support/availability.ts). Three different things, shown as such:
//   - Online/Offline: am I taking chats at all in this login? (starts Offline at every sign-in)
//   - per student: may this student see me online? (every student starts Offline at every sign-in)
//   - "Sees you online": I actually have that student's chat open now, so they see me and Derek holds back.
// The page only displays what the server says; a failed change keeps the last confirmed state.

interface StudentRow {
  studentProfileId: number
  name: string
  visible: boolean
  conversationId: number | null
  lastMessageAt: string | null
  live: boolean
}

interface State {
  available: boolean
  students: StudentRow[]
}

const REFRESH_MS = 15_000

async function call(path: string, body?: unknown): Promise<State | null> {
  try {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.ok ? ((await res.json()) as State) : null
  } catch {
    return null
  }
}

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60',
        on ? 'border-emerald-600 bg-emerald-500' : 'border-border bg-muted',
      )}
    >
      <span aria-hidden="true" className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}

export function AvailabilityPanel() {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    const next = await call('/api/admin/availability')
    if (next) setState(next)
    setError(next ? null : 'Could not load your availability. Students see you offline until it is confirmed.')
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => document.visibilityState !== 'hidden' && load(), REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  async function change(path: string, body: unknown) {
    setBusy(true)
    const next = await call(path, body)
    setBusy(false)
    if (next) {
      setState(next)
      setError(null)
    } else setError('That change was not saved. Nothing changed for students.')
  }

  const shown = (state?.students ?? []).filter((s) => !filter.trim() || s.name.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <section aria-labelledby="availability-title" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="availability-title" className="font-serif text-2xl text-foreground">
            Your availability
          </h2>
          <p className="text-sm text-muted-foreground">
            {state == null
              ? 'Loading…'
              : state.available
                ? 'Online. Students you switch on below see you online only while you have their chat open; everyone else gets Derek.'
                : 'Offline. Derek answers every student. You start Offline at every sign-in.'}
          </p>
        </div>
        <span className="flex items-center gap-3 text-sm font-medium text-foreground">
          {state?.available ? 'Online' : 'Offline'}
          <Switch on={state?.available ?? false} label="Take student chats (Online)" disabled={busy || state == null} onChange={(v) => change('/api/admin/availability', { available: v })} />
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Who may see you online</h3>
          <label className="text-xs text-muted-foreground">
            <span className="sr-only">Filter students</span>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter students" className="min-h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Every student starts Offline at each sign-in. Switching a student on does not show you online by itself: they see you only after you open their chat.</p>
        {state && !shown.length ? <p className="text-sm text-muted-foreground">No students.</p> : null}
        <ul className="flex max-h-[28rem] flex-col divide-y divide-border overflow-y-auto">
          {shown.map((s) => (
            <li key={s.studentProfileId} className="flex items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-foreground">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {s.live ? (
                    <span className="font-medium text-emerald-600">Sees you online now</span>
                  ) : !state?.available ? (
                    'Sees you offline (you are Offline)'
                  ) : s.visible ? (
                    'Eligible: sees you once you open their chat'
                  ) : (
                    'Sees you offline'
                  )}
                  {s.conversationId != null ? (
                    <>
                      {' · '}
                      <Link href={`/admin/inbox/${s.conversationId}`} className="text-primary hover:underline">
                        Open chat
                      </Link>
                    </>
                  ) : null}
                </span>
              </span>
              <Switch on={s.visible} label={`Appear online to ${s.name}`} disabled={busy} onChange={(v) => change('/api/admin/availability/students', { studentProfileId: s.studentProfileId, visible: v })} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
