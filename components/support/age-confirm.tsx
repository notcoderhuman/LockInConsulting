'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { controlClass, Field } from '@/components/admin/form-controls'
import { Button } from '@/components/ui/button'
import type { ProviderStatus } from '@/lib/identity/policy'
import { EmailCodeForm } from './email-code-form'
import { ProviderContinueButton } from './student-sign-in'

// The 18+ self-attestation (D-045). Ticking the box only enables the button: the server records the
// confirmation and sets a short-lived HttpOnly token, and account creation (any method) refuses to
// create an account without it. Only the person's name and the tick are collected, nothing else about their age.
export function AgeConfirm({ next, back, privacyUrl, providers = [], emailCodes = false }: { next: string; back: string; privacyUrl: string | null; providers?: ProviderStatus[]; emailCodes?: boolean }) {
  const router = useRouter()
  const id = useId()
  const [fullName, setFullName] = useState('')
  const [checked, setChecked] = useState(false)
  const [step, setStep] = useState<'confirm' | 'continue'>('confirm')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  // The server decides what counts as a name; this only stops an obviously empty submit.
  const ready = checked && fullName.trim().length >= 2
  // Keyboard and screen-reader users land on the next step once it has rendered.
  useEffect(() => {
    if (step === 'continue') stepHeading.current?.focus()
  }, [step])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/student/age-confirmation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName, ageConfirmed: true }) })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) return setError(data.error ?? 'Something went wrong. Please try again.')
      setStep('continue')
    } catch {
      setError('Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  async function goBack() {
    // Cancelling withdraws any confirmation already recorded, so it cannot be reused.
    await fetch('/api/student/age-confirmation', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined)
    router.push(back)
  }

  const privacyLink = privacyUrl ? (
    <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
      privacy notice<span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : null

  if (step === 'continue')
    return (
      <div className="mt-6 flex flex-col gap-5 text-sm leading-relaxed text-muted-foreground">
        <h2 ref={stepHeading} tabIndex={-1} className="font-serif text-2xl text-foreground outline-none">
          Thank you. Next, your sign-in.
        </h2>
        <p>
          Create your account with {emailCodes ? 'a code sent to your email' : 'one of the options below'}. Afterwards you’ll be asked to accept how LockIn handles your data
          {privacyLink ? <> (read the {privacyLink})</> : null} before you can start chatting. Your confirmation is valid for 15 minutes and can be used once.
        </p>
        {emailCodes ? <EmailCodeForm mode="sign-in" next={next} signUp /> : null}
        {providers
          .filter((p) => p.state === 'available')
          .map((p) => (
            <ProviderContinueButton key={p.id} provider={p.id} label={p.label} next={next} requestSignUp note={`LockIn never gets your ${p.label} password.`} />
          ))}
        <button type="button" onClick={goBack} className="min-h-11 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Back
        </button>
      </div>
    )

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-3 text-base leading-relaxed text-muted-foreground">
        <p>LockIn Consulting’s student services are intended for adults aged 18 and above.</p>
        <p>Please confirm that you are at least 18 years old before continuing to create a student account.</p>
      </div>

      <Field id={`${id}-name`} label="Your full name" help="The name the LockIn team will use for you.">
        <input
          id={`${id}-name`}
          name="fullName"
          type="text"
          autoComplete="name"
          required
          maxLength={120}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={`${controlClass} min-h-11`}
        />
      </Field>

      <label
        htmlFor={`${id}-age`}
        className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/40 p-4 text-foreground transition-colors has-[:checked]:border-primary/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60"
      >
        <input
          id={`${id}-age`}
          type="checkbox"
          name="age"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          aria-describedby={`${id}-note`}
          className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
        />
        <span>I confirm that I am 18 years of age or older.</span>
      </label>

      <p id={`${id}-note`} className="text-xs leading-relaxed text-muted-foreground">
        This is your own confirmation. LockIn doesn’t check your age or identity, and doesn’t ask for your date of birth. If you’re under 18,
        please don’t create an account.{privacyLink ? <> See our {privacyLink}.</> : null}
      </p>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      ) : null}

      {/* Same order on screen and for the keyboard: the primary action first. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" size="lg" className="min-h-11" disabled={!ready || pending}>
          {pending ? 'Saving…' : 'Confirm and continue'}
        </Button>
        <Button type="button" variant="outline" size="lg" className="min-h-11" onClick={goBack}>
          Back
        </Button>
      </div>
    </form>
  )
}
