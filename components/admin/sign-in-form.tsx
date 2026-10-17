'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { controlClass, Field } from './form-controls'

export function SignInForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const { error: signInError } = await authClient.signIn.email({
        email: String(data.get('email') ?? ''),
        password: String(data.get('password') ?? ''),
      })
      if (signInError) {
        // Generic on purpose: never reveal whether an email has an account.
        setError(
          signInError.status === 429
            ? 'Too many attempts. Wait a few minutes and try again.'
            : 'That email and password combination was not accepted.',
        )
        return
      }
      router.replace('/admin')
      router.refresh()
    } catch {
      setError('Sign-in is unavailable right now. Try again shortly.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <Field id="email" label="Email">
        <input id="email" name="email" type="email" autoComplete="username" required className={controlClass} />
      </Field>
      <Field id="password" label="Password">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={12}
          className={controlClass}
        />
      </Field>
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
