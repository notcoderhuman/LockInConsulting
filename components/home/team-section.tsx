import Image from 'next/image'
import { TEAM_SEED } from '@/lib/content/team'

export function TeamSection() {
  const members = TEAM_SEED.filter((m) => m.published).sort((a, b) => a.order - b.order)

  return (
    <section id="team" aria-labelledby="team-title" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <p className="text-xs font-medium uppercase tracking-[0.32em] text-primary">Our team</p>
        <h2 id="team-title" className="mt-4 font-serif text-4xl font-medium leading-tight text-balance md:text-5xl">
          The people behind LockIn
        </h2>

        <ul className="mt-12 grid gap-10">
          {members.map((member) => (
            <li key={member.id} className="grid items-center gap-8 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:gap-14">
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <Image
                  src={member.portrait.src}
                  alt={member.portrait.alt}
                  width={member.portrait.width}
                  height={member.portrait.height}
                  sizes="(min-width: 768px) 22rem, 100vw"
                  className="aspect-[4/5] w-full object-cover object-top"
                />
              </div>
              <div className="flex flex-col gap-4">
                <h3 className="font-serif text-4xl font-medium text-foreground md:text-5xl">{member.displayName}</h3>
                <p className="text-sm font-medium uppercase tracking-[0.28em] text-primary">{member.role}</p>
                {member.quote && (
                  <blockquote className="mt-4 border-l border-primary/50 pl-5 font-serif text-2xl leading-snug text-foreground/90 md:text-3xl">
                    {`“${member.quote}”`}
                  </blockquote>
                )}
                {member.description && (
                  <p className="max-w-xl text-base leading-relaxed text-muted-foreground">{member.description}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
