'use client'

import { DESTINATIONS } from '@/lib/destinations'
import { cn } from '@/lib/utils'

interface CountryListProps {
  selectedIso: string | null
  onSelect: (iso2: string) => void
}

export function CountryList({ selectedIso, onSelect }: CountryListProps) {
  return (
    <div>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
        Destinations
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1 lg:gap-1">
        {DESTINATIONS.map((d) => {
          const isSelected = d.iso2 === selectedIso
          return (
            <li key={d.iso2}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(d.iso2)}
                className={cn(
                  'group flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm transition-colors',
                  isSelected
                    ? 'border-primary/70 bg-primary/10 text-foreground'
                    : 'border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground lg:border-transparent',
                )}
              >
                <span className="truncate">{d.shortName}</span>
                <span
                  className={cn(
                    'font-mono text-[0.7rem] tracking-wider',
                    isSelected ? 'text-primary' : 'text-muted-foreground/80',
                  )}
                  aria-hidden="true"
                >
                  {d.iso2}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
