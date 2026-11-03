const STEPS = [
  {
    title: 'Tell us your goal',
    body: 'Choose your destination and course. Share your Instagram handle only if you want to.',
  },
  {
    title: 'Compare verified options',
    body: 'Explore universities, tuition fees and entry requirements using reliable sources. Where available, see local-currency costs, approximate INR conversions, exchange-rate dates, and links to official information.',
  },
  {
    title: 'Get answers with human oversight',
    body: 'Ask your questions in chat. Derek can prepare replies, while the LockIn team handles reviews and questions that need human attention.',
  },
] as const

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-12 px-5 py-20 md:px-8 md:py-28">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.32em] text-primary">How it works</p>
          <h2 id="how-title" className="mt-4 font-serif text-4xl font-medium leading-tight text-balance md:text-5xl">
            A clearer path to studying abroad.
          </h2>
        </div>
        <ol className="grid gap-4 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-6 md:p-8">
              <span className="border-b border-border pb-4 font-mono text-sm text-primary" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="font-serif text-2xl leading-snug text-balance text-foreground">
                <span className="sr-only">{`Step ${i + 1}: `}</span>
                {step.title}
              </h3>
              <p className="max-w-prose text-sm leading-relaxed text-pretty text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
