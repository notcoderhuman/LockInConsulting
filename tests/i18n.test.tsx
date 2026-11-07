import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProvisionalUniversity } from '@/lib/data/types'

const cookieStore = { value: undefined as string | undefined }
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (cookieStore.value ? { value: cookieStore.value } : undefined) }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))

const { en } = await import('@/lib/i18n/en')
const { hi } = await import('@/lib/i18n/hi')
const { formatDate, toLocale, translator } = await import('@/lib/i18n')
const { LocaleProvider } = await import('@/lib/i18n/client')
const { getLocale, hindiEnabled } = await import('@/lib/i18n/server')
const { SiteHeader } = await import('@/components/site/site-header')
const { signInFieldErrors } = await import('@/lib/identity/sign-in-validation')
const { ProvisionalCard } = await import('@/components/destination/provisional-card')
const { LanguageSwitch } = await import('@/components/site/language-switch')
const { ListingStatus } = await import('@/components/universities/listing-status')

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const inHindi = (node: React.ReactNode) => renderToStaticMarkup(<LocaleProvider locale="hi">{node}</LocaleProvider>)

afterEach(() => {
  cookieStore.value = undefined
  vi.unstubAllEnvs()
})

describe('dictionaries', () => {
  it('Hindi uses the same placeholders as English for every key it translates', () => {
    for (const [key, text] of Object.entries(hi)) expect(vars(text!), key).toEqual(vars(en[key as keyof typeof en]))
  })

  it('every Hindi interface string is written in Devanagari (brand names and examples may stay in Latin script)', () => {
    const latinOnly = new Set(['language.offer', 'language.offerLabel', 'language.offerLang', 'search.sort.name', 'search.sort.name_desc'])
    for (const [key, text] of Object.entries(hi)) if (!latinOnly.has(key)) expect(text, key).toMatch(/[ऀ-ॿ]/)
  })

  it('falls back to English for a key Hindi does not have, never to the raw key', () => {
    const saved = hi['backToTop']
    delete hi['backToTop']
    try {
      expect(translator('hi')('backToTop')).toBe('Back to top')
    } finally {
      hi['backToTop'] = saved
    }
    expect(translator('hi')('backToTop')).toBe('ऊपर जाएँ')
  })

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(translator('hi')('search.showing', { n: 20, total: 431 })).toBe('431 में से 20 दिखाए जा रहे हैं।')
    expect(translator('en')('search.showing', { n: 20 })).toBe('Showing 20 of {total}.')
  })

  it('formats dates per language', () => {
    expect(formatDate('en', '2026-10-26')).toBe('26 Oct 2026')
    expect(formatDate('hi', '2026-10-26')).toMatch(/^26 .*[ऀ-ॿ].* 2026$/)
    expect(formatDate('hi', 'not-a-date')).toBe('not-a-date')
  })
})

describe('language preference', () => {
  it('accepts only the two known languages and defaults to English', () => {
    expect(toLocale('hi')).toBe('hi')
    for (const v of ['en', 'HI', 'fr', '', null, undefined, 'hi; Path=/']) expect(toLocale(v)).toBe('en')
  })

  it('reads the preference cookie on the server, English without one', async () => {
    vi.stubEnv('HINDI_UI_ENABLED', 'true')
    expect(await getLocale()).toBe('en')
    cookieStore.value = 'hi'
    expect(await getLocale()).toBe('hi')
    cookieStore.value = '<script>'
    expect(await getLocale()).toBe('en')
  })

  it('until Hindi is approved, ignores the cookie and hides the switch', async () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1']) {
      if (value === undefined) vi.unstubAllEnvs()
      else vi.stubEnv('HINDI_UI_ENABLED', value)
      cookieStore.value = 'hi'
      expect(await getLocale(), String(value)).toBe('en')
      expect(hindiEnabled(), String(value)).toBe(false)
    }
    const hidden = renderToStaticMarkup(<SiteHeader />)
    expect(hidden).not.toContain('हिन्दी में देखें')
    expect(hidden).toContain('Universities')
    const shown = renderToStaticMarkup(<LocaleProvider locale="en" languageSwitch><SiteHeader /></LocaleProvider>)
    expect(shown).toContain('aria-label="हिन्दी में देखें"')
  })

  it('offers the other language, labelled in that language', () => {
    const en = renderToStaticMarkup(<LanguageSwitch />)
    expect(en).toContain('lang="hi"')
    expect(en).toContain('aria-label="हिन्दी में देखें"')
    const hiHtml = inHindi(<LanguageSwitch />)
    expect(hiHtml).toContain('lang="en"')
    expect(hiHtml).toContain('aria-label="View in English"')
  })
})

describe('content that is never translated', () => {
  const candidate: ProvisionalUniversity = {
    listing: 'provisional', id: 7, slug: 'freie-universitat-berlin', name: 'Freie Universität Berlin', identityStatus: 'checked',
    category: 'university', officialWebsite: 'https://www.fu-berlin.de/en', city: 'Berlin', identityCheckedAt: '2026-10-26',
  }

  it('translates the card’s interface but keeps the name, city, website and QS wording as published', () => {
    const html = inHindi(<ProvisionalCard university={candidate} />)
    expect(html).toContain('lang="hi-IN"')
    expect(html).not.toContain('अभी सत्यापित नहीं') // no public status badge in either language
    expect(html).toMatch(/translate="no"[^>]*>Freie Universität Berlin</)
    expect(html).toMatch(/translate="no"[^>]*>Berlin</)
    expect(html).toContain('href="https://www.fu-berlin.de/en"')
    expect(html).toMatch(/lang="en"[^>]*>\s*QS eligibility pending verification/)
  })

  it('shows only the institution-type label in both languages, never a verification status', () => {
    const en = renderToStaticMarkup(<ListingStatus listing={{ category: 'other' }} />)
    expect(en).toContain('Other institution type')
    expect(en).not.toMatch(/Official website checked|Not yet verified|Verified/)
    const html = inHindi(<ListingStatus listing={{ category: 'other' }} />)
    expect(html).not.toContain('आधिकारिक वेबसाइट जाँची गई')
    expect(html).toContain('अन्य प्रकार का संस्थान')
    expect(renderToStaticMarkup(<ListingStatus listing={{ category: 'university' }} />)).toBe('')
  })
})

describe('form validation in Hindi', () => {
  it('names the field to fix, in Hindi, and the admin form stays English by default', () => {
    expect(signInFieldErrors('', '', 0, translator('hi'))).toEqual({ email: ['अपना ईमेल पता लिखें।'], password: ['अपना पासवर्ड लिखें।'] })
    expect(signInFieldErrors('a@b.co', 'short', 12, translator('hi')).password?.[0]).toContain('12')
    expect(signInFieldErrors('', '')).toEqual({ email: ['Enter your email address.'], password: ['Enter your password.'] })
  })
})
