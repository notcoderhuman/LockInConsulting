'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getDestination } from '@/lib/destinations'
import { cn } from '@/lib/utils'
import type { GlobeControl } from './globe-canvas'
import { GlobeFallback } from './globe-fallback'

const GlobeCanvas = dynamic(() => import('./globe-canvas'), { ssr: false })

type Mode = 'pending' | 'webgl' | 'static'

const DEFAULT_LNG = 40

function subscribeReducedMotion(callback: () => void) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', callback)
  return () => mq.removeEventListener('change', callback)
}

function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  )
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

interface GlobeStageProps {
  selectedIso: string | null
  onSelect: (iso2: string) => void
  className?: string
}

export function GlobeStage({ selectedIso, onSelect, className }: GlobeStageProps) {
  const reducedMotion = useReducedMotion()
  const [webglFailed, setWebglFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [visible, setVisible] = useState(true)
  const [quality, setQuality] = useState<'high' | 'low'>('low')
  const [capable, setCapable] = useState<boolean | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const control = useRef<GlobeControl>({
    rotation: { x: 0.25, y: -0.95 },
    target: null,
    velocity: { x: 0, y: 0 },
    dragging: false,
    hovering: false,
  })

  // Capability check runs after hydration so the server-rendered poster always matches.
  useEffect(() => {
    setCapable(supportsWebGL())
    const wide = window.matchMedia('(min-width: 768px)').matches
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    setQuality(wide && (memory === undefined || memory >= 4) ? 'high' : 'low')
  }, [])

  useEffect(() => {
    const el = container.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '120px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const mode: Mode =
    capable === null ? 'pending' : capable && !reducedMotion && !webglFailed ? 'webgl' : 'static'

  const selected = selectedIso ? getDestination(selectedIso) : undefined
  const handleReady = useCallback(() => setReady(true), [])
  const handleContextLost = useCallback(() => setWebglFailed(true), [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== 'webgl') return
    pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    control.current.dragging = true
    control.current.target = null
    control.current.velocity = { x: 0, y: 0 }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current
    if (!p || p.id !== e.pointerId) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    const k = 0.006
    control.current.rotation.y += dx * k
    control.current.rotation.x += dy * k
    control.current.velocity = { x: dy * k * 0.4, y: dx * k * 0.4 }
  }

  const endDrag = (e: React.PointerEvent) => {
    if (pointer.current?.id !== e.pointerId) return
    pointer.current = null
    control.current.dragging = false
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (mode !== 'webgl') return
    const step = 0.18
    const c = control.current
    const base = c.target ?? { x: c.rotation.x, y: c.rotation.y }
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [0, -step],
      ArrowRight: [0, step],
      ArrowUp: [-step, 0],
      ArrowDown: [step, 0],
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    c.target = { x: base.x + move[0], y: base.y + move[1] }
  }

  const showPoster = mode !== 'webgl' || !ready

  return (
    <div
      ref={container}
      className={cn('relative aspect-square w-full touch-pan-y select-none', className)}
    >
      {showPoster && (
        <div className="absolute inset-[11%] transition-opacity duration-500">
          <GlobeFallback centerLng={selected?.marker.lng ?? DEFAULT_LNG} />
        </div>
      )}

      {mode === 'webgl' && (
        <div
          role="application"
          aria-roledescription="interactive globe"
          aria-label={`Interactive globe${selected ? `, focused on ${selected.name}` : ''}. Drag or use arrow keys to rotate. Choose a destination from the list to focus it.`}
          tabIndex={0}
          className={cn(
            'absolute inset-0 cursor-grab rounded-full transition-opacity duration-700 active:cursor-grabbing',
            ready ? 'opacity-100' : 'opacity-0',
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerEnter={() => (control.current.hovering = true)}
          onPointerLeave={() => (control.current.hovering = false)}
          onKeyDown={onKeyDown}
        >
          <GlobeCanvas
            control={control}
            selectedIso={selectedIso}
            quality={quality}
            active={visible}
            onSelect={onSelect}
            onReady={handleReady}
            onContextLost={handleContextLost}
          />
        </div>
      )}

      {mode === 'webgl' && !ready && (
        <p className="absolute inset-x-0 bottom-2 text-center text-xs text-muted-foreground" role="status">
          Loading globe…
        </p>
      )}
      {mode === 'static' && webglFailed && (
        <p className="absolute inset-x-0 bottom-2 text-center text-xs text-muted-foreground" role="status">
          3D view paused. The destination list still works.
        </p>
      )}
    </div>
  )
}
