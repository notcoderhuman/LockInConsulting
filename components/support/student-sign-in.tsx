'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { controlClass, Field } from '@/components/admin/form-controls'
import { authClient } from '@/lib/auth-client'
import type { ProviderStatus } from '@/lib/identity/policy'

// Sign-in only: there is no student sign-up. Social providers are listed with their honest
// status and cannot be clicked, because none of them is configured or tested.
export function StudentSignIn({ providers }: { providers: ProviderStatus[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const { error: signInError } = await authClient.signIn.email({ email: String(data.get('email') ?? ''), password: String(data.get('password') ?? '') })
      if (signInError) {
        setError(signInError.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : 'That email and password combination was not accepted.')
        return
      }
      router.refresh()
    } catch {
      setError('Sign-in is unavailable right now. Try again shortly.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="student-email" label="Email">
          <input id="student-email" name="email" type="email" autoComplete="username" required className={controlClass} />
        </Field>
        <Field id="student-password" label="Password">
          <input id="student-password" name="password" type="password" autoComplete="current-password" required className={controlClass} />
        </Field>
        {error ? (
          <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <ul className="flex flex-col gap-2" aria-label="Other sign-in options">
        {providers.map((p) => (
          <li key={p.id}>
            <button type="button" disabled aria-describedby={`provider-${p.id}`} className="w-full rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground opacity-70">
              {`Continue with ${p.label} — unavailable`}
            </button>
            <p id={`provider-${p.id}`} className="mt-1 text-xs text-muted-foreground">
              {p.detail}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
