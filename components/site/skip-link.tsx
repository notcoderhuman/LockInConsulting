'use client'

import { useT } from '@/lib/i18n/client'

export function SkipLink() {
  const { t } = useT()
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
    >
      {t('skip.toContent')}
    </a>
  )
}
