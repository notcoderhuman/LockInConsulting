import { describe, expect, it, vi } from 'vitest'
import * as page from '@/app/destinations/[slug]/page'
import { DESTINATIONS, destinationHref, getAdjacentDestinations, getDestinationBySlug } from '@/lib/destinations'

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
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

  it('renders every destination as its own page with its own country-only directory', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    for (const d of DESTINATIONS) {
      const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ slug: d.slug }) }))
      expect(html, d.slug).toContain(`Universities in ${d.shortName}`)
      expect(html, d.slug).toContain('id="universities"')
      // One destination only: no destination buttons, so no other country can be listed on this page.
      expect(html, d.slug).not.toContain('aria-label="Destination"')
      expect(html.match(/type="search"/g), d.slug).toHaveLength(1)
    }
  })

  it('has no all-countries listing: /universities and university profiles go back to the country pages', async () => {
    const universities = await import('@/app/universities/page')
    expect(() => universities.default()).toThrow('NEXT_REDIRECT:/destinations')
    const record = await import('@/app/destinations/[slug]/universities/[university]/page')
    await expect(record.default({ params: Promise.resolve({ slug: 'uk' }) })).rejects.toThrow('NEXT_REDIRECT:/destinations/uk#universities')
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
