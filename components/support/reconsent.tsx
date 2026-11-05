'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DeleteAccount } from './delete-account'

// Shown when LockIn has published a new privacy notice since the student last accepted one. The
// student chooses: accept the new notice, or withdraw consent by deleting the account. Their data
// can still be downloaded from /account either way.
export function Reconsent({ privacyUrl }: { privacyUrl: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (new FormData(event.currentTarget).get('privacy') !== 'on') return setError('Tick the box to accept, or delete your account below.')
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/student/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'consent', privacyAccepted: true }) })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) return setError(data.error ?? 'That didn’t work. Please try again.')
      router.refresh()
    } catch {
      setError('Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <p>
          LockIn has updated how it handles your personal data.{' '}
          <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
            Read the privacy notice<span className="sr-only"> (opens in a new tab)</span>
          </a>{' '}
          before you continue. Your conversations are kept while you decide.
        </p>
        <label className="flex items-start gap-3 text-foreground">
          <input type="checkbox" name="privacy" className="mt-1 size-4 accent-[var(--primary)]" />
          <span>I have read the updated privacy notice and agree to it.</span>
        </label>
        {error ? (
          <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="min-h-11 self-start">
          {pending ? 'Saving…' : 'Accept and continue'}
        </Button>
      </form>
      <details className="rounded-xl border border-border p-4">
        <summary className="min-h-11 cursor-pointer text-foreground">I don’t agree: delete my account</summary>
        <div className="mt-4">
          <DeleteAccount />
        </div>
      </details>
      <p className="text-xs">
        You can also{' '}
        <a href="/api/student/account" download="lockin-my-data.json" className="text-primary underline-offset-2 hover:underline">
          download your data
        </a>{' '}
        first.
      </p>
    </div>
  )
}
