import { notFound, redirect } from 'next/navigation'
import { getDestinationBySlug } from '@/lib/destinations'

// University profile pages are retired: a card is name, QS rank and verification only, on the country page.
export default async function UniversityPage({ params }: { params: Promise<{ slug: string }> }) {
  const destination = getDestinationBySlug((await params).slug)
  if (!destination) notFound()
  redirect(`/destinations/${destination.slug}#universities`)
}
