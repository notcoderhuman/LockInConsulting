import type { MetadataRoute } from 'next'
import { DESTINATIONS, destinationHref } from '@/lib/destinations'
import { getSiteUrl } from '@/lib/site-url'

export default function sitemap(): MetadataRoute.Sitemap {
  const site = getSiteUrl()
  if (!site) return []
  const paths = ['/', '/destinations', ...DESTINATIONS.map(destinationHref)]
  return paths.map((p) => ({ url: new URL(p, site).toString() }))
}
