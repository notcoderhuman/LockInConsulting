'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Bell, ClipboardCheck, GraduationCap, History, Inbox, LayoutDashboard, Library, Settings, UserRound, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface NavAccess {
  support: boolean
  students: boolean
  team: boolean
}

type Badge = 'inbox' | 'notifications'

const ITEMS: { href: string; label: string; icon: typeof Inbox; match: (p: string) => boolean; needs?: keyof NavAccess; badge?: Badge }[] = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, match: (p) => p === '/admin' },
  { href: '/admin/inbox', label: 'Live Inbox', icon: Inbox, match: (p) => p.startsWith('/admin/inbox'), needs: 'support', badge: 'inbox' },
  { href: '/admin/students', label: 'Students', icon: UserRound, match: (p) => p.startsWith('/admin/students'), needs: 'students' },
  { href: '/admin/universities', label: 'University Data', icon: GraduationCap, match: (p) => p.startsWith('/admin/universities') || p.startsWith('/admin/records') },
  { href: '/admin/sources', label: 'Data Sources', icon: Library, match: (p) => p.startsWith('/admin/sources') },
  { href: '/admin/review', label: 'Review Queue', icon: ClipboardCheck, match: (p) => p.startsWith('/admin/review') },
  { href: '/admin/notifications', label: 'Notifications', icon: Bell, match: (p) => p.startsWith('/admin/notifications'), badge: 'notifications' },
  { href: '/admin/team', label: 'Our Team', icon: Users, match: (p) => p.startsWith('/admin/team'), needs: 'team' },
  { href: '/admin/changes', label: 'Change Log', icon: History, match: (p) => p.startsWith('/admin/changes') },
  { href: '/admin/settings', label: 'Settings', icon: Settings, match: (p) => p.startsWith('/admin/settings') },
]

const POLL_MS = 15_000

/** Unread counts for the badges, polled (D-009). Failures just hide the badges. */
function useBadgeCounts(): Record<Badge, number | null> {
  const [counts, setCounts] = useState<Record<Badge, number | null>>({ inbox: null, notifications: null })
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (document.visibilityState === 'hidden') return
      try {
        const res = await fetch('/api/admin/notifications', { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { notifications: number; inboxUnread: number | null }
        if (!cancelled) setCounts({ inbox: body.inboxUnread, notifications: body.notifications })
      } catch {
        // Offline or signed out: keep the last known counts.
      }
    }
    void load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])
  return counts
}

// Navigation only. Every page and action authorises on the server regardless of what is shown.
export function AdminNav({ access }: { access: NavAccess }) {
  const pathname = usePathname()
  const counts = useBadgeCounts()
  return (
    <nav aria-label="Admin sections" className="overflow-x-auto px-2 pb-3 md:overflow-visible md:px-3 md:pb-0">
      <ul className="flex gap-1 md:flex-col">
        {ITEMS.filter((i) => !i.needs || access[i.needs]).map(({ href, label, icon: Icon, match, badge }) => {
          const active = match(pathname)
          const count = badge ? counts[badge] : null
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors',
                  active ? 'bg-card text-primary' : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
                {count ? (
                  <span className="ml-auto rounded-full bg-primary px-1.5 text-[0.7rem] font-semibold tabular-nums text-primary-foreground">
                    {count > 99 ? '99+' : count}
                    <span className="sr-only"> unread</span>
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
