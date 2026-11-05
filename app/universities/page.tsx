import type { Metadata } from 'next'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { DeviceListsPanel } from '@/components/universities/device-lists-panel'
import { UniversitySearch } from '@/components/universities/university-search'
import { parseSearch } from '@/lib/data/search'
import { getT } from '@/lib/i18n/server'

export const metadata: Metadata = {
  title: 'Find a university · LockIn Consulting',
  description: 'Search universities across all 11 LockIn destinations, with each entry’s verification status.',
  alternates: { canonical: '/universities' },
  // Search result pages are not content in their own right.
  robots: { index: false, follow: true },
}

export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams
  const { t } = await getT()
  const params = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])))
  // A hand-edited or out-of-date link falls back to a plain search rather than an error.
  const { offset: _offset, ...parsed } = parseSearch(params) ?? { q: '', destination: null, status: null, category: null, sort: 'relevance' as const, offset: 0 }
  // The public page offers no verification filter or status sort, so an old link carrying them is ignored.
  const initial = { ...parsed, status: null, sort: parsed.sort === 'status' ? ('relevance' as const) : parsed.sort }

  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-7xl px-5 pb-20 pt-10 md:px-8 md:pt-14">
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">{t('universities.eyebrow')}</p>
          <h1 className="font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground md:text-6xl">{t('universities.title')}</h1>
          <p className="text-base leading-relaxed text-pretty text-muted-foreground">
            {t('universities.intro')}
          </p>
        </div>
        <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <UniversitySearch initial={initial} focusSearch={raw.focus === 'search'} />
          <DeviceListsPanel />
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
