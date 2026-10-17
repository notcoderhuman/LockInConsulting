import Link from 'next/link'
import type { Destination } from '@/lib/destinations'
import { DestinationGlobe } from './destination-globe'

const SECTIONS = [
  { href: '#universities', label: 'Universities, courses & tuition' },
  { href: '#admissions', label: 'Admissions & official resources' },
  { href: '#rankings', label: 'Rankings' },
  { href: '#data-status', label: 'How we verify' },
] as const

interface DestinationHeroProps {
  destination: Destination
  verifiedListings: number | null
  resourceCount: number
}

export function DestinationHero({ destination, verifiedListings, resourceCount }: DestinationHeroProps) {
  const facts = [
    { term: 'Region', value: destination.region },
    { term: 'Globe marker', value: destination.marker.label },
    { term: 'National currency', value: destination.currency },
    ...(destination.subRegions?.length
      ? [{ term: 'Includes', value: destination.subRegions.map((s) => s.name).join(', ') }]
      : []),
    { term: 'Verified university listings', value: verifiedListings === null ? 'Pending' : String(verifiedListings) },
    { term: 'Official resources linked', value: String(resourceCount) },
  ]

  return (
    <section aria-labelledby="destination-title" className="mx-auto max-w-7xl px-5 pb-16 pt-8 md:px-8 md:pt-12">
      <nav aria-label="Breadcrumb" className="reveal" style={{ '--reveal-index': 0 } as React.CSSProperties}>
        <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <li>
            <Link href="/destinations" className="inline-flex min-h-11 items-center hover:text-foreground">
              Destinations
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-foreground">
            {destination.shortName}
          </li>
        </ol>
      </nav>

      <div className="mt-6 grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="flex flex-col gap-6">
          <p
            className="reveal font-mono text-xs tracking-widest text-primary"
            style={{ '--reveal-index': 1 } as React.CSSProperties}
          >
            {destination.iso3} · {destination.region}
          </p>
          <h1
            id="destination-title"
            className="reveal font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground sm:text-5xl md:text-6xl"
            style={{ '--reveal-index': 2 } as React.CSSProperties}
          >
            Study in {destination.name}
          </h1>
          <p
            className="reveal max-w-xl text-base leading-relaxed text-pretty text-muted-foreground md:text-lg"
            style={{ '--reveal-index': 3 } as React.CSSProperties}
          >
            Universities, courses, tuition and admissions for {destination.shortName}, each tied to an official
            source and the date we checked it. Anything we haven&apos;t verified is marked as pending, not guessed.
          </p>
          {destination.note && (
            <p className="reveal max-w-xl text-sm leading-relaxed text-muted-foreground" style={{ '--reveal-index': 3 } as React.CSSProperties}>
              {destination.note}
            </p>
          )}

          <dl
            className="reveal grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-6 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3"
            style={{ '--reveal-index': 4 } as React.CSSProperties}
          >
            {facts.map((f) => (
              <div key={f.term} className="flex flex-col gap-1">
                <dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{f.term}</dt>
                <dd className="text-sm font-medium text-foreground">{f.value}</dd>
              </div>
            ))}
          </dl>

          <nav aria-label="On this page" className="reveal" style={{ '--reveal-index': 5 } as React.CSSProperties}>
            <ul className="flex flex-wrap gap-2">
              {SECTIONS.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="reveal order-first mx-auto w-full max-w-[18rem] md:order-none md:max-w-none" style={{ '--reveal-index': 2 } as React.CSSProperties}>
          <DestinationGlobe iso2={destination.iso2} />
        </div>
      </div>
    </section>
  )
}
