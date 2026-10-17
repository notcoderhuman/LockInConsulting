import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { GateCard } from '@/components/admin/gate-card'
import { SignOutButton } from '@/components/admin/sign-out-button'
import { resolveAdminContext } from '@/lib/admin/access'

export const metadata: Metadata = { title: 'No access' }

export default async function ForbiddenPage() {
  const ctx = await resolveAdminContext(await headers())
  const signedIn = ctx.state === 'ok' || ctx.state === 'forbidden'
  return (
    <GateCard title="You don't have access to this">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {ctx.state === 'forbidden'
          ? `${ctx.email} is signed in but has no active admin membership. Ask the owner to grant access.`
          : ctx.state === 'ok'
            ? 'Your role does not include this section. Ask the owner if you need it.'
            : 'Sign in with an admin account to continue.'}
      </p>
      <div className="flex flex-wrap gap-3">
        {ctx.state === 'ok' ? (
          <Link href="/admin" className="text-sm text-primary hover:underline">
            Back to the dashboard
          </Link>
        ) : null}
        {signedIn ? (
          <SignOutButton />
        ) : (
          <Link href="/admin/sign-in" className="text-sm text-primary hover:underline">
            Sign in
          </Link>
        )}
      </div>
    </GateCard>
  )
}
