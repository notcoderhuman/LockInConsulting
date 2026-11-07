// The public QS directory: request parsing, rank text and what a card may show. Database behaviour (licence gate,
// 50 per destination, ties, bands, verified flag) is in tests/db/qs-directory.db.test.ts.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))

const { DIRECTORY_DESTINATIONS, parseQsRequest, QS_ATTRIBUTION } = await import('@/lib/data/qs-directory')
const { rankText } = await import('@/lib/db/qs-directory-queries')
const { QsDirectory } = await import('@/components/directory/qs-directory')

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8')

describe('destinations and requests', () => {
  it('offers exactly the eleven destinations', () => {
    expect(DIRECTORY_DESTINATIONS.map((d) => d.iso2).sort()).toEqual(['AE', 'AU', 'CA', 'DE', 'FI', 'GB', 'IT', 'NZ', 'PL', 'SA', 'US'])
    expect(DIRECTORY_DESTINATIONS).toHaveLength(11)
  })

  it('accepts only known destinations and sane search and offset values', () => {
    expect(parseQsRequest(new URLSearchParams('d=gb&q=ox&offset=25'))).toEqual({ iso2: 'GB', q: 'ox', offset: 25 })
    expect(parseQsRequest(new URLSearchParams('d=AE'))).toEqual({ iso2: 'AE', q: '', offset: 0 })
    for (const bad of ['', 'd=xx', 'd=gb&offset=-1', 'd=gb&offset=abc', 'd=gb&offset=999999', 'd=../etc', 'd=gb%27%20OR%201=1']) expect(parseQsRequest(new URLSearchParams(bad)), bad).toBeNull()
    expect(parseQsRequest(new URLSearchParams(`d=gb&q=${'x'.repeat(200)}`))!.q).toHaveLength(80)
  })
})

describe('rank text', () => {
  it('prints the rank exactly as QS does: plain, tie, band and open band', () => {
    expect(rankText(null, 4)).toBe('#4')
    expect(rankText('4', 4)).toBe('#4')
    expect(rankText('=45', 45)).toBe('=45')
    expect(rankText('731-740', 731)).toBe('731-740')
    expect(rankText('1401+', 1401)).toBe('1401+')
    // A band stored without a label still shows as a band, never as an exact rank.
    expect(rankText(null, 731, 740)).toBe('731-740')
  })
})

describe('the page', () => {
  const props = { destinations: DIRECTORY_DESTINATIONS, initial: 'GB', attribution: QS_ATTRIBUTION }

  it('renders a loading state first, with all eleven destination buttons and a search box', () => {
    const html = renderToStaticMarkup(<QsDirectory {...props} />)
    expect(html.match(/aria-pressed/g)).toHaveLength(11)
    expect(html).toMatch(/aria-pressed="true"[^>]*>UK</)
    expect(html).toContain('type="search"')
    expect(html).toContain('aria-label="Loading universities"')
    expect(html).not.toContain('Verified')
  })

  it('has the exact QS attribution, linked to the QS rankings page, and no QS logo', () => {
    expect(QS_ATTRIBUTION).toEqual({
      text: 'Source: QS Quacquarelli Symonds (www.topuniversities.com). With permission.',
      url: 'https://www.topuniversities.com/world-university-rankings',
    })
    const source = read('components/directory/qs-directory.tsx')
    expect(source).toContain('attribution.text')
    expect(source).toContain('href={attribution.url}')
    expect(source).not.toMatch(/<img|next\/image|qs-logo|qs\.svg|QS badge/i)
  })

  it('puts only the name, the rank and a LockIn verified badge on a card', () => {
    const source = read('components/directory/qs-directory.tsx')
    const card = source.slice(source.indexOf('{cards.map('), source.indexOf('</ol>'))
    for (const field of ['c.name', 'c.rank', 'c.verified']) expect(card).toContain(field)
    // Nothing else about a university is available to render: the API returns only these three fields.
    expect([...new Set(card.match(/\bc\.\w+/g))].sort()).toEqual(['c.name', 'c.rank', 'c.verified'])
    expect(card).toContain('Verified')
    expect(card).not.toMatch(/website|tuition|country|city|admission|review|status|course|fee/i)
  })

  it('says plainly when the directory is not published yet, when a search finds nothing, and when it fails', () => {
    const source = read('components/directory/qs-directory.tsx')
    expect(source).toContain('The university directory is being prepared')
    expect(source).toContain('No universities in ')
    expect(source).toContain('The directory could not be loaded.')
    expect(source).toContain('Try again')
  })
})

describe('retired research pages', () => {
  it('no longer link the old destination explorer from the header', () => {
    const header = read('components/site/site-header.tsx')
    expect(header).not.toContain("'/destinations'")
    expect(header).toContain("'/universities'")
  })

  it('exposes only name, rank and verified through the public API', () => {
    const route = read('app/api/qs-directory/route.ts')
    expect(route).toContain('getQsDirectory')
    const queries = read('lib/db/qs-directory-queries.ts')
    expect(queries).toContain('FROM public_qs_directory')
    expect(queries).not.toMatch(/FROM (universities|university_rankings|ranking_providers)\b/)
  })
})
