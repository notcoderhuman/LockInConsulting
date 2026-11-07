'use client'

import { BadgeCheck, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// The public university directory: eleven destinations, search by name, universities in QS global order.
// A card carries exactly three things: the name, the QS rank as printed (#4, =45, 731-740, 1401+) and,
// only when LockIn itself has verified the university, a "Verified" badge. The QS attribution sits below the
// list, never on a card. All data comes from /api/qs-directory, which returns nothing until the QS licence
// is recorded as executed (then the page says the directory is being prepared).

interface Card {
  name: string
  rank: string
  verified: boolean
}

interface Page {
  cards: Card[]
  total: number
  published: boolean
}

type Load = 'loading' | 'ready' | 'error'

export function QsDirectory({
  destinations,
  initial,
  attribution,
}: {
  destinations: { iso2: string; name: string }[]
  initial: string
  attribution: { text: string; url: string }
}) {
  const [iso2, setIso2] = useState(initial)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [total, setTotal] = useState(0)
  const [published, setPublished] = useState(true)
  const [state, setState] = useState<Load>('loading')
  const [more, setMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const fetchPage = useCallback(async (offset: number): Promise<Page | null | undefined> => {
    controller.current?.abort()
    const ctl = new AbortController()
    controller.current = ctl
    try {
      const res = await fetch(`/api/qs-directory?${new URLSearchParams({ d: iso2, q: debounced, offset: String(offset) })}`, { signal: ctl.signal, cache: 'no-store' })
      return res.ok ? ((await res.json()) as Page) : null
    } catch {
      // A newer request replaced this one: say nothing, the newer one reports.
      return ctl.signal.aborted ? undefined : null
    }
  }, [iso2, debounced])

  const reload = useCallback(async () => {
    setState('loading')
    const page = await fetchPage(0)
    if (page === undefined) return
    if (page === null) return setState('error')
    setCards(page.cards)
    setTotal(page.total)
    setPublished(page.published)
    setState('ready')
  }, [fetchPage])

  useEffect(() => {
    void reload()
    return () => controller.current?.abort()
  }, [reload])

  async function showMore() {
    setMore(true)
    setMoreError(false)
    const page = await fetchPage(cards.length)
    setMore(false)
    if (page) setCards((prev) => [...prev, ...page.cards])
    else if (page === null) setMoreError(true)
  }

  function choose(next: string) {
    setIso2(next)
    window.history.replaceState(null, '', `/universities?d=${next.toLowerCase()}`)
  }

  const current = destinations.find((d) => d.iso2 === iso2)?.name ?? ''

  return (
    <div className="flex flex-col gap-8">
      <div role="group" aria-label="Destination" className="flex flex-wrap gap-2">
        {destinations.map((d) => (
          <button
            key={d.iso2}
            type="button"
            onClick={() => choose(d.iso2)}
            aria-pressed={d.iso2 === iso2}
            className={cn(
              'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              d.iso2 === iso2 ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground',
            )}
          >
            {d.name}
          </button>
        ))}
      </div>

      <label className="relative block">
        <span className="sr-only">Search universities in {current}</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={80}
          placeholder={`Search universities in ${current}`}
          className="min-h-12 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </label>

      <section aria-label={`Universities in ${current}`} aria-busy={state === 'loading'} className="flex flex-col gap-3">
        {state === 'loading' ? (
          <ul aria-label="Loading universities" className="flex flex-col gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="h-16 animate-pulse rounded-2xl border border-border bg-card/60" />
            ))}
          </ul>
        ) : state === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6">
            <p className="text-foreground">The directory could not be loaded.</p>
            <button type="button" onClick={() => void reload()} className="min-h-11 rounded-xl border border-primary px-4 text-sm font-medium text-primary hover:bg-primary/10">
              Try again
            </button>
          </div>
        ) : !published ? (
          <p role="status" className="rounded-2xl border border-border bg-card p-6 text-muted-foreground">
            The university directory is being prepared and will appear here soon.
          </p>
        ) : cards.length === 0 ? (
          <p role="status" className="rounded-2xl border border-border bg-card p-6 text-muted-foreground">
            {debounced ? `No universities in ${current} match “${debounced}”.` : `There are no universities to show for ${current} yet.`}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {debounced ? `${total} ${total === 1 ? 'match' : 'matches'}` : `${total} ${total === 1 ? 'university' : 'universities'}`} in {current}, in QS World University Rankings 2027 order
            </p>
            <ol className="flex flex-col gap-3">
              {cards.map((c, i) => (
                <li key={`${c.rank}-${c.name}-${i}`} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-5 py-4">
                  <span className="font-serif text-xl leading-snug text-foreground">{c.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-primary">
                    <span>{c.rank}</span>
                    {c.verified ? (
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden="true">·</span>
                        <BadgeCheck aria-hidden="true" className="size-4" />
                        <span>Verified</span>
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
            {moreError ? (
              <p role="alert" className="text-center text-sm text-foreground">
                More universities could not be loaded. Try again.
              </p>
            ) : null}
            {cards.length < total ? (
              <button
                type="button"
                onClick={() => void showMore()}
                disabled={more}
                className="min-h-12 self-center rounded-xl border border-border px-6 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60"
              >
                {more ? 'Loading…' : 'Show more'}
              </button>
            ) : null}
          </>
        )}
      </section>

      {published && state === 'ready' ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <a href={attribution.url} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:text-foreground hover:underline">
            {attribution.text}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      ) : null}
    </div>
  )
}
