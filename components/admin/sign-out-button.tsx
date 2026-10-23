'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export function SignOutButton({ compact = false, redirectTo = '/admin/sign-in' }: { compact?: boolean; redirectTo?: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try {
      await authClient.signOut()
    } finally {
      router.replace(redirectTo)
      router.refresh()
    }
  }

  return (
    <Button type="button" variant="outline" size={compact ? 'sm' : 'default'} onClick={signOut} disabled={pending}>
      <LogOut aria-hidden="true" />
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
