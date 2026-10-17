import { ArrowLeft, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { destinationHref, getAdjacentDestinations } from '@/lib/destinations'

export function DestinationPager({ iso2 }: { iso2: string }) {
  const { previous, next } = getAdjacentDestinations(iso2)
  return (
    <nav aria-label="Other destinations" className="border-t border-border/60">
      <div className="mx-auto flex max-w-7xl items-stretch justify-between gap-4 px-5 py-10 md:px-8">
        <Link
          href={destinationHref(previous)}
          className="group flex min-h-11 flex-col gap-1 rounded-2xl px-1 text-left"
        >
          <span className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <ArrowLeft className="size-3.5" aria-hidden /> Previous
          </span>
          <span className="font-serif text-2xl text-foreground group-hover:text-primary">{previous.shortName}</span>
        </Link>
        <Link
          href={destinationHref(next)}
          className="group flex min-h-11 flex-col items-end gap-1 rounded-2xl px-1 text-right"
        >
          <span className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Next <ArrowRight className="size-3.5" aria-hidden />
          </span>
          <span className="font-serif text-2xl text-foreground group-hover:text-primary">{next.shortName}</span>
        </Link>
      </div>
    </nav>
  )
}
