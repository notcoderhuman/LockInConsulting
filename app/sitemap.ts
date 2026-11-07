import type { MetadataRoute } from 'next'
import { FAQ_ENTRIES } from '@/lib/content/faq'
import { getSiteUrl } from '@/lib/site-url'

export default function sitemap(): MetadataRoute.Sitemap {
  const site = getSiteUrl()
  if (!site) return []
  const paths = ['/', ...(FAQ_ENTRIES.length ? ['/faq'] : [])]
  return paths.map((p) => ({ url: new URL(p, site).toString() }))
}
