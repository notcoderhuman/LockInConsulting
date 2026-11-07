import type { MetadataRoute } from 'next'
import { FAQ_ENTRIES } from '@/lib/content/faq'
import { DESTINATIONS, destinationHref } from '@/lib/destinations'
import { getSiteUrl } from '@/lib/site-url'

export default function sitemap(): MetadataRoute.Sitemap {
  const site = getSiteUrl()
  if (!site) return []
  const paths = ['/', '/destinations', ...DESTINATIONS.map(destinationHref), ...(FAQ_ENTRIES.length ? ['/faq'] : [])]
  return paths.map((p) => ({ url: new URL(p, site).toString() }))
}
