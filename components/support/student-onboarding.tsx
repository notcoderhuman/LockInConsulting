'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { controlClass, Field } from '@/components/admin/form-controls'
import { Button } from '@/components/ui/button'

// Shown once, after the first sign-in (emailed code or Google): name, 18+ and consent. The server records them
// on the profile (lib/student/onboarding.ts); nothing here is trusted beyond "the person ticked both".
export function StudentOnboarding({
  name,
  privacyUrl = null,
  ageAttested = false,
}: {
  name: string
  privacyUrl?: string | null
  ageAttested?: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function post(body: Record<string, unknown>) {
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/student/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) return setError(data.error ?? 'Something went wrong. Please try again.')
      router.refresh()
    } catch {
      setError('Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void post({
      action: 'create',
      ageConfirmed: form.get('age') === 'on',
      privacyAccepted: form.get('privacy') === 'on',
      displayName: String(form.get('displayName') ?? ''),
    })
  }

  const input = `${controlClass} min-h-12 rounded-xl`
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <p>One last step before you can ask questions.</p>
      <Field id="onboarding-name" label="Your full name" help="The name the LockIn team will use for you.">
        <input id="onboarding-name" name="displayName" defaultValue={name} autoComplete="name" required maxLength={120} aria-describedby="onboarding-name-help" className={input} />
      </Field>
      {/* Already confirmed on /age-confirm before this account was created (D-045). */}
      {ageAttested ? null : (
        <label className="flex items-start gap-3 text-foreground">
          <input type="checkbox" name="age" required className="mt-1 size-4 accent-[var(--primary)]" />
          <span>I am 18 or older.</span>
        </label>
      )}
      <label className="flex items-start gap-3 text-foreground">
        <input type="checkbox" name="privacy" required className="mt-1 size-4 accent-[var(--primary)]" />
        <span>
          I agree that LockIn uses my name, email address and the messages I send to answer my study-abroad questions. Derek, LockIn’s AI assistant, is not switched on at the
          moment, so my messages are not sent to any AI service; if that changes, LockIn will ask me again first. I can withdraw this consent at any time by deleting my account.
          {privacyUrl ? (
            <>
              {' '}
              <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                Read the full privacy notice<span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </>
          ) : null}
        </span>
      </label>
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Continue'}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => post({ action: 'discard' })}>
          I’m under 18 — remove my sign-in
        </Button>
      </div>
    </form>
  )
}
