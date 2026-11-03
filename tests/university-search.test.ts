import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseLookupKeys, parseSearch } from '@/lib/data/search'
import { addItem, clearList, LIST_LIMIT, parseList, readList, removeItem, renameItem, STORAGE_KEYS, storageAvailable } from '@/lib/device-lists'
import { GET as searchRoute } from '@/app/api/universities/search/route'
import { GET as lookupRoute } from '@/app/api/universities/lookup/route'

const qs = (s: string) => new URLSearchParams(s)

describe('search request parsing', () => {
  it('fills defaults and accepts the documented filters', () => {
    expect(parseSearch(qs(''))).toEqual({ q: '', destination: null, status: null, category: null, sort: 'relevance', offset: 0 })
    expect(parseSearch(qs('q=berlin&destination=DE&status=checked&category=other&sort=status&offset=20'))).toEqual({
      q: 'berlin', destination: 'DE', status: 'checked', category: 'other', sort: 'status', offset: 20,
    })
    expect(parseSearch(qs('destination=&status='))?.destination).toBeNull()
  })

  it('refuses anything else, including ranking sorts', () => {
    for (const bad of ['sort=qs', 'sort=ranking', 'destination=XX', 'destination=de', 'status=published', 'offset=7', 'offset=-20', 'offset=5000', `q=${'a'.repeat(81)}`])
      expect(parseSearch(qs(bad)), bad).toBeNull()
  })

  it('accepts lookup keys only as known destination + well-formed slug, at most 50', () => {
    expect(parseLookupKeys(qs('u=DE:freie-universitat-berlin&u=US:mit'))).toEqual([
      { destinationIso2: 'DE', slug: 'freie-universitat-berlin' },
      { destinationIso2: 'US', slug: 'mit' },
    ])
    for (const bad of ['u=XX:a', 'u=DE:Bad_Slug', 'u=DE', 'u=DE:a:b', 'u=DE:'] ) expect(parseLookupKeys(qs(bad)), bad).toBeNull()
    expect(parseLookupKeys(qs(Array.from({ length: 51 }, (_, i) => `u=DE:u${i}`).join('&')))).toBeNull()
  })
})

describe('search and lookup routes', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('answer 400 to malformed requests and 503 without a database, never invented results', async () => {
    vi.stubEnv('DATABASE_URL', '')
    expect((await searchRoute(new Request('http://x/api/universities/search?sort=qs'))).status).toBe(400)
    expect((await lookupRoute(new Request('http://x/api/universities/lookup?u=XX:a'))).status).toBe(400)
    const res = await searchRoute(new Request('http://x/api/universities/search?q=berlin'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Search is unavailable right now.' })
    expect((await lookupRoute(new Request('http://x/api/universities/lookup?u=DE:a'))).status).toBe(503)
  })
})

// A minimal browser: localStorage backed by a Map, plus window events.
function fakeWindow({ blocked = false } = {}) {
  const store = new Map<string, string>()
  const events = new EventTarget()
  const deny = () => {
    throw new DOMException('blocked', 'SecurityError')
  }
  vi.stubGlobal('window', {
    localStorage: blocked
      ? { getItem: deny, setItem: deny, removeItem: deny }
      : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  })
  return store
}
const uni = (slug: string, destinationIso2 = 'DE') => ({ destinationIso2, slug, name: `Name ${slug}` })

describe('device-only saved and recently viewed lists', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = fakeWindow()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps newest first, moves a repeat to the top and caps each list', () => {
    addItem('recent', uni('a'))
    addItem('recent', uni('b'))
    addItem('recent', uni('a'))
    expect(readList('recent').map((i) => i.slug)).toEqual(['a', 'b'])
    for (let i = 0; i < 15; i++) addItem('recent', uni(`u${i}`))
    expect(readList('recent')).toHaveLength(LIST_LIMIT.recent)
    expect(readList('recent')[0].slug).toBe('u14')
  })

  it('stores only public identity fields under versioned keys, and removes or clears', () => {
    addItem('saved', uni('a'))
    addItem('saved', uni('b', 'US'))
    expect(Object.keys(JSON.parse(store.get(STORAGE_KEYS.saved)!)[0]).sort()).toEqual(['at', 'destinationIso2', 'name', 'slug'])
    removeItem('saved', { destinationIso2: 'US', slug: 'b' })
    expect(readList('saved').map((i) => i.slug)).toEqual(['a'])
    renameItem('saved', { destinationIso2: 'DE', slug: 'a' }, 'Renamed')
    expect(readList('saved')[0].name).toBe('Renamed')
    clearList('saved')
    expect(store.has(STORAGE_KEYS.saved)).toBe(false)
  })

  it('drops corrupt, foreign or hand-edited data instead of trusting it', () => {
    expect(parseList('not json', 'saved')).toEqual([])
    expect(parseList('{"a":1}', 'saved')).toEqual([])
    const good = { destinationIso2: 'DE', slug: 'ok', name: 'OK', at: 1 }
    const bad = [{ ...good, slug: '../admin' }, { ...good, destinationIso2: 'de' }, { ...good, name: '' }, { ...good, at: 'x' }, null, 'x']
    expect(parseList(JSON.stringify([good, ...bad]), 'saved')).toEqual([good])
  })

  it('reports blocked storage instead of failing', () => {
    vi.unstubAllGlobals()
    fakeWindow({ blocked: true })
    expect(storageAvailable()).toBe(false)
    expect(addItem('saved', uni('a'))).toBe(false)
    expect(readList('saved')).toEqual([])
  })

  it('announces changes so other components re-read the list', () => {
    const seen = vi.fn()
    window.addEventListener('lockin:device-lists', seen)
    addItem('saved', uni('a'))
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
