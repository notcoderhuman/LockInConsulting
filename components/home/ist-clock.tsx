'use client'

import { useSyncExternalStore } from 'react'
import { PHASE_LABEL, formatIstClock, getIstLighting, previewDate } from '@/lib/ist-lighting'

function subscribeMinute(callback: () => void) {
  const id = window.setInterval(callback, 30_000)
  return () => window.clearInterval(id)
}

let cachedKey = ''
let cachedValue: { clock: string; phase: string } | null = null

function getSnapshot() {
  const now = previewDate()
  const clock = formatIstClock(now)
  const phase = PHASE_LABEL[getIstLighting(now).phase]
  const key = `${clock}|${phase}`
  if (key !== cachedKey) {
    cachedKey = key
    cachedValue = { clock, phase }
  }
  return cachedValue
}

export function IstClock() {
  const value = useSyncExternalStore(subscribeMinute, getSnapshot, () => null)

  return (
    <p className="flex min-h-6 items-center gap-2 text-xs tracking-wide text-muted-foreground">
      <span className="inline-block size-1.5 rounded-full bg-primary" aria-hidden />
      {value ? (
        <span>
          Lit for India · {value.phase} · {value.clock} IST
        </span>
      ) : (
        <span>Lit for India Standard Time</span>
      )}
    </p>
  )
}
