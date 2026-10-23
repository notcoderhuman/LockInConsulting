import type { Metadata } from 'next'
import Link from 'next/link'
import { SignOutButton } from '@/components/admin/sign-out-button'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { StudentChat } from '@/components/support/student-chat'
import { StudentSignIn } from '@/components/support/student-sign-in'
import { getIdentityProviderStatus } from '@/lib/identity/policy'
import { getStudentPageContext } from '@/lib/student/access'

export const metadata: Metadata = {
  title: 'Student support · LockIn Consulting',
  description: 'Ask the LockIn team a question.',
  robots: { index: false, follow: false },
}

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getStudentPageContext()
  const raw = (await searchParams).c
  const c = Number(Array.isArray(raw) ? raw[0] : raw)
  const initial = Number.isSafeInteger(c) && c > 0 ? c : null

  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main" className="mx-auto flex max-w-5xl flex-col gap-8 px-5 pb-20 pt-10 md:px-8 md:pt-14">
        <div className="flex max-w-2xl flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">Student support</p>
          <h1 className="font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground md:text-5xl">Ask the LockIn team</h1>
          <p className="text-base leading-relaxed text-pretty text-muted-foreground">
            Replies are always labelled: a named person from the team, or Derek, our AI assistant, either with the team member who reviewed the reply or as an automatic reply that no person reviewed. No admission, scholarship or visa outcome is ever guaranteed.
          </p>
        </div>

        {ctx.state === 'disabled' ? (
          <Card title="Student accounts aren’t open yet">
            <p>
              We’re finishing an age-eligibility, privacy and legal review before anyone can create a student account or send us messages here. Until then this page stays closed, and no
              information is collected.
            </p>
            <p>
              {'In the meantime, every destination page lists '}
              <Link href="/destinations" className="text-primary hover:underline">
                official sources
              </Link>
              .
            </p>
          </Card>
        ) : ctx.state === 'error' ? (
          <Card title="Support is temporarily unavailable">
            <p>Please try again shortly. Nothing you have sent before has been lost.</p>
          </Card>
        ) : ctx.state === 'forbidden' ? (
          <Card title="This account can’t use student support">
            <p>Team accounts and student accounts are kept separate. Sign in with a student account instead.</p>
            <div>
              <SignOutButton compact redirectTo="/support" />
            </div>
          </Card>
        ) : ctx.state === 'signed_out' ? (
          <Card title="Sign in">
            <p>There is no self-service sign-up yet.</p>
            <div className="mt-2 max-w-sm">
              <StudentSignIn providers={getIdentityProviderStatus()} />
            </div>
          </Card>
        ) : (
          <>
            <div className="-mt-4 flex justify-end">
              <SignOutButton compact redirectTo="/support" />
            </div>
            <StudentChat initialConversationId={initial} />
          </>
        )}
      </main>
      <SiteFooter />
    </>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-card p-6 md:p-8">
      <h2 className="font-serif text-2xl text-foreground">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}
