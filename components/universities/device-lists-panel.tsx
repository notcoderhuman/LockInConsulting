'use client'

import { X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ListingSummary } from '@/lib/data/types'
import { clearList, removeItem, renameItem, storageAvailable, useDeviceList, type DeviceItem, type DeviceList } from '@/lib/device-lists'
import { getDestination, universityHref } from '@/lib/destinations'
import { useT } from '@/lib/i18n/client'
import { ListingStatus } from './listing-status'

const key = (i: Pick<DeviceItem, 'destinationIso2' | 'slug'>) => `${i.destinationIso2}:${i.slug}`
type Lookup = { state: 'loading' } | { state: 'ready'; found: Map<string, ListingSummary> } | { state: 'error' }

/**
 * Saved and recently viewed universities from this browser, each checked against the public directory:
 * an entry that is no longer listed (removed, hidden or under review) says so and has no link; when the
 * check fails, the stored name is shown with that caveat. Only public keys are sent; nothing is stored.
 */
export function DeviceListsPanel() {
  const { t } = useT()
  const saved = useDeviceList('saved')
  const recent = useDeviceList('recent')
  const [blocked, setBlocked] = useState(false)
  const [lookup, setLookup] = useState<Lookup>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => setBlocked(!storageAvailable()), [])

  const keys = [...new Set([...saved, ...recent].map(key))].sort().join(',')
  useEffect(() => {
    if (!keys) return setLookup({ state: 'ready', found: new Map() })
    const controller = new AbortController()
    setLookup({ state: 'loading' })
    const params = new URLSearchParams(keys.split(',').map((k) => ['u', k]))
    fetch(`/api/universities/lookup?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const { results } = (await res.json()) as { results: ListingSummary[] }
        setLookup({ state: 'ready', found: new Map(results.map((r) => [key(r), r])) })
        // A renamed university keeps its place in both lists under its current name.
        for (const r of results) for (const list of ['saved', 'recent'] as const) renameItem(list, r, r.name)
      })
      .catch(() => !controller.signal.aborted && setLookup({ state: 'error' }))
    return () => controller.abort()
  }, [keys, attempt])

  return (
    <aside aria-label={t('device.label')} className="flex flex-col gap-8">
      {blocked && (
        <p role="note" className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
          {t('device.blocked')}
        </p>
      )}
      <ListSection list="saved" title={t('device.savedTitle')} items={saved} lookup={lookup} empty={t('device.savedEmpty')} />
      <ListSection list="recent" title={t('device.recentTitle')} items={recent} lookup={lookup} empty={t('device.recentEmpty')} />
      {lookup.state === 'error' && (
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="min-h-11 self-start text-sm text-primary hover:underline hover:underline-offset-4">
          {t('device.recheck')}
        </button>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('device.privacy')}
      </p>
    </aside>
  )
}

function ListSection({ list, title, items, lookup, empty }: { list: DeviceList; title: string; items: DeviceItem[]; lookup: Lookup; empty: string }) {
  const { t } = useT()
  const [confirming, setConfirming] = useState(false)
  const headingId = `device-${list}`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-xs font-medium uppercase tracking-[0.28em] text-primary">
          {title} {items.length > 0 && <span className="text-muted-foreground">({items.length})</span>}
        </h2>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (!confirming) return setConfirming(true)
              clearList(list)
              setConfirming(false)
            }}
            onBlur={() => setConfirming(false)}
            className="min-h-11 text-xs text-muted-foreground hover:text-primary"
          >
            {confirming ? t('device.confirmClear') : t('device.clearAll')}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul aria-busy={lookup.state === 'loading'} className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
          {items.map((item) => (
            <Row key={key(item)} list={list} item={item} lookup={lookup} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({ list, item, lookup }: { list: DeviceList; item: DeviceItem; lookup: Lookup }) {
  const { t } = useT()
  const destination = getDestination(item.destinationIso2)
  const current = lookup.state === 'ready' ? lookup.found.get(key(item)) : undefined
  const gone = lookup.state === 'ready' && !current
  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {current && <ListingStatus listing={current} />}
        {destination && !gone ? (
          <Link href={universityHref(destination, item.slug)} translate="no" className="font-serif text-lg leading-snug text-foreground hover:text-primary">
            {current?.name ?? item.name}
          </Link>
        ) : (
          <span translate="no" className="font-serif text-lg leading-snug text-muted-foreground">{item.name}</span>
        )}
        <p className="text-xs text-muted-foreground">
          {gone
            ? t('device.gone')
            : lookup.state === 'loading'
              ? t('device.checking')
              : lookup.state === 'error'
                ? `${destination?.name ?? ''} · ${t('device.checkFailed')}`
                : [destination?.name, current?.city].filter(Boolean).join(' · ')}
        </p>
      </div>
      <button
        type="button"
        onClick={() => removeItem(list, item)}
        aria-label={t(list === 'saved' ? 'device.removeSaved' : 'device.removeRecent', { name: item.name })}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-primary"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  )
}
