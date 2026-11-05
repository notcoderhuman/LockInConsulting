'use client'

import { useId, useState, type FormEvent } from 'react'
import { controlClass, Field } from '@/components/admin/form-controls'
import { Button } from '@/components/ui/button'

// Self-service deletion (DPDP Act s.12(3); also how consent is withdrawn, s.6(4)). Calls the same
// audited erasure the Owner uses. What is kept afterwards is listed on /privacy.
export function DeleteAccount() {
  const id = useId()
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (confirm !== 'DELETE') return setError('Type DELETE in capital letters to confirm.')
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/student/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm }) })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) return setError(data.error ?? 'Your account was not deleted. Please try again.')
      window.location.assign('/?account=deleted')
    } catch {
      setError('Check your connection and try again. Nothing was deleted.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
      <p>
        This permanently deletes your student account, your sign-in methods and sessions, and every conversation and message, including Derek’s drafts. It can’t be undone. A record that an
        account was deleted, without your name, email or messages, stays in LockIn’s change log. See the{' '}
        <a href="/privacy#deletion" className="text-primary underline-offset-4 hover:underline">
          privacy notice
        </a>
        .
      </p>
      <Field id={`${id}-confirm`} label="Type DELETE to confirm">
        <input id={`${id}-confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className={`${controlClass} min-h-11`} />
      </Field>
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="destructive" disabled={pending} className="min-h-11 self-start">
        {pending ? 'Deleting…' : 'Delete my account'}
      </Button>
    </form>
  )
}
