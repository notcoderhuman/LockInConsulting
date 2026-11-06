'use client'

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import type { ProviderStatus } from '@/lib/identity/policy'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { StudentSignIn } from './student-sign-in'

export type AuthTab = 'signin' | 'create'

const TABS: { id: AuthTab; label: string }[] = [
  { id: 'signin', label: 'Sign in' },
  { id: 'create', label: 'Create account' },
]

// Two separate flows on one page. Only the active panel is rendered, so the forms never mix.
export function AuthTabs({
  initialTab,
  providers,
  signUpOpen,
  oauthError,
  emailCodes = false,
  next,
}: {
  initialTab: AuthTab
  providers: ProviderStatus[]
  signUpOpen: boolean
  oauthError: string | null
  emailCodes?: boolean
  next: string
}) {
  const [tab, setTab] = useState<AuthTab>(initialTab)
  const base = useId()
  const refs = useRef<Record<AuthTab, HTMLButtonElement | null>>({ signin: null, create: null })
  const methodReady = emailCodes || providers.some((p) => p.state === 'available')

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const other: AuthTab = tab === 'signin' ? 'create' : 'signin'
    setTab(other)
    refs.current[other]?.focus()
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Student account" className="grid grid-cols-2 rounded-xl bg-muted p-1" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el
            }}
            type="button"
            role="tab"
            id={`${base}-${t.id}-tab`}
            aria-selected={tab === t.id}
            // Only the active panel exists, so only its tab may point at it (no dangling reference).
            aria-controls={tab === t.id ? `${base}-${t.id}-panel` : undefined}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={cn(
              'min-h-11 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${base}-${tab}-panel`} aria-labelledby={`${base}-${tab}-tab`}>
        {tab === 'signin' ? (
          <StudentSignIn providers={providers} emailCodes={emailCodes} oauthError={oauthError} next={next} />
        ) : signUpOpen && methodReady ? (
          <div className="flex flex-col gap-5 text-sm leading-relaxed text-muted-foreground">
            <ol className="flex flex-col gap-3">
              {[
                'Confirm you’re 18 or older and tell us your name.',
                emailCodes ? 'Verify your email with a 6-digit code.' : 'Continue with your sign-in provider.',
                emailCodes ? 'Choose a password and accept the privacy notice.' : 'Accept the privacy notice.',
              ].map((step, i) => (
                <li key={step} className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {oauthError ? (
              <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
                {oauthError}
              </p>
            ) : null}
            {/* Sign-up always goes through the 18+ confirmation first (D-045); the server enforces it too. */}
            <Link
              href={`/age-confirm?${new URLSearchParams({ next })}`}
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Create account
            </Link>

          </div>
        ) : (
          <div role="status" className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-4 text-sm leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">New student accounts aren’t open yet.</p>
            <p>We’re finishing an age-eligibility and privacy review before anyone can sign up. If LockIn has already given you an account, use Sign in.</p>
          </div>
        )}
      </div>
    </div>
  )
}
