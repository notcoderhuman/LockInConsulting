'use client'

import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { controlClass } from '@/components/admin/form-controls'
import { Button } from '@/components/ui/button'
import type { ListingSummary } from '@/lib/data/types'
import { SEARCH_PAGE_SIZE, type SearchQuery } from '@/lib/db/search-queries'
import { DESTINATIONS, getDestination, universityHref } from '@/lib/destinations'
import { useT } from '@/lib/i18n/client'
import { cn } from '@/lib/utils'
import { ListingStatus } from './listing-status'
import { SaveButton } from './save-button'

type Filters = Omit<SearchQuery, 'offset'>
type Status = 'loading' | 'ready' | 'error'

// No verification filter or status sort in the public UI (owner decision, 5 Nov 2026: no public verification status).
const SORTS: SearchQuery['sort'][] = ['relevance', 'name', 'name_desc']

function toParams(f: Filters, offset = 0) {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q.trim())
  if (f.destination) p.set('destination', f.destination)
  if (f.category) p.set('category', f.category)
  if (f.sort !== 'relevance') p.set('sort', f.sort)
  if (offset) p.set('offset', String(offset))
  return p
}

// focusSearch: arrived via the "/" shortcut from another page (?focus=search, dropped from the URL on the first search).
export function UniversitySearch({ initial, focusSearch = false }: { initial: Filters; focusSearch?: boolean }) {
  const { t } = useT()
  const [filters, setFilters] = useState(initial)
  const [results, setResults] = useState<ListingSummary[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<Status>('loading')
  const [moreStatus, setMoreStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [attempt, setAttempt] = useState(0)
  // 429 from the shared request limit: said plainly, not as an outage.
  const [limited, setLimited] = useState(false)
  // Phones show the four filters behind a button; wider screens always show them.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const firstNew = useRef<HTMLAnchorElement | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusSearch) input.current?.focus()
  }, [focusSearch])
  const focusIndex = useRef<number | null>(null)

  // Typing waits a moment before searching; changing a filter searches at once. A newer search cancels an older one.
  const query = toParams(filters).toString()
  const typed = useRef(filters.q)
  useEffect(() => {
    const controller = new AbortController()
    const delay = typed.current !== filters.q ? 300 : 0
    typed.current = filters.q
    setStatus('loading')
    const timer = setTimeout(async () => {
      // Keeps the search in the address bar (shareable, survives Back) without a server round trip.
      window.history.replaceState(null, '', query ? `/universities?${query}` : '/universities')
      try {
        const res = await fetch(`/api/universities/search?${query}`, { signal: controller.signal, cache: 'no-store' })
        setLimited(res.status === 429)
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as { results: ListingSummary[]; total: number }
        setResults(data.results)
        setTotal(data.total)
        setStatus('ready')
        setMoreStatus('idle')
      } catch {
        if (!controller.signal.aborted) setStatus('error')
      }
    }, delay)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // `query` covers every filter; `attempt` re-runs a failed search.
  }, [query, attempt, filters.q])

  async function loadMore() {
    setMoreStatus('loading')
    try {
      const res = await fetch(`/api/universities/search?${toParams(filters, results.length)}`, { cache: 'no-store' })
      setLimited(res.status === 429)
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { results: ListingSummary[]; total: number }
      focusIndex.current = results.length
      setResults([...results, ...data.results])
      setTotal(data.total)
      setMoreStatus('idle')
    } catch {
      setMoreStatus('error')
    }
  }

  useEffect(() => {
    if (focusIndex.current !== null && firstNew.current) {
      firstNew.current.focus()
      focusIndex.current = null
    }
  }, [results])

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }))
  const filtered = !!(filters.q.trim() || filters.destination || filters.status || filters.category)
  const activeFilters = [filters.destination, filters.status, filters.category, filters.sort !== 'relevance'].filter(Boolean).length
  const failure = limited ? t('search.limitedLong') : t('search.failed')
  const announcement =
    status === 'loading'
      ? t('search.searching')
      : status === 'error'
        ? limited ? t('search.limitedShort') : t('search.unavailable')
        : total ? (total === 1 ? t('search.count.one') : t('search.count.many', { n: total })) : t('search.noMatch')

  return (
    <div className="flex flex-col gap-8">
      <form role="search" aria-label={t('search.form')} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 md:p-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="uni-q" className="text-sm font-medium text-foreground">
            {t('search.label')}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" aria-hidden />
            <input
              ref={input}
              id="uni-q"
              aria-keyshortcuts="/"
              type="search"
              value={filters.q}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('search.placeholder')}
              onChange={(e) => set('q', e.target.value)}
              className={`${controlClass} min-h-11 pl-9 text-base md:text-sm`}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          aria-controls="uni-filters"
          className="inline-flex min-h-11 items-center justify-between gap-3 rounded-md border border-input px-3 text-sm text-foreground hover:border-primary/60 md:hidden"
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-primary" aria-hidden /> {t('search.filtersButton')}{' '}
            {activeFilters > 0 && <span className="whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">{t('search.activeFilters', { n: activeFilters })}</span>}
          </span>
          <ChevronDown className={cn('size-4 transition-transform', filtersOpen && 'rotate-180')} aria-hidden />
        </button>
        <div id="uni-filters" className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', !filtersOpen && 'max-md:hidden')}>
          <Select id="uni-destination" label={t('search.destination')} value={filters.destination ?? ''} onChange={(v) => set('destination', v || null)}>
            <option value="">{t('search.allDestinations')}</option>
            {DESTINATIONS.map((d) => (
              <option key={d.iso2} value={d.iso2}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select id="uni-category" label={t('search.type')} value={filters.category ?? ''} onChange={(v) => set('category', (v || null) as Filters['category'])}>
            <option value="">{t('search.anyType')}</option>
            <option value="university">{t('search.type.university')}</option>
            <option value="other">{t('search.type.other')}</option>
          </Select>
          <Select id="uni-sort" label={t('search.sort')} value={filters.sort} onChange={(v) => set('sort', v as Filters['sort'])}>
            {SORTS.map((value) => (
              <option key={value} value={value}>
                {t(`search.sort.${value}`)}
                {value === 'relevance' && !filters.q.trim() ? t('search.sort.relevanceHint') : ''}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('search.note')}
        </p>
      </form>

      <div className="flex flex-col gap-4">
        <h2 className="sr-only">{t('search.results')}</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {announcement}
          </p>
          {filtered && (
            <button type="button" onClick={() => setFilters({ q: '', destination: null, status: null, category: null, sort: 'relevance' })} className="min-h-11 text-sm text-primary hover:underline hover:underline-offset-4">
              {t('search.clear')}
            </button>
          )}
        </div>

        {status === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/50 bg-destructive/10 p-5 text-sm text-foreground">
            <p>{failure}</p>
            <Button variant="outline" className="min-h-11 px-5" onClick={() => setAttempt((n) => n + 1)}>
              {t('common.tryAgain')}
            </Button>
          </div>
        ) : status === 'ready' && !results.length ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm leading-relaxed text-muted-foreground">
            <p className="font-serif text-2xl text-foreground">{t('search.noMatch')}</p>
            <p className="mt-2">{t('search.emptyHelp')}</p>
          </div>
        ) : (
          <ul aria-busy={status === 'loading'} className={`flex flex-col gap-3 transition-opacity ${status === 'loading' ? 'opacity-50' : ''}`}>
            {status === 'loading' && !results.length
              ? Array.from({ length: 3 }, (_, i) => <li key={i} aria-hidden className="h-24 animate-pulse rounded-2xl border border-border bg-card" />)
              : results.map((r, i) => {
                  const destination = getDestination(r.destinationIso2)
                  if (!destination) return null
                  return (
                    <li key={`${r.destinationIso2}:${r.slug}`} className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5">
                      <div className="flex min-w-0 flex-col gap-2">
                        <ListingStatus listing={r} />
                        <h3 className="font-serif text-2xl leading-snug text-foreground" translate="no">
                          <Link ref={i === focusIndex.current ? firstNew : undefined} href={universityHref(destination, r.slug)} className="hover:text-primary">
                            {r.name}
                          </Link>
                        </h3>
                        <p className="text-sm text-muted-foreground">{[destination.name, r.city].filter(Boolean).join(' · ')}</p>
                      </div>
                      <SaveButton item={{ destinationIso2: r.destinationIso2, slug: r.slug, name: r.name }} compact />
                    </li>
                  )
                })}
          </ul>
        )}

        {status === 'ready' && results.length < total && (
          <div className="flex flex-col items-center gap-2">
            <Button variant="outline" size="lg" className="min-h-11 px-5" onClick={loadMore} disabled={moreStatus === 'loading'} aria-busy={moreStatus === 'loading'}>
              {moreStatus === 'loading' ? t('common.loading') : moreStatus === 'error' ? t('common.retry') : t('search.showMore', { n: Math.min(SEARCH_PAGE_SIZE, total - results.length) })}
            </Button>
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {moreStatus === 'error' ? (limited ? t('search.limitedRetry') : t('search.moreFailed')) : t('search.showing', { n: results.length, total })}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Select({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${controlClass} min-h-11`}>
        {children}
      </select>
    </div>
  )
}
