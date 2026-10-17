const STEPS = [
  {
    title: 'Choose where and what',
    body: 'Tell us your course and target country. That is all we ask before your first question. Instagram is optional, always.',
  },
  {
    title: 'Compare with real sources',
    body: 'Tuition in local currency with an approximate INR figure, the exchange-rate date, and a link to the official page it came from.',
  },
  {
    title: 'Get answers, with a human watching',
    body: 'Derek drafts, Dev reviews. Every answer is labelled with who actually wrote it, and high-stakes questions get a human.',
  },
] as const

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.32em] text-primary">How it works</p>
            <h2 id="how-title" className="mt-4 font-serif text-4xl font-medium leading-tight text-balance md:text-5xl">
              Three steps. No guesswork.
            </h2>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-4 bg-background p-6 md:p-8">
                <span className="font-mono text-xs text-primary" aria-hidden="true">
                  Step {i + 1}
                </span>
                <h3 className="font-serif text-2xl leading-snug text-foreground">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
