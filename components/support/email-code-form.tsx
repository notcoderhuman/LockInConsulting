'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, type FormEvent } from 'react'
import { Field } from '@/components/admin/form-controls'
import { FIELD, PRIMARY } from './auth-styles'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { authClient } from '@/lib/auth-client'

// Emailed one-time code (lib/auth.ts emailOTP, limits in lib/auth-otp.ts).
//   sign-in: signs in an existing student, or creates the account when this browser holds an
//            unspent 18+ confirmation from /age-confirm and sign-up is open (same server-side gate).
//   reset:   sets a new password for a student account (staff never receive a code).
// The answer to "send" is the same whether or not the email has an account.

type Failure = { status?: number; code?: string } | null | undefined

function message(error: Failure): string {
  if (error?.status === 429) return 'Too many requests. Wait a minute before asking for another code, and try again.'
  if (error?.code === 'OTP_EXPIRED') return 'That code has expired. Ask for a new one.'
  if (error?.code === 'TOO_MANY_ATTEMPTS') return 'Too many wrong codes. Ask for a new one.'
  if (error?.code === 'INVALID_OTP') return 'That code isn’t right, or it has already been used. Check the latest email and try again.'
  if (error?.code === 'PASSWORD_TOO_SHORT') return 'Use at least 12 characters for your password.'
  if (error?.status === 422 || error?.code === 'FAILED_TO_CREATE_USER')
    return 'Your account wasn’t created. Start again from Create account and confirm that you’re 18 or older first.'
  return 'That didn’t work. Check your connection and try again.'
}

/** `signUp`: the step after /age-confirm, where the same code verifies the email and creates the account. */
export function EmailCodeForm({ mode, next, onDone, signUp = false }: { mode: 'sign-in' | 'reset'; next: string; onDone?: () => void; signUp?: boolean }) {
  const router = useRouter()
  const id = useId()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const address = (sentTo ?? email).trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError('Enter your email address.')
    setPending(true)
    setError(null)
    try {
      const { error: e } =
        mode === 'reset'
          ? await authClient.emailOtp.requestPasswordReset({ email: address })
          : await authClient.emailOtp.sendVerificationOtp({ email: address, type: 'sign-in' })
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
    const data = new FormData(event.currentTarget)
    const otp = String(data.get('otp') ?? '').replace(/\s/g, '')
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code from the email.')
    setPending(true)
    setError(null)
    try {
      if (mode === 'reset') {
        const { error: e } = await authClient.emailOtp.resetPassword({ email: sentTo!, otp, password: String(data.get('password') ?? '') })
        if (e) return setError(message(e))
        setDone(true)
        onDone?.()
        return
      }
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

  if (done)
    return (
      <p role="status" className="text-sm leading-relaxed text-muted-foreground">
        Your password has been changed and you’ve been signed out everywhere. Sign in with your new password.
      </p>
    )

  if (!sentTo)
    return (
      <form onSubmit={send} className="flex flex-col gap-4" noValidate>
        <Field id={`${id}-email`} label="Email">
          <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
        </Field>
        {alert}
        <Button type="submit" variant={mode === 'reset' || !signUp ? 'outline' : 'default'} disabled={pending} className={PRIMARY}>
          {pending ? 'Sending…' : mode === 'reset' ? 'Email me a reset code' : signUp ? 'Send verification code' : 'Email me a sign-in code'}
        </Button>
      </form>
    )

  return (
    <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
      <p role="status" className="text-sm leading-relaxed text-muted-foreground">
        {signUp ? `We sent a 6-digit code to ${sentTo}.` : `If ${sentTo} can use a LockIn student account, a 6-digit code is on its way.`} It works once, for 10 minutes.
      </p>
      <Field id={`${id}-otp`} label="Code from the email">
        <input id={`${id}-otp`} name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={`${FIELD} tracking-[0.4em]`} />
      </Field>
      {mode === 'reset' ? (
        <Field id={`${id}-password`} label="New password" help="At least 12 characters. Changing it signs you out on every device.">
          <PasswordInput id={`${id}-password`} name="password" autoComplete="new-password" minLength={12} maxLength={128} required aria-describedby={`${id}-password-help`} className={FIELD} />
        </Field>
      ) : null}
      {alert}
      <Button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? 'Checking…' : mode === 'reset' ? 'Set new password' : signUp ? 'Verify email' : 'Sign in'}
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
