/**
 * Public origin for canonical URLs, Open Graph and the sitemap. No domain is purchased yet, so this
 * comes from NEXT_PUBLIC_SITE_URL; without it, the site stays out of search indexes (see robots.ts).
 */
export function getSiteUrl(env: Record<string, string | undefined> = process.env): URL | null {
  const raw = env.NEXT_PUBLIC_SITE_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url : null
  } catch {
    return null
  }
}
