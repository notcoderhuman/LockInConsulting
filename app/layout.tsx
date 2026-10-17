import type { Metadata, Viewport } from 'next'
import { Cormorant_Garamond, Manrope } from 'next/font/google'
import { connection } from 'next/server'
import { getSiteUrl } from '@/lib/site-url'
import './globals.css'

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-cormorant',
  display: 'swap',
})

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
})

const siteUrl = getSiteUrl()

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: siteUrl } : {}),
  title: 'LockIn Consulting — Study abroad guidance for Indian students',
  description:
    'Explore 11 study-abroad destinations, compare universities with sourced data, and get guidance on undergraduate and postgraduate applications.',
  applicationName: 'LockIn Consulting',
  openGraph: {
    type: 'website',
    siteName: 'LockIn Consulting',
    locale: 'en_IN',
    images: [{ url: '/images/logo-full.webp', alt: 'LockIn Consulting' }],
  },
  robots: siteUrl ? undefined : { index: false, follow: false },
  icons: {
    icon: [
      { url: '/icon-dark-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0b0a09',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // CSP nonces are per request, so every page must render dynamically (see proxy.ts).
  await connection()
  return (
    <html lang="en-IN" className={`${cormorant.variable} ${manrope.variable} bg-background`}>
      <body className="antialiased">{children}</body>
    </html>
  )
}
