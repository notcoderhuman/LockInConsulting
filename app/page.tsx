import { DerekStatus } from '@/components/home/derek-status'
import { HeroExplorer } from '@/components/home/hero-explorer'
import { HowItWorks } from '@/components/home/how-it-works'
import { TeamSection } from '@/components/home/team-section'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/site/skip-link'

export default function HomePage() {
  return (
    <>
      <SkipLink />
      <SiteHeader />
      <main id="main">
        <HeroExplorer />
        <HowItWorks />
        <DerekStatus />
        <TeamSection />
      </main>
      <SiteFooter />
    </>
  )
}
