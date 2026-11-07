import type { Metadata } from 'next'
import Link from 'next/link'
import { FaqSearch } from '@/components/faq/faq-search'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { FAQ_ENTRIES } from '@/lib/content/faq'
import { getT } from '@/lib/i18n/server'

export function generateMetadata(): Metadata {
  return {
    title: 'Questions and answers · LockIn Consulting',
    description: 'Answers to common questions about studying abroad with LockIn Consulting, reviewed by our team.',
    alternates: { canonical: '/faq' },
    // An empty page is not worth indexing.
    robots: FAQ_ENTRIES.length ? undefined : { index: false, follow: true },
  }
}

export default async function FaqPage() {
  const { t } = await getT()
  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl px-5 pb-20 pt-10 md:px-8 md:pt-14">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">{t('faq.eyebrow')}</p>
          <h1 className="font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground md:text-6xl">{t('faq.title')}</h1>
        </div>
        <div className="mt-10">
          {FAQ_ENTRIES.length ? (
            <FaqSearch entries={FAQ_ENTRIES} />
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm leading-relaxed text-muted-foreground md:p-8">
              <p className="font-serif text-2xl text-foreground">{t('faq.emptyTitle')}</p>
              <p className="mt-2">
                {t('faq.emptyBefore')}{' '}
                <Link href="/destinations" className="text-primary underline-offset-4 hover:underline">
                  {t('faq.emptyLink')}
                </Link>{' '}
                {t('faq.emptyAfter')}
              </p>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
