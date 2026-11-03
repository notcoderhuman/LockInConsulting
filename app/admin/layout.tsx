import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { LocaleProvider } from '@/lib/i18n/client'

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · LockIn Admin' },
  robots: { index: false, follow: false, nocache: true },
}

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <div lang="en-IN" className="min-h-dvh bg-background font-sans text-foreground">
      <LocaleProvider locale="en">{children}</LocaleProvider>
    </div>
  )
}
