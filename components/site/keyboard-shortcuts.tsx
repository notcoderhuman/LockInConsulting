'use client'

import { Keyboard, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { MessageKey } from '@/lib/i18n'
import { useT } from '@/lib/i18n/client'
import { setShortcutsEnabled, shortcutFor, shortcutsEnabled } from '@/lib/shortcuts'

const SEARCH_INPUT = 'uni-q'
const LIST: { keys: string[]; what: MessageKey }[] = [
  { keys: ['/'], what: 'shortcuts.search' },
  { keys: ['?'], what: 'shortcuts.help' },
  { keys: ['Esc'], what: 'shortcuts.escape' },
  { keys: ['Tab', 'Shift + Tab'], what: 'shortcuts.tab' },
]

/**
 * Site-wide shortcuts plus the "Keyboard shortcuts" button in the footer, which opens the list and the
 * switch to turn single-key shortcuts off (WCAG 2.1.4). Native <dialog>: focus is kept inside it and
 * returns to whatever opened it.
 */
export function KeyboardShortcuts() {
  const router = useRouter()
  const { t } = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const [enabled, setEnabled] = useState(true)
  useEffect(() => setEnabled(shortcutsEnabled()), [])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor(e, e.target)
      if (!action) return
      e.preventDefault()
      if (action === 'help') return dialog.current?.open || dialog.current?.showModal()
      const input = document.getElementById(SEARCH_INPUT) as HTMLInputElement | null
      if (input) {
        input.focus()
        input.select()
      } else router.push('/destinations')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, router])

  function toggle(on: boolean) {
    setEnabled(on)
    setShortcutsEnabled(on)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-primary"
      >
        <Keyboard className="size-4" aria-hidden /> {t('shortcuts.button')}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl shadow-black/60 backdrop:bg-black/70"
      >
        <div className="flex flex-col gap-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="shortcuts-title" className="font-serif text-3xl leading-tight">
              {t('shortcuts.title')}
            </h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border hover:border-primary/60 hover:text-primary"
            >
              <X className="size-4" aria-hidden />
              <span className="sr-only">{t('shortcuts.close')}</span>
            </button>
          </div>
          <dl className="flex flex-col divide-y divide-border">
            {LIST.map((s) => (
              <div key={s.what} className="flex items-center justify-between gap-4 py-3 text-sm">
                <dt className="text-muted-foreground">{t(s.what)}</dt>
                <dd className="flex shrink-0 gap-1.5">
                  {s.keys.map((k) => (
                    <kbd key={k} className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs text-primary">
                      {k}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} className="size-5 accent-[var(--primary)]" />
            {t('shortcuts.toggle')}
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('shortcuts.note')}
          </p>
        </div>
      </dialog>
    </>
  )
}
