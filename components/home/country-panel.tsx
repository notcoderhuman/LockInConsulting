'use client'

import { ArrowRight, MapPin, X } from 'lucide-react'
import Link from 'next/link'
import { destinationHref, type Destination } from '@/lib/destinations'

interface CountryPanelProps {
  destination: Destination | undefined
  onClear: () => void
}

export function CountryPanel({ destination, onClear }: CountryPanelProps) {
  return (
    <div
      aria-live="polite"
      className="rounded-2xl border border-border bg-card/80 p-6"
    >
      {destination ? (
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs tracking-widest text-primary">
                {destination.iso3} · {destination.region}
              </p>
              <h2 className="mt-2 font-serif text-3xl font-medium leading-tight text-balance text-foreground">
                {destination.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`Clear selection of ${destination.name}`}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="size-4 text-primary" aria-hidden />
            Marker: {destination.marker.label}
            {destination.subRegions?.length
              ? ` · includes ${destination.subRegions.map((s) => s.name).join(', ')}`
              : ''}
          </p>

          {destination.note && (
            <p className="text-sm leading-relaxed text-muted-foreground">{destination.note}</p>
          )}

          <div className="border-t border-border pt-5">
            <p className="text-sm font-medium text-foreground">University directory</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Verified listings for {destination.shortName} are being prepared. We only publish fees and rankings with an official source and a check date, so nothing here is guessed.
            </p>
          </div>

          <Link
            href={destinationHref(destination)}
            className="inline-flex min-h-11 items-center justify-between rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Explore {destination.shortName}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
            No destination selected
          </p>
          <p className="font-serif text-2xl leading-snug text-balance text-foreground">
            Choose a country to bring it into view.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Click a gold marker on the globe or pick from the list. Keyboard users can tab to the list or focus the globe and use arrow keys.
          </p>
        </div>
      )}
    </div>
  )
}
