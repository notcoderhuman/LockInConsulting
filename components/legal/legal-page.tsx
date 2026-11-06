import type { ReactNode } from 'react'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { LEGAL_REVIEWED } from '@/lib/legal/notice'

// Shared layout for /privacy, /terms and /ai. Every page is a DRAFT until the Owner's legal review
// is done (lib/legal/notice.ts LEGAL_REVIEWED, docs/LEGAL-DRAFTS.md); the banner says so and nothing
// here claims compliance.

export function LegalPage({ eyebrow, title, version, children }: { eyebrow: string; title: string; version: string; children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <SiteHeader />
      {/* Legal wording: English only until a reviewed translation is approved. */}
      <main id="main" lang="en" className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 pb-20 pt-10 md:pt-16">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">{eyebrow}</p>
          <h1 className="font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground md:text-5xl">{title}</h1>
          <p className="text-xs text-muted-foreground">Version {version}</p>
        </div>
        {LEGAL_REVIEWED ? null : (
          <div role="note" className="rounded-xl border border-primary/50 bg-primary/10 p-4 text-sm leading-relaxed text-foreground">
            <strong>Draft pending legal review.</strong> This page is not yet in effect and has not been reviewed by a lawyer. It does not claim that LockIn
            Consulting complies with the Digital Personal Data Protection Act, 2023 or any other law. Parts marked “to be completed by the Owner” are still missing.
          </div>
        )}
        <div className="legal-prose flex flex-col gap-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-4 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:text-foreground [&_h3]:font-medium [&_h3]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_strong]:text-foreground [&_table]:w-full [&_td]:border-t [&_td]:border-border [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-3 [&_th]:text-left [&_th]:text-foreground">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  )
}

/** A gap only the Owner can fill. Rendered visibly so a draft can never pass for a finished notice. */
export function OwnerToComplete({ children }: { children: ReactNode }) {
  return <mark className="rounded bg-destructive/15 px-1 text-foreground">[To be completed by the Owner: {children}]</mark>
}

/** A business detail from lib/legal/notice.ts, or the visible gap while the Owner has not filled it in. */
export function Fact({ value, missing }: { value: string | null; missing: string }) {
  return value ? <>{value}</> : <OwnerToComplete>{missing}</OwnerToComplete>
}
