'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { authClient } from '@/lib/auth-client'
import { SIGN_IN_REJECTED, SIGN_IN_THROTTLED, SIGN_IN_UNAVAILABLE, signInFieldErrors, type SignInFieldErrors } from '@/lib/identity/sign-in-validation'
import { controlClass, describedBy, Field } from './form-controls'

export function SignInForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<SignInFieldErrors>({})
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    const invalid = signInFieldErrors(email, password, 12)
    setFieldErrors(invalid)
    setError(null)
    if (invalid.email || invalid.password) {
      form.querySelector<HTMLInputElement>(invalid.email ? '#email' : '#password')?.focus()
      return
    }
    setPending(true)
    try {
      const { error: signInError } = await authClient.signIn.email({ email: email.trim(), password })
      if (signInError) {
        // Generic on purpose: never reveal whether an email has an account.
        setError(signInError.status === 429 ? SIGN_IN_THROTTLED : SIGN_IN_REJECTED)
        return
      }
      router.replace('/admin')
      router.refresh()
    } catch {
      setError(SIGN_IN_UNAVAILABLE)
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <Field id="email" label="Email" errors={fieldErrors.email}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={describedBy('email', undefined, fieldErrors.email)}
          className={controlClass}
        />
      </Field>
      <Field id="password" label="Password" errors={fieldErrors.password}>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={12}
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={describedBy('password', undefined, fieldErrors.password)}
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
