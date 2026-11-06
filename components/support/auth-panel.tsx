'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import type { ProviderId, ProviderStatus } from '@/lib/identity/policy'
import { PRIMARY } from './auth-styles'
import { EmailCodeForm } from './email-code-form'

// The student sign-in page has exactly two methods: an emailed code and Google. Each is shown only when it
// works (mail configured / Google credentials set and the student area open). The same two steps sign an
// existing student in or create a new account when new accounts are open; the server decides, and says
// the same thing either way. `next` is already validated (lib/student/next-path.ts).
export function AuthPanel({
  providers,
  emailCodes,
  signUpOpen,
  oauthError,
  next,
}: {
  providers: ProviderStatus[]
  emailCodes: boolean
  signUpOpen: boolean
  oauthError: string | null
  next: string
}) {
  const [emailOpen, setEmailOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const google = providers.find((p) => p.id === 'google' && p.state === 'available')
  const shownError = error ?? oauthError

  return (
    <div className="flex flex-col gap-5">
      {signUpOpen ? null : (
        <div role="status" className="rounded-xl border border-border bg-background/40 p-4 text-sm leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">New student accounts aren’t open yet.</p>
          <p>If LockIn has already given you a student account, continue below.</p>
        </div>
      )}
      {shownError ? (
        <p role="alert" className="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-foreground">
          {shownError}
        </p>
      ) : null}
      {emailCodes && emailOpen ? (
        <EmailCodeForm next={next} onBack={() => setEmailOpen(false)} />
      ) : (
        <>
          {emailCodes ? (
            <Button type="button" className={PRIMARY} onClick={() => setEmailOpen(true)}>
              Continue with Email
            </Button>
          ) : null}
          {emailCodes && google ? <Divider /> : null}
          {google ? <ProviderContinueButton provider="google" label="Google" next={next} requestSignUp={signUpOpen} onError={setError} /> : null}
          {!emailCodes && !google ? <p className="text-sm text-muted-foreground">Sign-in isn’t available right now. Please try again shortly.</p> : null}
        </>
      )}
    </div>
  )
}

function Divider({ label = 'or' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

/** "Continue with <provider>": redirects to the provider; failures and cancellations come back to /auth?error=… */
export function ProviderContinueButton({
  provider,
  label,
  next,
  requestSignUp,
  note,
  onError,
}: {
  provider: ProviderId
  label: string
  next: string
  requestSignUp: boolean
  note?: string
  onError?: (message: string) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unavailable = `${label} sign-in is unavailable right now. Try again shortly.`
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
        provider,
        callbackURL: next,
        errorCallbackURL: `/auth?${new URLSearchParams({ next })}`,
        requestSignUp,
      })
      if (socialError) fail(socialError.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : unavailable)
    } catch {
      fail(unavailable)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
      >
        {provider === 'google' ? <GoogleMark /> : null}
        {pending ? `Opening ${label}…` : `Continue with ${label}`}
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
