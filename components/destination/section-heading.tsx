interface SectionHeadingProps {
  id: string
  eyebrow: string
  title: string
  children?: React.ReactNode
}

export function SectionHeading({ id, eyebrow, title, children }: SectionHeadingProps) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-[0.28em] text-primary">{eyebrow}</p>
      <h2 id={id} className="font-serif text-3xl font-medium leading-tight text-balance text-foreground md:text-4xl">
        {title}
      </h2>
      {children && <div className="text-sm leading-relaxed text-pretty text-muted-foreground md:text-base">{children}</div>}
    </div>
  )
}
