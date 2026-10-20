import { Award } from 'lucide-react'

/**
 * Rankings render per university only when public_university_rankings returns rows (provider
 * rights licensed). While QS rights are unconfirmed (RISKS.md R-004) this explains the absence.
 */
export function RankingsNotice({ publishedCount }: { publishedCount: number }) {
  return (
    <section aria-labelledby="rankings-title" id="rankings" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto max-w-7xl px-5 py-8 md:px-8">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-5 sm:flex-row sm:items-start sm:gap-4 md:p-6">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Award className="size-4" aria-hidden />
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">World rankings</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-xs font-medium text-primary">Brief info</span>
            </div>
            <h3 id="rankings-title" className="font-serif text-lg font-medium text-foreground">
              {publishedCount > 0 ? 'Licensed rankings' : 'Rankings are not published yet'}
            </h3>
            {publishedCount > 0 ? (
              <p className="leading-relaxed text-muted-foreground">
                Rankings appear on individual university listings above, with the provider, year and source.
              </p>
            ) : (
              <p className="leading-relaxed text-muted-foreground">
                Ranking tables are owned by their publishers and reusing them needs permission. We haven&apos;t
                confirmed reuse rights with any ranking provider, so we don&apos;t show ranking positions. We will not
                copy, estimate or restate them.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
