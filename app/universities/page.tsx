import type { Metadata } from 'next'
import { QsDirectory } from '@/components/directory/qs-directory'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { DIRECTORY_DESTINATIONS, QS_ATTRIBUTION } from '@/lib/data/qs-directory'

export const metadata: Metadata = {
  title: 'University directory · LockIn Consulting',
  description: 'Universities in 11 study destinations, in QS World University Rankings 2027 order.',
  alternates: { canonical: '/universities' },
  // The list changes with the destination and search: not content in its own right.
  robots: { index: false, follow: true },
}

export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).d
  const wanted = (Array.isArray(raw) ? raw[0] : raw)?.toUpperCase()
  const initial = DIRECTORY_DESTINATIONS.find((d) => d.iso2 === wanted)?.iso2 ?? DIRECTORY_DESTINATIONS[0].iso2

  return (
    <>
      <SkipLink />
      <SiteHeader />
      {/* Page body not yet translated (Phase D covers the interface shell): marked English for screen readers and browser translation. */}
      <main id="main" lang="en" className="mx-auto max-w-3xl px-5 pb-20 pt-10 md:pt-14">
        <div className="mb-10 flex flex-col gap-4">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">University directory</p>
          <h1 className="font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground md:text-6xl">Find your university</h1>
          <p className="text-base leading-relaxed text-pretty text-muted-foreground">Choose a destination, then search by name. Universities are listed in QS World University Rankings 2027 order.</p>
        </div>
        <QsDirectory destinations={DIRECTORY_DESTINATIONS} initial={initial} attribution={QS_ATTRIBUTION} />
      </main>
      <SiteFooter />
    </>
  )
}
