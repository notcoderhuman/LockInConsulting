import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { AgeConfirm } from '@/components/support/age-confirm'
import { getAuth } from '@/lib/auth'
import { googleConfigured, privacyNoticeUrl, studentSignUpOpen } from '@/lib/identity/policy'
import { getStudentPageContext } from '@/lib/student/access'
import { safeNextPath } from '@/lib/student/next-path'

export const metadata: Metadata = {
  title: 'Confirm your age · LockIn Consulting',
  description: 'LockIn Consulting’s student services are for adults aged 18 and above.',
  robots: { index: false, follow: false },
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

// Step one of creating a student account (D-045): an 18+ self-attestation before Google sign-up.
// The page only collects the tick; the server records it and the sign-up callback enforces it.
export default async function AgeConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNextPath(one((await searchParams).next))
  const ctx = await getStudentPageContext()
  if (ctx.state === 'ok' || ctx.state === 'needs_profile') redirect(next)
  const open = ctx.state === 'signed_out' && getAuth() !== null && studentSignUpOpen() && googleConfigured()
  const back = `/auth?${new URLSearchParams({ tab: 'create', next })}`

  return (
    <>
      <SkipLink />
      <SiteHeader />
      {/* Page body not yet translated (Phase D covers the interface shell): marked English for screen readers and browser translation. */}
      <main id="main" lang="en" className="mx-auto flex w-full max-w-lg flex-col gap-8 px-5 pb-20 pt-10 md:pt-16">
        <section aria-labelledby="age-title" className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.2)] md:p-10">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">Create a student account</p>
          <h1 id="age-title" tabIndex={-1} className="mt-3 font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground outline-none md:text-5xl">
            Before you lock in
          </h1>
          {open ? (
            <AgeConfirm next={next} back={back} privacyUrl={privacyNoticeUrl()} />
          ) : (
            <div className="mt-6 flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground">
                {ctx.state === 'forbidden' ? 'Team accounts can’t create a student account.' : 'New student accounts aren’t open yet.'}
              </p>
              <p>If LockIn has already given you an account, you can sign in instead.</p>
              <Link href={back} className="self-start text-primary underline-offset-4 hover:underline">
                Back
              </Link>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
