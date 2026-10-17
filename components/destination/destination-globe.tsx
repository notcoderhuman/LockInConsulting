'use client'

import { useRouter } from 'next/navigation'
import { GlobeStage } from '@/components/globe/globe-stage'
import { destinationHref, getDestination } from '@/lib/destinations'

/** The homepage globe, focused on this destination. Choosing another marker opens its page. */
export function DestinationGlobe({ iso2 }: { iso2: string }) {
  const router = useRouter()

  const handleSelect = (next: string) => {
    if (next === iso2) return
    const destination = getDestination(next)
    if (destination) router.push(destinationHref(destination))
  }

  return <GlobeStage selectedIso={iso2} onSelect={handleSelect} className="mx-auto max-w-[28rem]" />
}
