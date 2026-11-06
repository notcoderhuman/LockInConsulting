import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignOutButton } from '@/components/admin/sign-out-button'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { AuthTabs, type AuthTab } from '@/components/support/auth-tabs'
import { oauthErrorMessage } from '@/lib/identity/oauth-errors'
import { emailOtpOpen, getIdentityProviderStatus, newAccountsAllowed, testerMode } from '@/lib/identity/policy'
import { getStudentPageContext } from '@/lib/student/access'
import { ageTokenFrom, revokeAgeAttestation } from '@/lib/student/age-attestation'
import { safeNextPath } from '@/lib/student/next-path'

export const metadata: Metadata = {
  title: 'Sign in · LockIn Consulting',
  description: 'Sign in or create a student account to chat with the LockIn team.',
  robots: { index: false, follow: false },
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

// Student sign-in and sign-up only. Team members use /admin, which has its own sign-in.
export default async function AuthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const next = safeNextPath(one(params.next))
  // A Google flow that came back cancelled, expired or refused leaves no usable 18+ confirmation (D-045).
  if (one(params.error)) await revokeAgeAttestation(ageTokenFrom((await headers()).get('cookie'))).catch(() => undefined)
  const ctx = await getStudentPageContext()
  // Already signed in (or only the 18+/privacy step left, which /chat shows): go straight to the chat.
  if (ctx.state === 'ok' || ctx.state === 'needs_profile' || ctx.state === 'needs_consent') redirect(next)
  const initialTab: AuthTab = one(params.tab) === 'create' ? 'create' : 'signin'
  // Pre-launch tester mode: the forms appear only at the unlinked /auth?tester=1; everyone else sees the
  // closed notice. The allowlist is still enforced on the server whatever this page shows.
  const tester = one(params.tester) === '1'
  const closed = ctx.state === 'disabled' || (testerMode() && !tester)

  return (
    <>
      <SkipLink />
      <SiteHeader />
      {/* Page body not yet translated (Phase D covers the interface shell): marked English for screen readers and browser translation. */}
      <main id="main" lang="en" className="mx-auto flex w-full max-w-sm flex-col gap-8 px-4 pb-20 pt-12 md:pt-20">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground">Your LockIn account</h1>
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">Ask the team about universities, courses, fees and admissions. Your conversations stay private.</p>
        </div>

        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {closed ? (
            <Notice title="Student accounts aren’t open yet">
              We’re finishing an age-eligibility, privacy and legal review before anyone can sign in and send us questions. Until then no information is collected. Every{' '}
              <Link href="/destinations" className="text-primary hover:underline">
                destination page
              </Link>{' '}
              lists official sources in the meantime.
            </Notice>
          ) : ctx.state === 'error' ? (
            <Notice title="Sign-in is temporarily unavailable">Please try again shortly.</Notice>
          ) : ctx.state === 'forbidden' ? (
            <Notice title="This is a team account">
              Team accounts can’t use the student chat. Use the{' '}
              <Link href="/admin" className="text-primary hover:underline">
                admin panel
              </Link>
              , or sign out and sign in with a student account.
              <span className="mt-3 block">
                <SignOutButton compact redirectTo="/auth" />
              </span>
            </Notice>
          ) : (
            <AuthTabs
              initialTab={initialTab}
              providers={getIdentityProviderStatus()}
              signUpOpen={newAccountsAllowed()}
              tester={tester}
              emailCodes={emailOtpOpen()}
              oauthError={oauthErrorMessage(one(params.error), newAccountsAllowed())}
              next={next}
            />
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl text-foreground">{title}</h2>
      <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}
