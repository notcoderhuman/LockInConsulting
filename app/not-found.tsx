import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'

export const metadata: Metadata = {
  title: 'Page not found · LockIn Consulting',
  robots: { index: false },
}

export default function NotFound() {
  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main" className="mx-auto flex min-h-[60dvh] max-w-3xl flex-col items-start justify-center gap-6 px-6 py-24">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">404</p>
        <h1 className="text-balance font-serif text-5xl text-foreground">This page isn&apos;t on the map.</h1>
        <p className="text-pretty leading-relaxed text-muted-foreground">
          The link may be out of date. Start from the destinations list or the homepage.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/destinations"
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground"
          >
            All destinations
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm text-foreground hover:border-primary/50"
          >
            Homepage
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
