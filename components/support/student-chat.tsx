'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { controlClass } from '@/components/admin/form-controls'
import { DESTINATIONS } from '@/lib/destinations'
import { lastId, mergeNew, nextDelay, POLL_MS as THREAD_POLL_MS } from '@/lib/support/live'
import { COURSE_MAX, contextSubject, INSTAGRAM_HANDLE } from '@/lib/support/validation'
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

interface Allowance {
  limit: number
  remaining: number
}

interface Pending {
  key: string
  body: string
  /** Set only for a first question, so a retry sends the same context. */
  subject?: string
  state: 'sending' | 'failed'
  error?: string
}

type Load = 'loading' | 'ready' | 'error' | 'unavailable' | 'signed_out'

/** The conversation list (previews, unread counts) is polled more slowly than the open thread (lib/support/live.ts). */
const POLL_MS = 15_000
const MAX = 4000

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

function formatTime(value: string) {
  const d = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

async function api(path: string, init?: { method?: string; body?: unknown }) {
  let res: Response
  try {
    res = await fetch(path, {
      method: init?.method ?? 'GET',
      cache: 'no-store',
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    // Offline or connection dropped: report a failure so the message offers Retry instead of hanging on "Sending…".
    return { status: 0, ok: false, data: {} as Record<string, unknown> }
  }
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
  const [replyPending, setReplyPending] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [allowance, setAllowance] = useState<Allowance | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [draft, setDraft] = useState('')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [destination, setDestination] = useState('')
  const [course, setCourse] = useState('')
  const [instagram, setInstagram] = useState('')
  const [contextError, setContextError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  // What is on screen, for the polling cursor, and whether the reader is at the bottom (so new messages follow them down).
  const messagesRef = useRef<Message[]>([])
  const nearBottom = useRef(true)

  const open = (id: number | null) => {
    window.history.replaceState(null, '', id == null ? '/chat' : `/chat?c=${id}`)
    setSelected(id)
  }

  const loadList = useCallback(async () => {
    const r = await api('/api/student/conversations')
    if (!r.ok) return setListState(stateFor(r.status))
    setList((r.data.conversations as Summary[]) ?? [])
    if (r.data.allowance) setAllowance(r.data.allowance as Allowance)
    setListState('ready')
  }, [])

  // Returns whether the request worked, so the poller can back off. A quiet load asks only for messages newer than
  // the last one shown (?after=<id>); an opening load takes the latest page.
  const loadThread = useCallback(async (id: number, { quiet = false } = {}): Promise<boolean> => {
    if (!quiet) setThreadState('loading')
    const after = quiet ? lastId(messagesRef.current) : 0
    const r = await api(`/api/student/conversations/${id}/messages?limit=${after ? 50 : 30}${after ? `&after=${after}` : ''}`)
    if (!r.ok) {
      if (!quiet) setThreadState(r.status === 404 ? 'error' : stateFor(r.status))
      if (r.status === 401) setListState('signed_out')
      return false
    }
    const conv = r.data.conversation as { subject: string; statusLabel: string; acknowledgement?: string | null; replyPending?: boolean; suggestions?: string[]; allowance?: Allowance }
    setSubject(conv.subject)
    setStatusLabel(conv.statusLabel)
    setAcknowledgement(conv.acknowledgement ?? null)
    setReplyPending(conv.replyPending === true)
    setSuggestions(Array.isArray(conv.suggestions) ? conv.suggestions.slice(0, 3) : [])
    if (conv.allowance) setAllowance(conv.allowance)
    const incoming = r.data.messages as Message[]
    // Never shows a message twice (a send's own reload and a poll can both return it) and keeps id order.
    const fresh = incoming.filter((m) => !messagesRef.current.some((s) => s.id === m.id))
    setMessages((prev) => mergeNew(prev, incoming))
    if (!quiet) setHasMore(Boolean(r.data.hasMore))
    setThreadState('ready')
    if (!quiet || fresh.length) {
      void api(`/api/student/conversations/${id}/read`, { method: 'POST', body: {} })
      if (quiet) void loadList()
    }
    return true
  }, [loadList])

  useEffect(() => {
    void loadList()
    const t = setInterval(() => document.visibilityState !== 'hidden' && loadList(), POLL_MS)
    return () => clearInterval(t)
  }, [loadList])

  useEffect(() => {
    setMessages([])
    messagesRef.current = []
    nearBottom.current = true
    setPending([])
    setAcknowledgement(null)
    setReplyPending(false)
    setSuggestions([])
    if (selected == null) return
    // Live updates: every few seconds while the tab is visible, asking only for newer messages. Pauses while the
    // tab is hidden and checks at once when it returns; doubles the wait after each failure (up to 30 s) and
    // resets after a success; stops when the conversation changes or the component unmounts.
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = THREAD_POLL_MS
    const tick = async () => {
      timer = undefined
      if (stopped || document.visibilityState === 'hidden') return
      const ok = await loadThread(selected, { quiet: true })
      delay = nextDelay(delay, ok)
      if (!stopped) timer = setTimeout(tick, delay)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !timer && !stopped) {
        delay = THREAD_POLL_MS
        void tick()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    void loadThread(selected).then(() => {
      if (!stopped) timer = setTimeout(tick, THREAD_POLL_MS)
    })
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [selected, loadThread])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Scroll the thread itself, never the page (on the homepage the chat sits mid-page): to the newest message when
  // the reader was already at the bottom or sent the message themselves; otherwise leave their place alone.
  useEffect(() => {
    const el = threadRef.current
    if (el && (nearBottom.current || messages.at(-1)?.authorKind === 'student' || pending.length)) el.scrollTop = el.scrollHeight
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
        ? await api('/api/student/conversations', { method: 'POST', body: { subject: item.subject, body: item.body, clientRequestId: item.key } })
        : await api(`/api/student/conversations/${selected}/messages`, { method: 'POST', body: { body: item.body, clientRequestId: item.key } })
    if (r.ok && r.data.saved === true) {
      setPending((p) => p.filter((x) => x.key !== item.key))
      if (selected == null) open(Number(r.data.conversationId))
      else await loadThread(selected, { quiet: true })
      void loadList()
      return
    }
    if (r.status === 401) setListState('signed_out')
    const fieldErrors = r.data.fieldErrors as Record<string, string[]> | undefined
    const error = (fieldErrors?.body ?? fieldErrors?.subject)?.join(' ') ?? (typeof r.data.error === 'string' ? r.data.error : 'Check your connection and try again.')
    setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'failed', error } : x)))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || pending.some((p) => p.state === 'sending')) return
    let subject: string | undefined
    if (selected == null) {
      // Destination and course come before a first question; Instagram stays optional.
      if (!destination || !course.trim()) return setContextError('Choose a destination and enter your course first.')
      if (instagram.trim() && !INSTAGRAM_HANDLE.test(instagram.trim())) return setContextError('That Instagram handle doesn’t look right. Leave it empty if you prefer.')
      subject = contextSubject(destination, course, instagram)
    }
    setContextError(null)
    setDraft('')
    send(body, subject)
  }

  // A typed question and a clicked suggestion go through exactly the same send (idempotency key, Retry, polling).
  function send(body: string, subject?: string) {
    const item: Pending = { key: newKey(), body, subject, state: 'sending' }
    setSuggestions([])
    setPending((p) => [...p, item])
    void deliver(item)
  }

  if (listState === 'signed_out')
    return (
      <Notice title="You have been signed out">
        <a href="/auth?next=%2Fchat" className="text-primary hover:underline">
          Sign in again
        </a>
      </Notice>
    )
  if (listState === 'unavailable') return <Notice title="Support is temporarily unavailable">Nothing you sent before has been lost. Please try again later.</Notice>

  return (
    <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside aria-label="Your conversations" className="flex flex-col gap-3">
        <Button type="button" variant={selected == null ? 'default' : 'outline'} onClick={() => open(null)}>
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
                onClick={() => open(c.id)}
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
            <h2 className="font-serif text-2xl text-foreground">Hello. What would you like to know?</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ask about universities, courses, tuition fees, entry requirements or applications. The LockIn team reads every question; Derek, LockIn’s AI assistant, may prepare a reply, and every reply says who wrote it. Please don’t share passport numbers, bank details or other sensitive documents here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-2xl text-foreground">{subject || 'Conversation'}</h2>
            {statusLabel ? <p className="text-xs text-muted-foreground">{statusLabel}</p> : null}
          </div>
        )}

        <div ref={threadRef} onScroll={(e) => { const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }} tabIndex={0} aria-label="Messages" className="flex max-h-[28rem] flex-1 flex-col gap-3 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring" aria-live="polite">
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
              <li
                key={m.id}
                className={cn(
                  'flex max-w-[85%] flex-col gap-1 rounded-xl px-4 py-3',
                  m.authorKind === 'student' && 'self-end bg-primary/10',
                  m.authorKind === 'derek' && 'self-start border border-dashed border-primary/40 bg-background',
                  m.authorKind === 'staff' && 'self-start border border-border bg-background',
                )}
              >
                <span className={cn('text-xs font-medium', m.authorKind === 'student' ? 'text-muted-foreground' : m.authorKind === 'derek' ? 'text-primary' : 'text-foreground')}>{m.label}</span>
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
          {suggestions.length && !pending.length && threadState === 'ready' && messages.at(-1)?.authorKind === 'derek' ? (
            <div className="flex flex-col gap-2 self-start">
              <span className="text-xs text-muted-foreground">You could also ask:</span>
              <ul className="flex flex-wrap gap-2">
                {suggestions.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onClick={() => send(q)}
                      className="rounded-full border border-primary/40 px-3 py-1.5 text-left text-xs text-foreground hover:border-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {acknowledgement && !pending.length && threadState === 'ready' ? (
            <p role="status" className="self-end text-xs text-muted-foreground">
              {acknowledgement}
            </p>
          ) : null}
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          {selected == null ? (
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-2 text-xs text-muted-foreground">Before your first question, tell us where and what you want to study.</legend>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Destination
                <select required value={destination} onChange={(e) => setDestination(e.target.value)} className={controlClass}>
                  <option value="">Choose…</option>
                  {DESTINATIONS.map((d) => (
                    <option key={d.slug} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Course
                <input required value={course} onChange={(e) => setCourse(e.target.value)} maxLength={COURSE_MAX} placeholder="e.g. MSc Computer Science" className={controlClass} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Instagram (optional)
                <input value={instagram} onChange={(e) => setInstagram(e.target.value)} maxLength={31} placeholder="@yourhandle" autoComplete="off" className={controlClass} />
              </label>
            </fieldset>
          ) : null}
          {contextError ? (
            <p role="alert" className="text-xs text-destructive">
              {contextError}
            </p>
          ) : null}
          <label htmlFor="student-message" className="sr-only">
            Your message
          </label>
          <textarea
            id="student-message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter (or an IME composing) adds a line.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            rows={3}
            maxLength={MAX}
            placeholder={selected == null ? 'Ask about universities, courses, fees or admissions...' : 'Type a reply…'}
            aria-describedby="student-message-hint"
            className={controlClass}
          />
          {allowance ? (
            <p role="status" aria-live="polite" className={cn('text-xs', allowance.remaining === 0 ? 'text-foreground' : 'text-muted-foreground')}>
              {`Derek responses remaining today: ${allowance.remaining}/${allowance.limit}`}
              {allowance.remaining === 0 ? ' · Derek is paused until midnight India time (12:00 am IST). You can keep messaging: Dev and the team still reply.' : ''}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span id="student-message-hint" className="text-xs text-muted-foreground">{`Enter to send, Shift+Enter for a new line · ${draft.length}/${MAX}`}</span>
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
