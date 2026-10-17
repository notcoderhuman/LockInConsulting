import { describe, expect, it, vi } from 'vitest'
import * as page from '@/app/destinations/[slug]/page'
import { DESTINATIONS, destinationHref, getAdjacentDestinations, getDestinationBySlug } from '@/lib/destinations'

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  useRouter: () => ({ push: () => {} }),
}))

describe('destination routing', () => {
  it('statically generates exactly one page per destination', () => {
    const params = page.generateStaticParams()
    expect(params).toHaveLength(11)
    expect(params.map((p) => p.slug).sort()).toEqual(
      ['australia', 'canada', 'finland', 'germany', 'italy', 'new-zealand', 'poland', 'saudi-arabia', 'uae', 'uk', 'usa'],
    )
  })

  it('rejects unknown slugs instead of rendering on demand', async () => {
    expect(page.dynamicParams).toBe(false)
    await expect(page.default({ params: Promise.resolve({ slug: 'dubai' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(page.default({ params: Promise.resolve({ slug: 'USA' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('routes Dubai through the UAE page', () => {
    expect(getDestinationBySlug('dubai')).toBeUndefined()
    expect(getDestinationBySlug('uae')?.subRegions?.map((s) => s.name)).toContain('Dubai')
  })

  it('builds metadata per destination and none for unknown slugs', async () => {
    const meta = await page.generateMetadata({ params: Promise.resolve({ slug: 'germany' }) })
    expect(meta.title).toContain('Germany')
    expect(meta.alternates?.canonical).toBe('/destinations/germany')
    expect(await page.generateMetadata({ params: Promise.resolve({ slug: 'nowhere' }) })).toEqual({})
  })

  it('has URL-safe unique slugs and hrefs', () => {
    const slugs = DESTINATIONS.map((d) => d.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const d of DESTINATIONS) {
      expect(d.slug).toMatch(/^[a-z]+(-[a-z]+)*$/)
      expect(destinationHref(d)).toBe(`/destinations/${d.slug}`)
    }
  })

  it('wraps previous/next navigation around the list', () => {
    const first = DESTINATIONS[0]
    const last = DESTINATIONS[DESTINATIONS.length - 1]
    expect(getAdjacentDestinations(first.iso2).previous.iso2).toBe(last.iso2)
    expect(getAdjacentDestinations(last.iso2).next.iso2).toBe(first.iso2)
    expect(() => getAdjacentDestinations('XX')).toThrow()
  })
})
