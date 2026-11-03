import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DestinationHero } from '@/components/destination/destination-hero'
import { DestinationPager } from '@/components/destination/destination-pager'
import { OfficialResources } from '@/components/destination/official-resources'
import { StatusLegend } from '@/components/destination/status-legend'
import { UniversityDirectory } from '@/components/destination/university-directory'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { getOfficialResources } from '@/lib/content/official-resources'
import { getDestinationDirectory } from '@/lib/data/directory'
import { DESTINATIONS, getDestinationBySlug } from '@/lib/destinations'

export const dynamicParams = false

export function generateStaticParams() {
  return DESTINATIONS.map((d) => ({ slug: d.slug }))
}

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const destination = getDestinationBySlug((await params).slug)
  if (!destination) return {}
  return {
    title: `Study in ${destination.name} · LockIn Consulting`,
    description: `Universities, courses, tuition and official admissions resources for ${destination.name}, with sources and check dates.`,
    alternates: { canonical: `/destinations/${destination.slug}` },
  }
}

export default async function DestinationPage({ params }: Props) {
  const destination = getDestinationBySlug((await params).slug)
  if (!destination) notFound()

  const directory = await getDestinationDirectory(destination.iso2)
  const resources = getOfficialResources(destination.iso2)

  return (
    <>
      <SkipLink />
      <SiteHeader />
      {/* Page body not yet translated (Phase D covers the interface shell): marked English for screen readers and browser translation. */}
      <main id="main" lang="en">
        <DestinationHero
          destination={destination}
          verifiedListings={directory.state === 'ready' ? directory.verifiedTotal : null}
          provisionalListings={directory.state === 'ready' ? directory.total - Math.min(directory.verifiedTotal, directory.total) : 0}
          resourceCount={resources.length}
        />
        <UniversityDirectory destination={destination} directory={directory} />
        <OfficialResources destination={destination} resources={resources} />
        <StatusLegend />
        <DestinationPager iso2={destination.iso2} />
      </main>
      <SiteFooter />
    </>
  )
}
