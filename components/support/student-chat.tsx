'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { controlClass } from '@/components/admin/form-controls'
import { cn } from '@/lib/utils'

// The student's view of their own conversations. All identity comes from the session cookie on
// the server; this component never sends a student id. A message is shown as sent only after the
// server confirms it was saved (`saved: true`); until then it is "Sending…", and on failure it
// keeps its text and idempotency key so "Retry" can never create a duplicate.

interface Summary {
  id: number
  subject: string
  statusLabel: string
  lastMessageAt: string
  unread: number
}

interface Message {
  id: number
  authorKind: 'student' | 'staff' | 'derek'
  label: string
  body: string
  createdAt: string
}

interface Pending {
  key: string
  body: string
  state: 'sending' | 'failed'
  error?: string
}

type Load = 'loading' | 'ready' | 'error' | 'unavailable' | 'signed_out'

const POLL_MS = 15_000
const MAX = 4000

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

function formatTime(value: string) {
  const d = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

async function api(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    cache: 'no-store',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  let data: Record<string, unknown> = {}
  try {
    data = await res.json()
  } catch {
    // Non-JSON error page: treat as a failure below.
  }
  return { status: res.status, ok: res.ok, data }
}

function stateFor(status: number): Load {
  if (status === 401) return 'signed_out'
  if (status === 503) return 'unavailable'
  return 'error'
}

export function StudentChat({ initialConversationId }: { initialConversationId: number | null }) {
  const [list, setList] = useState<Summary[]>([])
  const [listState, setListState] = useState<Load>('loading')
  const [selected, setSelected] = useState<number | null>(initialConversationId)
  const [messages, setMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [threadState, setThreadState] = useState<Load>('ready')
  const [subject, setSubject] = useState('')
  const [statusLabel, setStatusLabel] = useState('')
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [draft, setDraft] = useState('')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadList = useCallback(async () => {
    const r = await api('/api/student/conversations')
    if (!r.ok) return setListState(stateFor(r.status))
    setList((r.data.conversations as Summary[]) ?? [])
    setListState('ready')
  }, [])

  const loadThread = useCallback(async (id: number, { quiet = false } = {}) => {
    if (!quiet) setThreadState('loading')
    const r = await api(`/api/student/conversations/${id}/messages?limit=30`)
    if (!r.ok) {
      if (!quiet) setThreadState(r.status === 404 ? 'error' : stateFor(r.status))
      return
    }
    const conv = r.data.conversation as { subject: string; statusLabel: string; acknowledgement?: string | null }
    setSubject(conv.subject)
    setStatusLabel(conv.statusLabel)
    setAcknowledgement(conv.acknowledgement ?? null)
    setMessages((prev) => {
      const latest = r.data.messages as Message[]
      // Keep older pages the student already loaded.
      const oldest = latest[0]?.id ?? Infinity
      return [...prev.filter((m) => m.id < oldest), ...latest]
    })
    if (!quiet) setHasMore(Boolean(r.data.hasMore))
    setThreadState('ready')
    void api(`/api/student/conversations/${id}/read`, { method: 'POST', body: {} })
  }, [])

  useEffect(() => {
    void loadList()
    const t = setInterval(() => document.visibilityState !== 'hidden' && loadList(), POLL_MS)
    return () => clearInterval(t)
  }, [loadList])

  useEffect(() => {
    setMessages([])
    setPending([])
    setAcknowledgement(null)
    if (selected == null) return
    void loadThread(selected)
    const t = setInterval(() => document.visibilityState !== 'hidden' && loadThread(selected, { quiet: true }), POLL_MS)
    return () => clearInterval(t)
  }, [selected, loadThread])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, pending.length])

  async function loadOlder() {
    if (selected == null || !messages.length) return
    setLoadingOlder(true)
    const r = await api(`/api/student/conversations/${selected}/messages?limit=30&before=${messages[0].id}`)
    setLoadingOlder(false)
    if (!r.ok) return
    setMessages((prev) => [...(r.data.messages as Message[]), ...prev])
    setHasMore(Boolean(r.data.hasMore))
  }

  async function deliver(item: Pending) {
    setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'sending', error: undefined } : x)))
    const r =
      selected == null
        ? await api('/api/student/conversations', { method: 'POST', body: { body: item.body, clientRequestId: item.key } })
        : await api(`/api/student/conversations/${selected}/messages`, { method: 'POST', body: { body: item.body, clientRequestId: item.key } })
    if (r.ok && r.data.saved === true) {
      setPending((p) => p.filter((x) => x.key !== item.key))
      if (selected == null) {
        const id = Number(r.data.conversationId)
        window.history.replaceState(null, '', `/support?c=${id}`)
        setSelected(id)
      } else await loadThread(selected, { quiet: true })
      void loadList()
      return
    }
    if (r.status === 401) setListState('signed_out')
    const fieldErrors = r.data.fieldErrors as Record<string, string[]> | undefined
    const error = fieldErrors?.body?.join(' ') ?? (typeof r.data.error === 'string' ? r.data.error : 'Not sent. Check your connection and try again.')
    setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'failed', error } : x)))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || pending.some((p) => p.state === 'sending')) return
    const item: Pending = { key: newKey(), body, state: 'sending' }
    setPending((p) => [...p, item])
    setDraft('')
    void deliver(item)
  }

  if (listState === 'signed_out')
    return (
      <Notice title="You have been signed out">
        <a href="/support" className="text-primary hover:underline">
          Sign in again
        </a>
      </Notice>
    )
  if (listState === 'unavailable') return <Notice title="Support is temporarily unavailable">Nothing you sent before has been lost. Please try again later.</Notice>

  return (
    <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside aria-label="Your conversations" className="flex flex-col gap-3">
        <Button type="button" variant={selected == null ? 'default' : 'outline'} onClick={() => (window.history.replaceState(null, '', '/support'), setSelected(null))}>
          New question
        </Button>
        {listState === 'loading' ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {listState === 'error' ? (
          <p className="text-sm text-muted-foreground">
            {'Your conversations could not be loaded. '}
            <button type="button" onClick={() => loadList()} className="text-primary hover:underline">
              Retry
            </button>
          </p>
        ) : null}
        {listState === 'ready' && !list.length ? <p className="text-sm text-muted-foreground">No conversations yet.</p> : null}
        <ul className="flex flex-col gap-1">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => (window.history.replaceState(null, '', `/support?c=${c.id}`), setSelected(c.id))}
                aria-current={selected === c.id ? 'true' : undefined}
                className={cn('flex w-full flex-col rounded-md px-3 py-2 text-left text-sm', selected === c.id ? 'bg-card text-primary' : 'text-foreground hover:bg-card/60')}
              >
                <span className="flex items-center gap-2">
                  <span className={cn('truncate', c.unread > 0 && 'font-semibold')}>{c.subject}</span>
                  {c.unread > 0 ? <span className="ml-auto rounded-full bg-primary px-1.5 text-[0.7rem] font-semibold text-primary-foreground">{c.unread}<span className="sr-only"> unread</span></span> : null}
                </span>
                <span className="text-xs text-muted-foreground">{c.statusLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section aria-label={selected == null ? 'New question' : subject || 'Conversation'} className="flex min-h-[24rem] flex-col gap-4 rounded-2xl border border-border bg-card p-4 md:p-6">
        {selected == null ? (
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-2xl text-foreground">Ask the LockIn team</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ask about universities, courses, admissions or studying abroad. The LockIn team reads your questions; Derek, LockIn’s AI assistant, may answer some of them, and his replies are always labelled. Please don’t share passport numbers, bank details or other sensitive documents here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-2xl text-foreground">{subject || 'Conversation'}</h2>
            {statusLabel ? <p className="text-xs text-muted-foreground">{statusLabel}</p> : null}
          </div>
        )}

        <div className="flex flex-1 flex-col gap-3" aria-live="polite">
          {threadState === 'loading' ? <p className="text-sm text-muted-foreground">Loading messages…</p> : null}
          {threadState === 'error' ? (
            <p className="text-sm text-muted-foreground">
              {'This conversation could not be loaded. '}
              {selected != null ? (
                <button type="button" onClick={() => loadThread(selected)} className="text-primary hover:underline">
                  Retry
                </button>
              ) : null}
            </p>
          ) : null}
          {hasMore ? (
            <button type="button" onClick={loadOlder} disabled={loadingOlder} className="self-center text-sm text-primary hover:underline disabled:opacity-60">
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          ) : null}
          {selected != null && threadState === 'ready' && !messages.length && !pending.length ? <p className="text-sm text-muted-foreground">No messages yet.</p> : null}
          <ol className="flex flex-col gap-3">
            {messages.map((m) => (
              <li key={m.id} className={cn('flex max-w-[85%] flex-col gap-1 rounded-xl px-4 py-3', m.authorKind === 'student' ? 'self-end bg-primary/10' : 'self-start border border-border bg-background')}>
                <span className={cn('text-xs font-medium', m.authorKind === 'student' ? 'text-muted-foreground' : 'text-primary')}>{m.label}</span>
                <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">{m.body}</p>
                <time className="text-[0.7rem] text-muted-foreground">{formatTime(m.createdAt)}</time>
              </li>
            ))}
            {pending.map((p) => (
              <li key={p.key} className="flex max-w-[85%] flex-col gap-1 self-end rounded-xl border border-dashed border-border px-4 py-3">
                <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">{p.body}</p>
                {p.state === 'sending' ? (
                  <span className="text-[0.7rem] text-muted-foreground">Sending…</span>
                ) : (
                  <span role="alert" className="flex flex-wrap items-center gap-2 text-[0.7rem] text-destructive">
                    {`Not sent. ${p.error ?? ''}`}
                    <button type="button" onClick={() => deliver(p)} className="font-medium text-primary hover:underline">
                      Retry
                    </button>
                    <button type="button" onClick={() => (setPending((x) => x.filter((y) => y.key !== p.key)), setDraft(p.body))} className="text-muted-foreground hover:underline">
                      Edit
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {acknowledgement && !pending.length && threadState === 'ready' ? (
            <p role="status" className="self-end text-xs text-muted-foreground">
              {acknowledgement}
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <label htmlFor="student-message" className="sr-only">
            Your message
          </label>
          <textarea
            id="student-message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={MAX}
            placeholder={selected == null ? 'Type your question…' : 'Type a reply…'}
            className={controlClass}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{`${draft.length}/${MAX}`}</span>
            <Button type="submit" disabled={!draft.trim() || pending.some((p) => p.state === 'sending')}>
              Send
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-serif text-2xl text-foreground">{title}</h2>
      <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}
