import { ShieldCheck } from 'lucide-react'

export function DerekStatus() {
  return (
    <section id="derek" aria-labelledby="derek-title" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.32em] text-primary">Ask Derek</p>
          <h2 id="derek-title" className="mt-4 font-serif text-4xl font-medium leading-tight text-balance md:text-5xl">
            Derek is our AI assistant. He&apos;s not live yet, on purpose.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground">
            Before Derek answers anyone, we&apos;re checking that our AI provider allows a service used by students, including students under 18, and that your messages and documents are handled properly. Until that&apos;s confirmed, Derek stays off.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
          <div className="flex items-center gap-3">
            <span className="relative flex size-2.5">
              <span className="size-2.5 rounded-full bg-muted-foreground" aria-hidden />
            </span>
            <p className="text-sm font-medium text-foreground">Status: in review, not accepting questions</p>
          </div>
          <ul className="mt-6 flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
            {[
              'Answers will always be labelled “Replied by Derek · AI assistant” or “Replied by Dev”.',
              'Derek won’t invent deadlines, fees, rankings or visa rules. If he doesn’t know, he’ll say so.',
              'No admission, scholarship or visa outcome is ever guaranteed.',
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
