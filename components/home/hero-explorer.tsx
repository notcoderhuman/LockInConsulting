'use client'

import { useState } from 'react'
import { GlobeStage } from '@/components/globe/globe-stage'
import { getDestination } from '@/lib/destinations'
import { CountryList } from './country-list'
import { CountryPanel } from './country-panel'
import { IstClock } from './ist-clock'

export function HeroExplorer() {
  const [selectedIso, setSelectedIso] = useState<string | null>(null)
  const selected = selectedIso ? getDestination(selectedIso) : undefined

  return (
    <section
      id="destinations"
      aria-labelledby="hero-title"
      className="relative mx-auto max-w-7xl scroll-mt-20 px-5 pb-20 pt-10 md:px-8 md:pt-14"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
        <p className="reveal text-xs font-medium uppercase tracking-[0.18em] text-primary sm:tracking-[0.32em]" style={{ '--reveal-index': 0 } as React.CSSProperties}>
          Study abroad · UG &amp; PG · 11 destinations
        </p>
        <h1
          id="hero-title"
          className="reveal font-serif text-4xl font-medium leading-[1.05] text-balance text-foreground sm:text-5xl md:text-6xl lg:text-7xl"
          style={{ '--reveal-index': 1 } as React.CSSProperties}
        >
          Pick the country. Then pick it apart.
        </h1>
        <p
          className="reveal max-w-xl text-base leading-relaxed text-pretty text-muted-foreground md:text-lg"
          style={{ '--reveal-index': 2 } as React.CSSProperties}
        >
          Spin the globe or choose from the list. Every fee and ranking we publish carries its source and the date we checked it.
        </p>
      </div>

      <div className="mt-10 grid items-center gap-8 lg:mt-12 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,19rem)] lg:gap-10">
        <div className="reveal order-2 lg:order-1" style={{ '--reveal-index': 4 } as React.CSSProperties}>
          <CountryList selectedIso={selectedIso} onSelect={setSelectedIso} />
        </div>

        <div className="reveal order-1 flex flex-col items-center gap-3 lg:order-2" style={{ '--reveal-index': 3 } as React.CSSProperties}>
          <GlobeStage
            selectedIso={selectedIso}
            onSelect={setSelectedIso}
            className="mx-auto max-w-[36rem]"
          />
          <IstClock />
        </div>

        <div className="reveal order-3" style={{ '--reveal-index': 5 } as React.CSSProperties}>
          <CountryPanel destination={selected} onClear={() => setSelectedIso(null)} />
        </div>
      </div>
    </section>
  )
}
