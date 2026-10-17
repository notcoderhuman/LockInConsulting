'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardCheck, GraduationCap, History, LayoutDashboard, Library, Settings } from 'lucide-react'
import type { AdminRole } from '@/lib/admin/roles'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, match: (p: string) => p === '/admin' },
  { href: '/admin/universities', label: 'University Data', icon: GraduationCap, match: (p: string) => p.startsWith('/admin/universities') || p.startsWith('/admin/records') },
  { href: '/admin/sources', label: 'Data Sources', icon: Library, match: (p: string) => p.startsWith('/admin/sources') },
  { href: '/admin/review', label: 'Review Queue', icon: ClipboardCheck, match: (p: string) => p.startsWith('/admin/review') },
  { href: '/admin/changes', label: 'Change Log', icon: History, match: (p: string) => p.startsWith('/admin/changes') },
  { href: '/admin/settings', label: 'Settings', icon: Settings, match: (p: string) => p.startsWith('/admin/settings') },
]

// Navigation only. Every page and action authorises on the server regardless of what is shown.
export function AdminNav({ role: _role }: { role: AdminRole }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Admin sections" className="overflow-x-auto px-2 pb-3 md:overflow-visible md:px-3 md:pb-0">
      <ul className="flex gap-1 md:flex-col">
        {ITEMS.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname)
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
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
