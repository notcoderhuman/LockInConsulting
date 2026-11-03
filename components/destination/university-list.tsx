'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DirectoryEntry } from '@/lib/data/types'
import { getDestination, universityHref } from '@/lib/destinations'
import { ProvisionalCard } from './provisional-card'
import { UniversityCard } from './university-card'

// The first 5 entries arrive with the page; each click asks the server for the next 5 (up to 50).
// A provisional entry and its later verified listing share one id, so it is never shown twice.
// A list that includes other institution types (e.g. polytechnics) is counted as "institutions", with the split.
export function UniversityList({ iso2, initial, total, otherTotal = 0 }: { iso2: string; initial: DirectoryEntry[]; total: number; otherTotal?: number }) {
  const destination = getDestination(iso2)
  const [universities, setUniversities] = useState(initial)
  const [limit, setLimit] = useState(total)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  // The first newly loaded card takes focus when it mounts, so keyboard users continue from there.
  const focusId = useRef<number | null>(null)

  async function loadMore() {
    setStatus('loading')
    try {
      const res = await fetch(`/api/destinations/${iso2}/universities?offset=${universities.length}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const page = (await res.json()) as { entries: DirectoryEntry[]; total: number }
      const seen = new Set(universities.map((u) => u.id))
      const fresh = page.entries.filter((u) => !seen.has(u.id))
      setUniversities([...universities, ...fresh])
      // Nothing new means the list changed underneath us: stop offering more rather than loop.
      setLimit(fresh.length ? page.total : universities.length)
      setStatus('idle')
      focusId.current = fresh[0]?.id ?? null
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-6">
        {universities.map((u) => (
          <li
            key={u.id}
            tabIndex={-1}
            className="rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            ref={(el) => {
              if (el && focusId.current === u.id) {
                focusId.current = null
                el.focus({ preventScroll: true })
              }
            }}
          >
            {u.listing === 'provisional' ? (
              <ProvisionalCard university={u} href={destination && universityHref(destination, u.slug)} />
            ) : (
              <UniversityCard university={u} href={destination && universityHref(destination, u.slug)} />
            )}
          </li>
        ))}
      </ul>
      {/* Not a scroll anchor: new cards appear below what the reader was looking at instead of pulling the page down. */}
      <div className="flex flex-col items-center gap-3 text-center [overflow-anchor:none]">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {status === 'error'
            ? `More ${otherTotal > 0 ? 'institutions' : 'universities'} could not be loaded.`
            : otherTotal > 0
              ? `Showing ${universities.length} of ${limit} institutions (${plural(total - otherTotal, 'university', 'universities')}, ${plural(otherTotal, 'other institution type', 'other institution types')}).`
              : `Showing ${universities.length} of ${limit} ${limit === 1 ? 'university' : 'universities'}.`}
        </p>
        {universities.length < limit && (
          <Button variant="outline" size="lg" className="min-h-11 px-5" onClick={loadMore} disabled={status === 'loading'} aria-busy={status === 'loading'}>
            {status === 'loading' ? 'Loading…' : status === 'error' ? 'Retry' : otherTotal > 0 ? 'See more institutions' : 'See more universities'}
          </Button>
        )}
      </div>
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
