import type { Metadata, Viewport } from 'next'
import { Cormorant_Garamond, Manrope, Noto_Sans_Devanagari, Noto_Serif_Devanagari } from 'next/font/google'
import { headers } from 'next/headers'
import { connection } from 'next/server'
import { HTML_LANG } from '@/lib/i18n'
import { LocaleProvider } from '@/lib/i18n/client'
import { getLocale, hindiEnabled } from '@/lib/i18n/server'
import { getSiteUrl } from '@/lib/site-url'
import { TEXT_SIZE_BOOT } from '@/lib/text-size'
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

// Devanagari for the Hindi interface. The Latin fonts have no Devanagari, so these sit next in the
// font stacks; not preloaded, and the browser fetches them only for a page that shows Devanagari.
const notoSans = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '500', '600'],
  variable: '--font-noto-devanagari',
  display: 'swap',
  preload: false,
})

const notoSerif = Noto_Serif_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '500'],
  variable: '--font-noto-serif-devanagari',
  display: 'swap',
  preload: false,
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
    // Without a verified site URL, Next.js resolves relative share images against localhost (or a
    // Vercel deployment URL), so they are published only once NEXT_PUBLIC_SITE_URL is set.
    ...(siteUrl ? { images: [{ url: '/images/logo-full.webp', alt: 'LockIn Consulting' }] } : {}),
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
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const locale = await getLocale()
  return (
    // suppressHydrationWarning: the boot script may set data-text-size before React hydrates.
    <html
      lang={HTML_LANG[locale]}
      className={`${cormorant.variable} ${manrope.variable} ${notoSans.variable} ${notoSerif.variable} bg-background`}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: TEXT_SIZE_BOOT }} />
      </head>
      <body className="antialiased">
        <LocaleProvider locale={locale} languageSwitch={hindiEnabled()}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  )
}
