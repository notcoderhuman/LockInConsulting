import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { StudentAccount } from '@/components/support/student-account'
import { getIdentityProviderStatus } from '@/lib/identity/policy'
import { getStudentPageContext } from '@/lib/student/access'
import { authPathFor, CHAT_PATH } from '@/lib/student/next-path'

export const metadata: Metadata = {
  title: 'Your account · LockIn Consulting',
  description: 'Your student account: name, sign-in methods and signed-in devices.',
  robots: { index: false, follow: false },
}

// The signed-in student's own account. Every action goes through an endpoint that re-checks the
// session (Better Auth for sessions and sign-in methods, /api/student/profile for the name).
export default async function AccountPage() {
  const ctx = await getStudentPageContext()
  if (ctx.state === 'signed_out') redirect(authPathFor())
  if (ctx.state !== 'ok') redirect(CHAT_PATH)
  const providers = getIdentityProviderStatus().filter((p) => p.state === 'available')

  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main" lang="en" className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-20 pt-10 md:pt-16">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">Student account</p>
          <h1 className="font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground">Your account</h1>
        </div>
        <StudentAccount displayName={ctx.student.displayName} providers={providers.map(({ id, label }) => ({ id, label }))} />
      </main>
      <SiteFooter />
    </>
  )
}
