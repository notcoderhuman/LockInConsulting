import { notFound, redirect } from 'next/navigation'
import { getDestinationBySlug } from '@/lib/destinations'

// University profile pages are retired: the public card is name, QS rank and verification only.
export default async function UniversityPage({ params }: { params: Promise<{ slug: string }> }) {
  const destination = getDestinationBySlug((await params).slug)
  if (!destination) notFound()
  redirect(`/universities?d=${destination.iso2.toLowerCase()}`)
}
