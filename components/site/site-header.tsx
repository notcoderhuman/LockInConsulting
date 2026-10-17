'use client'

import { Menu, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'

const NAV = [
  { href: '/destinations', label: 'Destinations' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#team', label: 'Our team' },
] as const

const DEREK = { href: '/#derek', label: 'Ask Derek' } as const

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 md:px-8">
        <Link href="/" className="flex min-h-11 items-center gap-3" aria-label="LockIn Consulting home">
          <Image src="/images/logo-mark.webp" alt="" width={44} height={36} priority className="h-8 w-auto" />
          <span className="flex flex-col leading-none">
            <span className="font-serif text-xl tracking-[0.22em] text-foreground">LOCKIN</span>
            <span className="mt-1 text-[0.6rem] font-medium uppercase tracking-[0.42em] text-muted-foreground">
              Consulting
            </span>
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="inline-flex min-h-11 items-center rounded-full px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href={DEREK.href}
                className="ml-2 inline-flex min-h-11 items-center rounded-full border border-primary/50 px-5 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                {DEREK.label}
              </a>
            </li>
          </ul>
        </nav>

        <button
          type="button"
          className="inline-flex size-11 items-center justify-center rounded-full border border-border text-foreground md:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>

      <nav
        id={menuId}
        aria-label="Primary mobile"
        hidden={!open}
        className="border-t border-border/60 bg-background px-5 pb-6 pt-2 md:hidden"
      >
        <ul className="flex flex-col">
          {[...NAV, DEREK].map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center border-b border-border/50 text-base text-foreground"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  )
}
