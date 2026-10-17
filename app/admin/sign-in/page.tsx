import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { GateCard } from '@/components/admin/gate-card'
import { SignInForm } from '@/components/admin/sign-in-form'
import { resolveAdminContext } from '@/lib/admin/access'

export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage() {
  const ctx = await resolveAdminContext(await headers())
  if (ctx.state === 'ok') redirect('/admin')
  if (ctx.state === 'forbidden') redirect('/admin/forbidden')
  if (ctx.state === 'not_configured' || ctx.state === 'error') redirect('/admin/unavailable')

  return (
    <GateCard title="Dev Admin sign in">
      <p className="text-sm leading-relaxed text-muted-foreground">
        For LockIn staff only. Accounts are created by the owner; there is no public sign-up.
      </p>
      <SignInForm />
    </GateCard>
  )
}
