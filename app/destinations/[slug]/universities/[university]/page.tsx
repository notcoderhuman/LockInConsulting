import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { ProfileActions } from '@/components/destination/profile-actions'
import { ProvisionalCard } from '@/components/destination/provisional-card'
import { StatusLegend } from '@/components/destination/status-legend'
import { UniversityCard } from '@/components/destination/university-card'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'
import { RecordView } from '@/components/universities/record-view'
import { SaveButton } from '@/components/universities/save-button'
import { getUniversityProfile } from '@/lib/data/directory'
import { profileText } from '@/lib/data/profile-text'
import { destinationHref, getDestinationBySlug, universityHref } from '@/lib/destinations'
import { getT } from '@/lib/i18n/server'

type Props = { params: Promise<{ slug: string; university: string }> }

// Metadata and the page share one database read per request.
const load = cache(async (slug: string, university: string) => {
  const destination = getDestinationBySlug(slug)
  if (!destination) return null
  return { destination, profile: await getUniversityProfile(destination.iso2, university) }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, university } = await params
  const data = await load(slug, university)
  const entry = data?.profile.state === 'ready' ? data.profile.entry : null
  if (!data || !entry) return { title: 'Page not found · LockIn Consulting', robots: { index: false } }
  const verified = entry.listing === 'verified'
  return {
    title: `${entry.name} · Study in ${data.destination.name} · LockIn Consulting`,
    description: verified
      ? `${entry.name}: verified details with official sources and check dates.`
      : `${entry.name} is listed by LockIn but not yet verified. Courses, tuition and rankings are not shown.`,
    alternates: { canonical: universityHref(data.destination, entry.slug) },
    // A candidate listing is not a reviewed profile, so search engines are asked not to index it.
    robots: verified ? undefined : { index: false, follow: true },
  }
}

export default async function UniversityProfilePage({ params }: Props) {
  const { slug, university } = await params
  const data = await load(slug, university)
  if (!data || data.profile.state === 'not_configured') notFound()
  const { destination, profile } = data
  const { t } = await getT()

  if (profile.state === 'error')
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-5 py-24 md:px-8">
          <h1 className="font-serif text-4xl text-foreground">{t('profile.unavailableTitle')}</h1>
          <p className="mt-4 text-muted-foreground">{t('profile.unavailableBody')}</p>
        </div>
      </Shell>
    )

  const entry = profile.entry
  if (!entry) notFound()
  const path = universityHref(destination, entry.slug)
  const verified = entry.listing === 'verified'

  return (
    <Shell>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 pb-16 pt-8 md:px-8 md:pt-12">
        <nav aria-label={t('profile.breadcrumb')}>
          <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <li>
              <Link href="/destinations" className="inline-flex min-h-11 items-center hover:text-foreground">
                {t('nav.destinations')}
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href={`${destinationHref(destination)}#universities`} className="inline-flex min-h-11 items-center hover:text-foreground">
                {destination.shortName}
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-foreground" translate="no">
              {entry.name}
            </li>
          </ol>
        </nav>

        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">{verified ? t('profile.eyebrowVerified') : t('profile.eyebrowCandidate')}</p>
          <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground">
            {verified ? t('profile.introVerified') : t('profile.introCandidate')}
          </p>
        </div>

        {entry.listing === 'verified' ? <UniversityCard university={entry} titleAs="h1" /> : <ProvisionalCard university={entry} titleAs="h1" />}

        <div className="flex flex-wrap items-start gap-2">
          <SaveButton item={{ destinationIso2: destination.iso2, slug: entry.slug, name: entry.name }} />
          <ProfileActions title={entry.name} path={path} text={profileText(entry, destination.name, '{url}')} />
        </div>
        <RecordView item={{ destinationIso2: destination.iso2, slug: entry.slug, name: entry.name }} />

        <div className="flex flex-col items-start">
          <Link
            href={`${destinationHref(destination)}#universities`}
            className="inline-flex min-h-11 items-center gap-2 text-sm text-primary hover:underline hover:underline-offset-4"
          >
            <ArrowLeft className="size-4" aria-hidden /> {t('profile.backTo', { country: destination.shortName })}
          </Link>
          <Link href="/universities" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-primary">
            {t('profile.searchAll')}
          </Link>
        </div>
      </div>
      <StatusLegend />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  )
}
