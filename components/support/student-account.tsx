'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { controlClass, Field } from '@/components/admin/form-controls'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { DeleteAccount } from './delete-account'
import type { ProviderId } from '@/lib/identity/policy'

// Student self-service: the name the team sees, sign-in methods (adding one goes through the
// provider, which must confirm the same, verified email), signed-in devices and sign-out.

type Session = { id: string; token: string; createdAt: Date | string; userAgent?: string | null }
const LABELS: Record<string, string> = { credential: 'Email and password', google: 'Google', microsoft: 'Microsoft', apple: 'Apple', yahoo: 'Yahoo' }

const when = (d: Date | string) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
function device(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown system'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${browser} on ${os}`
}

export function StudentAccount({ displayName, providers }: { displayName: string; providers: { id: ProviderId; label: string }[] }) {
  const router = useRouter()
  const id = useId()
  const [name, setName] = useState(displayName)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [methods, setMethods] = useState<string[]>([])
  const [email, setEmail] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const load = useCallback(async () => {
    const [profile, list, mine] = await Promise.all([
      fetch('/api/student/profile', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      authClient.listSessions(),
      authClient.getSession(),
    ])
    if (profile) {
      setMethods(profile.methods)
      setEmail(profile.email)
    }
    setSessions((list.data as Session[] | null) ?? [])
    setCurrent(mine.data?.session.token ?? null)
  }, [])

  useEffect(() => {
    load().catch(() => setStatus({ ok: false, text: 'Your account details couldn’t be loaded. Refresh to try again.' }))
  }, [load])

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setStatus(null)
    try {
      const res = await fetch('/api/student/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'rename', displayName: name }) })
      const data = (await res.json().catch(() => ({}))) as { error?: string; displayName?: string }
      if (!res.ok) return setStatus({ ok: false, text: data.error ?? 'Your name wasn’t saved. Try again.' })
      setName(data.displayName ?? name)
      setStatus({ ok: true, text: 'Saved. The team now sees this name.' })
    } finally {
      setPending(false)
    }
  }

  async function revoke(token: string) {
    const { error } = await authClient.revokeSession({ token })
    setStatus(error ? { ok: false, text: 'That device couldn’t be signed out. Try again.' } : { ok: true, text: 'That device has been signed out.' })
    await load()
  }

  async function revokeOthers() {
    const { error } = await authClient.revokeOtherSessions()
    setStatus(error ? { ok: false, text: 'Other devices couldn’t be signed out. Try again.' } : { ok: true, text: 'Every other device has been signed out.' })
    await load()
  }

  async function signOut() {
    await authClient.signOut()
    router.replace('/')
    router.refresh()
  }

  async function signOutEverywhere() {
    await authClient.revokeSessions()
    router.replace('/')
    router.refresh()
  }

  const unlinked = providers.filter((p) => !methods.includes(p.id))

  return (
    <div className="flex flex-col gap-6">
      {status ? (
        <p role={status.ok ? 'status' : 'alert'} className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
          {status.text}
        </p>
      ) : null}

      <Section title="Your name">
        <form onSubmit={rename} className="flex flex-col gap-4">
          <Field id={`${id}-name`} label="Name the LockIn team sees">
            <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} required className={`${controlClass} min-h-11`} />
          </Field>
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? 'Saving…' : 'Save name'}
          </Button>
        </form>
      </Section>

      <Section title="How you sign in">
        {email ? <p className="text-sm text-muted-foreground">Email: {email}</p> : null}
        <ul className="flex flex-col gap-1 text-sm text-foreground">
          {methods.map((m) => (
            <li key={m}>{LABELS[m] ?? m}</li>
          ))}
          <li className="text-muted-foreground">A code sent to your email, when available</li>
        </ul>
        {unlinked.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-relaxed text-muted-foreground">Add another way to sign in. It must use this same email, and the provider must have verified it.</p>
            {unlinked.map((p) => (
              <Button key={p.id} type="button" variant="outline" className="self-start" onClick={() => authClient.linkSocial({ provider: p.id, callbackURL: '/account' })}>
                {`Add ${p.label}`}
              </Button>
            ))}
          </div>
        ) : null}
      </Section>

      <Section title="Signed-in devices">
        <ul className="flex flex-col divide-y divide-border">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span>
                <span className="text-foreground">{device(s.userAgent)}</span>
                <span className="block text-xs text-muted-foreground">
                  {`Signed in ${when(s.createdAt)}`}
                  {s.token === current ? ' · this device' : ''}
                </span>
              </span>
              {s.token === current ? null : (
                <Button type="button" variant="outline" onClick={() => revoke(s.token)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          {sessions.length > 1 ? (
            <Button type="button" variant="outline" onClick={revokeOthers}>
              Sign out all other devices
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={signOut}>
            Sign out here
          </Button>
          <Button type="button" onClick={signOutEverywhere}>
            Sign out everywhere
          </Button>
        </div>
      </Section>

      <Section title="Your data">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Download everything LockIn holds about you (your account, sign-in methods, devices and every conversation) as a file, and who processes it. See the{' '}
          <a href="/privacy#rights" className="text-primary underline-offset-4 hover:underline">
            privacy notice
          </a>{' '}
          for your other rights.
        </p>
        <a
          href="/api/student/account"
          download="lockin-my-data.json"
          className="inline-flex min-h-11 items-center justify-center self-start rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Download my data
        </a>
      </Section>

      <Section title="Delete your account">
        <DeleteAccount />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-serif text-2xl text-foreground">{title}</h2>
      {children}
    </section>
  )
}

