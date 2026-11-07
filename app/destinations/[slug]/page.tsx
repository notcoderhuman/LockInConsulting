import { notFound, redirect } from 'next/navigation'
import { DESTINATIONS, getDestinationBySlug } from '@/lib/destinations'

export const dynamicParams = false

export function generateStaticParams() {
  return DESTINATIONS.map((d) => ({ slug: d.slug }))
}

// The old per-destination research page is retired: the directory opens on the same destination.
export default async function DestinationPage({ params }: { params: Promise<{ slug: string }> }) {
  const destination = getDestinationBySlug((await params).slug)
  if (!destination) notFound()
  redirect(`/universities?d=${destination.iso2.toLowerCase()}`)
}
