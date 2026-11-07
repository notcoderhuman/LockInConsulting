import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { QsDirectory } from '@/components/directory/qs-directory'
import { DestinationHero } from '@/components/destination/destination-hero'
import { DestinationPager } from '@/components/destination/destination-pager'
import { OfficialResources } from '@/components/destination/official-resources'
import { SectionHeading } from '@/components/destination/section-heading'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { getOfficialResources } from '@/lib/content/official-resources'
import { getQsDirectory, QS_ATTRIBUTION } from '@/lib/data/qs-directory'
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
    description: `Universities in ${destination.name} in QS World University Rankings 2027 order, and official admissions resources.`,
    alternates: { canonical: `/destinations/${destination.slug}` },
  }
}

// One destination: its own universities only, in QS World University Rankings 2027 order. Each card is the name,
// the QS rank exactly as printed and, only when LockIn itself verified and published the university, a Verified badge.
export default async function DestinationPage({ params }: Props) {
  const destination = getDestinationBySlug((await params).slug)
  if (!destination) notFound()

  const directory = await getQsDirectory({ iso2: destination.iso2, q: '', offset: 0 })
  const resources = getOfficialResources(destination.iso2)

  return (
    <>
      <SkipLink />
      <SiteHeader />
      {/* Page body not yet translated (Phase D covers the interface shell): marked English for screen readers and browser translation. */}
      <main id="main" lang="en">
        <DestinationHero
          destination={destination}
          verifiedListings={directory.state === 'ready' && directory.published ? directory.total : null}
          resourceCount={resources.length}
        />
        <section id="universities" aria-labelledby="universities-title" className="scroll-mt-20 border-t border-border/60">
          <div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
            <div className="mb-8">
              <SectionHeading id="universities-title" eyebrow="Directory" title={`Universities in ${destination.shortName}`}>
                <p>Listed in QS World University Rankings 2027 order. Search by name.</p>
              </SectionHeading>
            </div>
            <QsDirectory destinations={[{ iso2: destination.iso2, name: destination.shortName }]} initial={destination.iso2} attribution={QS_ATTRIBUTION} fixed />
          </div>
        </section>
        <OfficialResources destination={destination} resources={resources} />
        <section lang="en" aria-labelledby="data-status-title" id="data-status" className="scroll-mt-20 border-t border-border/60">
          <div className="mx-auto max-w-7xl px-5 py-16 md:px-8">
            <SectionHeading id="data-status-title" eyebrow="How we verify" title="What the Verified badge means">
              <p>
                A university shows Verified only when LockIn itself has checked it against official sources and published it. A university without the badge is listed from its QS
                World University Rankings 2027 position alone.
              </p>
            </SectionHeading>
          </div>
        </section>
        <DestinationPager iso2={destination.iso2} />
      </main>
      <SiteFooter />
    </>
  )
}
