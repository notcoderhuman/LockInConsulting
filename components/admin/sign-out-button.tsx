'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try {
      await authClient.signOut()
    } finally {
      router.replace('/admin/sign-in')
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
