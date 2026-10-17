import { SectionHeading } from './section-heading'

/**
 * Rankings render per university only when public_university_rankings returns rows (provider
 * rights licensed). While QS rights are unconfirmed (RISKS.md R-004) this explains the absence.
 */
export function RankingsNotice({ publishedCount }: { publishedCount: number }) {
  return (
    <section aria-labelledby="rankings-title" id="rankings" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-16 md:px-8">
        <SectionHeading id="rankings-title" eyebrow="World rankings" title={publishedCount > 0 ? 'Licensed rankings' : 'Rankings are not published yet'}
        >
          {publishedCount > 0 ? (
            <p>Rankings appear on individual university listings above, with the provider, year and source.</p>
          ) : (
            <p>
              Ranking tables are owned by their publishers and reusing them needs permission. We haven&apos;t
              confirmed reuse rights with any ranking provider, so we don&apos;t show ranking positions. We will not
              copy, estimate or restate them.
            </p>
          )}
        </SectionHeading>
      </div>
    </section>
  )
}
