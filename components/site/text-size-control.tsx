'use client'

import { Type } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/client'
import { applyTextSize, currentTextSize, TEXT_SIZES, type TextSize } from '@/lib/text-size'
import { cn } from '@/lib/utils'

const SAMPLE: Record<TextSize, string> = { standard: 'text-sm', large: 'text-base', larger: 'text-lg' }

/** "Text size" button in the header: a small panel of three sizes. Escape or clicking away closes it. */
export function TextSizeControl() {
  const { t } = useT()
  const LABEL: Record<TextSize, string> = { standard: t('textSize.standard'), large: t('textSize.large'), larger: t('textSize.larger') }
  const [open, setOpen] = useState(false)
  const [size, setSize] = useState<TextSize>('standard')
  const panelId = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => setSize(currentTextSize()), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    const onPointer = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  function choose(next: TextSize) {
    applyTextSize(next)
    setSize(next)
  }

  return (
    <div ref={root} className="relative" onBlur={(e) => !root.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-[44px] items-center justify-center rounded-full border border-border text-foreground transition-colors hover:border-primary/60 hover:text-primary"
      >
        <Type className="size-4" aria-hidden />
        <span className="sr-only">{t('textSize.button', { size: LABEL[size] })}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        role="group"
        aria-label={t('textSize.title')}
        className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-border bg-card p-2 shadow-xl shadow-black/50"
      >
        <p className="px-3 pb-2 pt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground" aria-hidden>
          {t('textSize.title')}
        </p>
        {TEXT_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={size === s}
            onClick={() => choose(s)}
            className={cn(
              'flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-foreground transition-colors hover:bg-primary/10',
              size === s && 'text-primary',
            )}
          >
            <span className={SAMPLE[s]}>{LABEL[s]}</span>
            {size === s && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  )
}
