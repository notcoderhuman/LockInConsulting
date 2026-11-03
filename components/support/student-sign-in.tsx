'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { controlClass, describedBy, Field } from '@/components/admin/form-controls'
import { PasswordInput } from '@/components/ui/password-input'
import { authClient } from '@/lib/auth-client'
import type { ProviderStatus } from '@/lib/identity/policy'
import { useT } from '@/lib/i18n/client'
import { signInFieldErrors, type SignInFieldErrors } from '@/lib/identity/sign-in-validation'
import { CHAT_PATH } from '@/lib/student/next-path'

// Student sign-in: email and password for provisioned accounts, and Google when it is configured
// (lib/auth.ts). Sign in never creates an account: new accounts start at /age-confirm (D-045). Other providers are
// listed with their honest status and cannot be clicked. `next` is already validated
// (lib/student/next-path.ts): after signing in the student goes there, never anywhere else.

export function StudentSignIn({ providers, oauthError = null, next = CHAT_PATH }: { providers: ProviderStatus[]; oauthError?: string | null; next?: string }) {
  const router = useRouter()
  const { t, lang } = useT()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<SignInFieldErrors>({})
  const [pending, setPending] = useState(false)
  const google = providers.find((p) => p.id === 'google' && p.state === 'available')
  const others = providers.filter((p) => p !== google)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '')
    const password = String(data.get('password') ?? '')
    const invalid = signInFieldErrors(email, password, 0, t)
    setFieldErrors(invalid)
    setError(null)
    if (invalid.email || invalid.password) {
      form.querySelector<HTMLInputElement>(invalid.email ? '#student-email' : '#student-password')?.focus()
      return
    }
    setPending(true)
    try {
      const { error: signInError } = await authClient.signIn.email({ email: email.trim(), password })
      if (signInError) {
        setError(signInError.status === 429 ? t('signIn.throttled') : t('signIn.rejected'))
        return
      }
      router.replace(next)
      router.refresh()
    } catch {
      setError(t('signIn.unavailable'))
    } finally {
      setPending(false)
    }
  }

  const shownError = error ?? oauthError

  return (
    <div className="flex flex-col gap-6">
      {google ? (
        <GoogleContinueButton next={next} requestSignUp={false} note="For existing student accounts. LockIn never gets your Google password." onError={setError} />
      ) : null}
      {shownError ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          {shownError}
        </p>
      ) : null}
      {google ? (
        <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      <form lang={lang} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="student-email" label={t('signIn.email')} errors={fieldErrors.email}>
          <input
            id="student-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={describedBy('student-email', undefined, fieldErrors.email)}
            className={controlClass}
          />
        </Field>
        <Field id="student-password" label={t('signIn.password')} errors={fieldErrors.password}>
          <PasswordInput
            id="student-password"
            name="password"
            autoComplete="current-password"
            required
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={describedBy('student-password', undefined, fieldErrors.password)}
            className={controlClass}
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? t('signIn.pending') : t('signIn.submit')}
        </Button>
        {/* No self-service reset: email flows are disabled (lib/auth-options.mjs). */}
        <p className="text-xs leading-relaxed text-muted-foreground">{t('signIn.forgot')}</p>
      </form>
      <ul className="flex flex-col gap-2" aria-label="Other sign-in options">
        {others.map((p) => (
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

/** "Continue with Google": redirects to Google; failures and cancellations come back to /auth?error=… */
export function GoogleContinueButton({ next, requestSignUp, note, onError }: { next: string; requestSignUp: boolean; note?: string; onError?: (message: string) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fail = (message: string) => {
    setPending(false)
    if (onError) onError(message)
    else setError(message)
  }

  async function go() {
    setPending(true)
    setError(null)
    try {
      const { error: socialError } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: next,
        errorCallbackURL: `/auth?${new URLSearchParams({ next })}`,
        requestSignUp,
      })
      if (socialError) fail(socialError.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : 'Google sign-in is unavailable right now. Try again shortly.')
    } catch {
      fail('Google sign-in is unavailable right now. Try again shortly.')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="inline-flex min-h-11 w-full items-center justify-center gap-3 rounded-lg border border-primary/50 bg-background px-4 text-sm font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
      >
        <GoogleMark />
        {pending ? 'Opening Google…' : 'Continue with Google'}
      </button>
      {note ? <p className="text-xs leading-relaxed text-muted-foreground">{note}</p> : null}
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Google's "G" mark, as Google's sign-in branding guidelines ask for on a "Continue with Google" button. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5 shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  )
}
