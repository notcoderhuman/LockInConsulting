import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/site-url'

export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl()
  if (!site) return { rules: { userAgent: '*', disallow: '/' } }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/support', '/auth', '/age-confirm', '/chat'] },
    sitemap: new URL('/sitemap.xml', site).toString(),
  }
}
