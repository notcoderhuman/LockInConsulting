import Link from 'next/link'
import type { ReactNode } from 'react'

export function GateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Link href="/" className="flex items-baseline gap-2 self-center">
          <span className="font-serif text-3xl text-foreground">LockIn</span>
          <span className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Admin</span>
        </Link>
        <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
          <h1 className="font-serif text-2xl font-medium text-foreground">{title}</h1>
          {children}
        </section>
      </div>
    </main>
  )
}
