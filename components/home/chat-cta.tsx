import Link from 'next/link'
import { authPathFor } from '@/lib/student/next-path'

// The homepage's way into the student chat: no form and no conversation here. Signing in happens
// on /auth, the chat itself on /chat. Kept at id="derek" so older /#derek links still land here.
export const CHAT_NOW_HREF = authPathFor()

export function ChatCta() {
  return (
    <section id="derek" aria-labelledby="chat-cta-title" className="scroll-mt-20 border-t border-border/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-16 md:flex-row md:items-center md:justify-between md:px-8 md:py-20">
        <div className="max-w-2xl">
          <h2 id="chat-cta-title" className="font-serif text-4xl font-medium leading-tight text-balance md:text-5xl">
            Have a question about studying abroad?
          </h2>
          <p className="mt-5 text-base leading-relaxed text-pretty text-muted-foreground">
            Talk to the LockIn team about universities, courses, fees and admissions. If the team is unavailable, Derek can help with eligible questions.
          </p>
        </div>
        <Link
          href={CHAT_NOW_HREF}
          className="inline-flex min-h-12 shrink-0 items-center justify-center self-start rounded-full bg-primary px-8 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring md:self-center"
        >
          Chat Now
        </Link>
      </div>
    </section>
  )
}
