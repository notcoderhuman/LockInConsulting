'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { rememberLocale, useT } from '@/lib/i18n/client'

/**
 * One button that offers the other language, labelled in that language ("हिन्दी में देखें" / "View in
 * English") so a reader who cannot read the current one can still find it. The page re-renders on the
 * server in the new language; scroll position and the address stay where they are.
 */
export function LanguageSwitch() {
  const router = useRouter()
  const { locale, t } = useT()
  const [pending, startTransition] = useTransition()
  const next = locale === 'hi' ? 'en' : 'hi'
  const lang = t('language.offerLang')

  return (
    <button
      type="button"
      lang={lang}
      aria-label={t('language.offerLabel')}
      title={t('language.offerLabel')}
      aria-busy={pending}
      onClick={() => {
        rememberLocale(next)
        startTransition(() => router.refresh())
      }}
      className="inline-flex size-[44px] items-center justify-center rounded-full border border-border text-[14px] font-medium text-foreground transition-colors hover:border-primary/60 hover:text-primary aria-busy:opacity-60"
    >
      <span aria-hidden>{t('language.offer')}</span>
    </button>
  )
}
