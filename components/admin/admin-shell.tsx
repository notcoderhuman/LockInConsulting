import Link from 'next/link'
import type { ReactNode } from 'react'
import { actorCan, ROLE_LABEL, type AdminActor } from '@/lib/admin/roles'
import { AdminNav } from './admin-nav'
import { SignOutButton } from './sign-out-button'

export function AdminShell({ actor, children }: { actor: AdminActor; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside className="flex flex-col border-b border-border bg-background md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-4 md:px-5 md:py-6">
          <Link href="/admin" className="flex items-baseline gap-2">
            <span className="font-serif text-2xl text-foreground">LockIn</span>
            <span className="text-[0.7rem] font-semibold tracking-[0.2em] text-primary uppercase">Admin</span>
          </Link>
          <div className="md:hidden">
            <SignOutButton compact />
          </div>
        </div>
        <AdminNav
          access={{ support: actorCan(actor, 'support.read'), students: actorCan(actor, 'students.read'), team: actorCan(actor, 'members.read') }}
        />
        <div className="mt-auto hidden flex-col gap-3 border-t border-border px-5 py-5 md:flex">
          <div className="flex flex-col gap-0.5">
            <span className="truncate text-sm text-foreground">{actor.name}</span>
            <span className="truncate text-xs text-muted-foreground">{actor.email}</span>
            <span className="mt-1 text-xs font-medium text-primary">
              {ROLE_LABEL[actor.role]}
              {actor.role === 'editor' && actor.supportEnabled ? ' · support' : ''}
            </span>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main id="admin-main" className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>
    </div>
  )
}
