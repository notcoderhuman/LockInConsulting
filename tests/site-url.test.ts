import { describe, expect, it } from 'vitest'
import { getSiteUrl } from '@/lib/site-url'

describe('getSiteUrl: the only source of the public origin', () => {
  it('is absent unless NEXT_PUBLIC_SITE_URL is set to a valid URL', () => {
    expect(getSiteUrl({})).toBeNull()
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: '' })).toBeNull()
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: 'not a url' })).toBeNull()
  })

  it('accepts https origins in any environment', () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://www.example.org', NODE_ENV: 'production' })?.href).toBe('https://www.example.org/')
  })

  it('never lets a production build publish a localhost or plain-http origin', () => {
    for (const raw of ['http://localhost:3000', 'http://example.org'])
      expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: raw, NODE_ENV: 'production' }), raw).toBeNull()
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000', NODE_ENV: 'development' })?.host).toBe('localhost:3000')
  })
})
