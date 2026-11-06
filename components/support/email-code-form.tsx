'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, type FormEvent } from 'react'
import { Field } from '@/components/admin/form-controls'
import { FIELD, PRIMARY } from './auth-styles'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

// Passwordless email sign-in: an emailed six-digit code (lib/auth.ts emailOTP, limits in lib/auth-otp.ts).
// The same two steps sign an existing student in or, when new accounts are open, create the account; a new
// student then gives their name, 18+ and consent on /chat. The answer to "send" is the same whether or not
// the email has an account, so the form cannot be used to find out who is registered.

type Failure = { status?: number; code?: string } | null | undefined

function message(error: Failure): string {
  if (error?.status === 429) return 'Too many requests. Wait a minute before asking for another code, and try again.'
  if (error?.code === 'OTP_EXPIRED') return 'That code has expired. Ask for a new one.'
  if (error?.code === 'TOO_MANY_ATTEMPTS') return 'Too many wrong codes. Ask for a new one.'
  if (error?.code === 'INVALID_OTP') return 'That code isn’t right, or it has already been used. Check the latest email and try again.'
  if (error?.status === 422 || error?.code === 'FAILED_TO_CREATE_USER') return 'That email can’t be used to sign in right now.'
  return 'That didn’t work. Check your connection and try again.'
}

export function EmailCodeForm({ next, onBack }: { next: string; onBack?: () => void }) {
  const router = useRouter()
  const id = useId()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const address = (sentTo ?? email).trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError('Enter your email address.')
    setPending(true)
    setError(null)
    try {
      const { error: e } = await authClient.emailOtp.sendVerificationOtp({ email: address, type: 'sign-in' })
      if (e) return setError(message(e))
      setSentTo(address)
    } catch {
      setError(message(null))
    } finally {
      setPending(false)
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const otp = String(new FormData(event.currentTarget).get('otp') ?? '').replace(/\s/g, '')
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code from the email.')
    setPending(true)
    setError(null)
    try {
      const { error: e } = await authClient.signIn.emailOtp({ email: sentTo!, otp })
      if (e) return setError(message(e))
      router.replace(next)
      router.refresh()
    } catch {
      setError(message(null))
    } finally {
      setPending(false)
    }
  }

  const alert = error ? (
    <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
      {error}
    </p>
  ) : null

  if (!sentTo)
    return (
      <form onSubmit={send} className="flex flex-col gap-4" noValidate>
        <Field id={`${id}-email`} label="Email">
          <input id={`${id}-email`} type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
        </Field>
        {alert}
        <Button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? 'Sending…' : 'Send code'}
        </Button>
        {onBack ? (
          <button type="button" onClick={onBack} className="min-h-11 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Back
          </button>
        ) : null}
      </form>
    )

  return (
    <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
      <p role="status" className="text-sm leading-relaxed text-muted-foreground">
        If {sentTo} can use a LockIn student account, a 6-digit code is on its way. It works once, for 10 minutes.
      </p>
      <Field id={`${id}-otp`} label="Code from the email">
        <input id={`${id}-otp`} name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus className={`${FIELD} tracking-[0.4em]`} />
      </Field>
      {alert}
      <Button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? 'Checking…' : 'Verify'}
      </Button>
      <div className="flex flex-wrap gap-4 text-sm">
        <button type="button" onClick={() => send()} disabled={pending} className="min-h-11 text-primary underline-offset-4 hover:underline disabled:opacity-60">
          Send a new code
        </button>
        <button
          type="button"
          onClick={() => {
            setSentTo(null)
            setError(null)
          }}
          className="min-h-11 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Use a different email
        </button>
      </div>
    </form>
  )
}
