import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryEntry } from '@/lib/data/types'

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  useRouter: () => ({ push: () => {} }),
}))
vi.mock('@/lib/data/directory', () => ({ getUniversityProfile: vi.fn() }))

const { getUniversityProfile } = await import('@/lib/data/directory')
const page = await import('@/app/destinations/[slug]/universities/[university]/page')
const { profileText } = await import('@/lib/data/profile-text')
const { signInFieldErrors } = await import('@/lib/identity/sign-in-validation')
const { PasswordInput } = await import('@/components/ui/password-input')
const mocked = vi.mocked(getUniversityProfile)

const checked: DirectoryEntry = {
  listing: 'provisional', id: 1, slug: 'checked-university', name: 'Checked University', identityStatus: 'checked',
  category: 'university', officialWebsite: 'https://uni.example/', city: 'Synthville', identityCheckedAt: '2026-10-18',
}
const pending: DirectoryEntry = { ...checked, slug: 'pending-university', name: 'Pending University', identityStatus: 'pending', officialWebsite: null, city: null, identityCheckedAt: null }
const source = { url: 'https://uni.example/about', title: 'About', publisher: 'Example University', checkedAt: '2026-10-20' }
const verified: DirectoryEntry = {
  listing: 'verified', id: 2, slug: 'verified-university', name: 'Verified University', officialWebsite: 'https://v.example/', city: 'Berlin', subRegion: null,
  institutionType: 'public', source, courses: [], acceptanceRates: [],
  rankings: [{ id: 9, providerName: 'QS World University Rankings', year: 2026, edition: null, subject: '', position: 42, bandLow: null, bandHigh: null, attribution: 'QS attribution', aiUseAllowed: false, source }],
}
const params = (university: string, slug = 'germany') => ({ params: Promise.resolve({ slug, university }) })
const render = async (p: ReturnType<typeof params>) => renderToStaticMarkup(await page.default(p))

afterEach(() => mocked.mockReset())

describe('university profile page', () => {
  it('404s for an unknown destination, an unknown university and a database without configuration', async () => {
    await expect(page.default(params('x', 'dubai'))).rejects.toThrow('NEXT_NOT_FOUND')
    mocked.mockResolvedValue({ state: 'ready', entry: null })
    await expect(page.default(params('no-such-university'))).rejects.toThrow('NEXT_NOT_FOUND')
    mocked.mockResolvedValue({ state: 'not_configured' })
    await expect(page.default(params('checked-university'))).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('asks search engines not to index candidate listings, and allows verified profiles', async () => {
    mocked.mockResolvedValue({ state: 'ready', entry: checked })
    expect((await page.generateMetadata(params('checked-university'))).robots).toEqual({ index: false, follow: true })
    mocked.mockResolvedValue({ state: 'ready', entry: verified })
    const meta = await page.generateMetadata(params('verified-university'))
    expect(meta.robots).toBeUndefined()
    expect(meta.alternates?.canonical).toBe('/destinations/germany/universities/verified-university')
    mocked.mockResolvedValue({ state: 'ready', entry: null })
    expect((await page.generateMetadata(params('nope'))).robots).toEqual({ index: false })
  })

  it('labels a website-checked candidate as not verified, with one h1 and no courses, fees or rankings', async () => {
    mocked.mockResolvedValue({ state: 'ready', entry: checked })
    const html = await render(params('checked-university'))
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('Candidate listing')
    expect(html).not.toMatch(/<li[^>]*>(Not yet verified|Verified|Identity\/source check pending)<\/li>/) // no public status badge
    expect(html).not.toMatch(/Verified profile|#\d+|Tuition<|Acceptance rate/)
  })

  it('shows a pending candidate by name only', async () => {
    mocked.mockResolvedValue({ state: 'ready', entry: pending })
    const html = await render(params('pending-university'))
    expect(html).not.toContain('>Identity/source check pending</li>')
    expect(html).not.toContain('uni.example')
  })

  it('shows an honest message, not a 404, when the database fails', async () => {
    mocked.mockResolvedValue({ state: 'error' })
    expect(await render(params('checked-university'))).toContain('temporarily unavailable')
  })
})

describe('copied university information', () => {
  it('carries the check date for a website-checked candidate, says what is not shown, and no verification status', () => {
    const text = profileText(checked, 'Germany', 'https://site.example/p')
    expect(text).toContain('Official website checked 18 Oct 2026.')
    expect(text).toContain('Official website: https://uni.example/')
    expect(text).toContain('still being checked, so not shown')
    expect(text).toContain('LockIn page: https://site.example/p')
    expect(text).not.toMatch(/verified|Status:/i)
  })

  it('never includes a website or city for a pending candidate', () => {
    const text = profileText({ ...pending, officialWebsite: 'https://leak.example/', city: 'Leakville' }, 'Germany', 'u')
    expect(text).toContain('The official website has not been confirmed yet.')
    expect(text).not.toMatch(/leak|verified|Status:/i)
  })

  it('cites the source for a published profile, with no verification status, and leaves rankings out', () => {
    const text = profileText(verified, 'Germany', 'u')
    expect(text).toContain('Source: Example University, https://uni.example/about')
    // The synthetic fixture is named "Verified University", so look for status wording, not the word.
    expect(text).not.toMatch(/QS|#42|Status:|Verified by|Verified courses/)
  })
})

describe('sign-in validation', () => {
  it('names the field to fix without saying whether an account exists', () => {
    expect(signInFieldErrors('', '')).toEqual({ email: ['Enter your email address.'], password: ['Enter your password.'] })
    expect(signInFieldErrors('not-an-email', 'x').email?.[0]).toMatch(/name@example\.com/)
    expect(signInFieldErrors(' a@b.co ', 'short', 12)).toEqual({ password: ['Passwords here are at least 12 characters.'] })
    expect(signInFieldErrors('a@b.co', 'long-enough-password', 12)).toEqual({})
  })

  it('renders the password masked by default with an accessible toggle', () => {
    const html = renderToStaticMarkup(<PasswordInput id="pw" name="password" />)
    expect(html).toContain('type="password"')
    expect(html).toContain('aria-label="Show password"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-controls="pw"')
  })
})
