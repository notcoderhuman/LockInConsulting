import { describe, expect, it } from 'vitest'
import { OFFICIAL_RESOURCES, UNRESOLVED_OFFICIAL_LINKS, getOfficialResources } from '@/lib/content/official-resources'
import { DESTINATIONS } from '@/lib/destinations'

describe('OFFICIAL_RESOURCES', () => {
  it('gives every destination at least two checked official links', () => {
    for (const d of DESTINATIONS) expect(getOfficialResources(d.iso2).length, d.shortName).toBeGreaterThanOrEqual(2)
  })

  it('only uses https links for known destinations, each with a check date', () => {
    const isos = new Set(DESTINATIONS.map((d) => d.iso2))
    for (const r of OFFICIAL_RESOURCES) {
      expect(r.url.startsWith('https://')).toBe(true)
      expect(isos.has(r.iso2)).toBe(true)
      expect(r.linkCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(new Set(OFFICIAL_RESOURCES.map((r) => r.url)).size).toBe(OFFICIAL_RESOURCES.length)
  })

  it('keeps unresolved / WAF-blocked links out of public OFFICIAL_RESOURCES', () => {
    const publicUrls = new Set(OFFICIAL_RESOURCES.map((r) => r.url))
    expect(UNRESOLVED_OFFICIAL_LINKS.length).toBeGreaterThan(0)
    for (const u of UNRESOLVED_OFFICIAL_LINKS) {
      expect(publicUrls.has(u.url), u.url).toBe(false)
      expect(u.url.startsWith('https://')).toBe(true)
      expect(u.lastAttemptedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(u.status.length).toBeGreaterThan(0)
    }
  })
})
