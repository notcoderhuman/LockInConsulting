import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SignOutButton } from '@/components/admin/sign-out-button'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { StudentChat } from '@/components/support/student-chat'
import { StudentOnboarding } from '@/components/support/student-onboarding'
import { TeamPresence } from '@/components/support/team-presence'
import { privacyNoticeUrl } from '@/lib/identity/policy'
import { getStudentPageContext } from '@/lib/student/access'
import { ageAttestation } from '@/lib/student/age-attestation'
import { authPathFor, CHAT_PATH } from '@/lib/student/next-path'

export const metadata: Metadata = {
  title: 'Chat · LockIn Consulting',
  description: 'Your conversations with the LockIn team.',
  robots: { index: false, follow: false },
}

// The student chat. Every API it calls re-checks the session and conversation ownership on the
// server; this page only decides what to show.
export default async function ChatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).c
  const c = Number(Array.isArray(raw) ? raw[0] : raw)
  const initial = Number.isSafeInteger(c) && c > 0 ? c : null
  const ctx = await getStudentPageContext()
  if (ctx.state === 'signed_out') redirect(authPathFor(initial ? `${CHAT_PATH}?c=${initial}` : CHAT_PATH))
  const attestation = ctx.state === 'needs_profile' ? await ageAttestation(ctx.userId).catch(() => null) : null

  return (
    <>
      <SkipLink />
      <SiteHeader />
      {/* Page body not yet translated (Phase D covers the interface shell): marked English for screen readers and browser translation. */}
      <main id="main" lang="en" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 pb-20 pt-8 md:px-8 md:pt-12">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-2xl flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">Student chat</p>
            <h1 className="font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground md:text-5xl">Ask the LockIn team</h1>
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
              Every reply says who wrote it: a named person from the team, or Derek, LockIn’s AI assistant. No admission, scholarship or visa outcome is ever guaranteed.
            </p>
          </div>
          {ctx.state === 'ok' ? (
            <div className="flex flex-wrap items-center justify-between gap-4 md:flex-col md:items-end">
              <TeamPresence />
              <SignOutButton compact redirectTo="/" />
            </div>
          ) : null}
        </div>

        {ctx.state === 'disabled' ? (
          <Card title="Student accounts aren’t open yet">
            <p>
              We’re finishing an age-eligibility, privacy and legal review before anyone can send us messages here. Until then no information is collected. Every{' '}
              <Link href="/destinations" className="text-primary hover:underline">
                destination page
              </Link>{' '}
              lists official sources in the meantime.
            </p>
          </Card>
        ) : ctx.state === 'error' ? (
          <Card title="Chat is temporarily unavailable">
            <p>Please try again shortly. Nothing you have sent before has been lost.</p>
          </Card>
        ) : ctx.state === 'forbidden' ? (
          <Card title="This account can’t use the student chat">
            <p>
              Team accounts and student accounts are kept separate. Team members use the{' '}
              <Link href="/admin" className="text-primary hover:underline">
                admin panel
              </Link>
              .
            </p>
            <div>
              <SignOutButton compact redirectTo="/auth" />
            </div>
          </Card>
        ) : ctx.state === 'needs_profile' ? (
          <Card title="Finish setting up your account">
            <StudentOnboarding name={attestation?.fullName ?? ctx.name} privacyUrl={privacyNoticeUrl()} ageAttested={attestation !== null} />
          </Card>
        ) : ctx.state === 'ok' ? (
          <StudentChat initialConversationId={initial} />
        ) : null}
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
