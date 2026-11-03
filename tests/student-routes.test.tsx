// Homepage → Chat Now → /auth (Sign in | Create account) → /chat, and the presence label the chat
// shows. Rendering only; the database-backed parts are in tests/db/support.db.test.ts.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))

const { ChatCta, CHAT_NOW_HREF } = await import('@/components/home/chat-cta')
const { AuthTabs } = await import('@/components/support/auth-tabs')
const { AgeConfirm } = await import('@/components/support/age-confirm')
const { presenceText } = await import('@/components/support/team-presence')
const { authPathFor, safeNextPath } = await import('@/lib/student/next-path')
const { getIdentityProviderStatus } = await import('@/lib/identity/policy')

const ROOT = path.join(__dirname, '..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

describe('homepage', () => {
  it('has a Chat Now call to action right above How It Works, and no sign-in form or chat', () => {
    const page = read('app/page.tsx')
    const order = ['<HeroExplorer />', '<ChatCta />', '<HowItWorks />', '<TeamSection />'].map((tag) => page.indexOf(tag))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    for (const embedded of ['StudentSignIn', 'StudentChat', 'AuthTabs', 'HomeChat', 'getStudentPageContext']) expect(page, embedded).not.toContain(embedded)

    const html = renderToStaticMarkup(<ChatCta />)
    expect(html).toContain('Have a question about studying abroad?')
    expect(html).toContain('If the team is unavailable, Derek can help with eligible questions.')
    expect(html).toMatch(/<a[^>]+href="\/auth\?next=%2Fchat"[^>]*>Chat Now<\/a>/)
    expect(html).not.toMatch(/<form|<input|<textarea/)
    expect(CHAT_NOW_HREF).toBe('/auth?next=%2Fchat')
    // The header's Chat link goes the same way.
    expect(read('components/site/site-header.tsx')).toContain("href: '/auth?next=%2Fchat'")
  })
})

describe('/auth tabs', () => {
  const closed = getIdentityProviderStatus({})
  const google = getIdentityProviderStatus({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', STUDENT_ACCOUNTS_ENABLED: 'true' })
  const googleClosed = getIdentityProviderStatus({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })
  const render = (props: Partial<Parameters<typeof AuthTabs>[0]>) =>
    renderToStaticMarkup(<AuthTabs initialTab="signin" providers={closed} signUpOpen={false} oauthError={null} next="/chat" {...props} />)

  it('shows two labelled tabs and only the active flow', () => {
    const signIn = render({})
    expect(signIn).toContain('role="tablist"')
    expect(signIn.match(/role="tab"/g)).toHaveLength(2)
    expect(signIn).toMatch(/aria-selected="true"[^>]*>Sign in</)
    expect(signIn).toMatch(/aria-selected="false"[^>]*>Create account</)
    expect(signIn).toContain('type="password"')
    expect(signIn).not.toContain('New student accounts aren’t open yet')

    const create = render({ initialTab: 'create' })
    expect(create).toMatch(/aria-selected="true"[^>]*>Create account</)
    expect(create).not.toContain('type="password"') // the sign-in form is not mixed in
  })

  it('says plainly that sign-up is closed while STUDENT_SELF_SIGNUP_ENABLED is off, even with Google configured', () => {
    for (const providers of [closed, google]) {
      const html = render({ initialTab: 'create', providers, signUpOpen: false })
      expect(html).toContain('New student accounts aren’t open yet.')
      expect(html).not.toContain('Continue with Google')
    }
    // Open: Create account goes to the 18+ confirmation first, never straight to Google (D-045).
    const open = render({ initialTab: 'create', providers: google, signUpOpen: true })
    expect(open).toContain('href="/age-confirm?next=%2Fchat"')
    expect(open).not.toContain('Continue with Google')
    expect(open).toMatch(/confirm that you are 18 or older/)
  })

  it('offers Google sign-in only while student accounts are open, even when its credentials are set', () => {
    expect(render({ providers: google })).not.toContain('Continue with Google — unavailable')
    const closedHtml = render({ providers: googleClosed })
    expect(closedHtml).toMatch(/<button type="button" disabled=""[^>]*>Continue with Google — unavailable</)
    expect(closedHtml).toContain('Google sign-in opens when student accounts open.')
    expect(closedHtml).not.toContain('STUDENT_ACCOUNTS_ENABLED')
  })

  it('shows a readable OAuth error and never echoes the raw code', () => {
    const html = render({ oauthError: 'Google sign-in was cancelled. You can try again whenever you’re ready.' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Google sign-in was cancelled.')
  })
})

describe('safe return path', () => {
  it('only ever returns to the student chat', () => {
    expect(safeNextPath('/chat')).toBe('/chat')
    expect(safeNextPath('/chat?c=12')).toBe('/chat?c=12')
    for (const bad of [undefined, '', '/', '/admin', '//evil.example', 'https://evil.example/chat', '/chat?c=0', '/chat?c=1&next=//x', '/chat/../admin', '/%2F%2Fevil', ' /chat', '/chat?c=1#x'])
      expect(safeNextPath(bad), String(bad)).toBe('/chat')
    expect(authPathFor('/chat?c=5')).toBe('/auth?next=%2Fchat%3Fc%3D5')
    expect(authPathFor('https://evil.example')).toBe('/auth?next=%2Fchat')
  })
})

describe('team presence label', () => {
  it('is truthful about who is there and what Derek can do', () => {
    expect(presenceText(null)).toMatchObject({ tone: 'amber', label: 'Connecting…' })
    expect(presenceText({ state: 'online', name: 'Dev', derekAvailable: true })).toEqual({ tone: 'green', label: 'Dev is online', detail: null })
    expect(presenceText({ state: 'online', name: null, derekAvailable: true }).label).toBe('The LockIn team is online')
    expect(presenceText({ state: 'reconnecting', name: 'Dev', derekAvailable: true })).toMatchObject({ tone: 'amber', label: 'Dev may have disconnected · reconnecting…' })
    expect(presenceText({ state: 'offline', name: 'Dev', derekAvailable: true })).toMatchObject({ tone: 'grey', label: 'Dev is offline', detail: expect.stringMatching(/Derek/) })
    // When Derek cannot really answer, nothing pretends he will.
    expect(presenceText({ state: 'offline', name: 'Dev', derekAvailable: false }).detail).toBe('Leave your question here: the team will reply when they are back.')
  })
})

describe('/age-confirm (D-045)', () => {
  const render = (privacyUrl: string | null = null) => renderToStaticMarkup(<AgeConfirm next="/chat" back="/auth?tab=create&next=%2Fchat" privacyUrl={privacyUrl} />)
  it('starts unchecked with the continue button disabled, and asks for nothing but the tick', () => {
    const html = render()
    expect(html).toContain('I confirm that I am 18 years of age or older.')
    expect(html).toMatch(/<input[^>]*type="checkbox"/)
    expect(html).not.toMatch(/<input[^>]*checked=""/)
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Confirm and continue</)
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Back</)
    // Only the name and the one checkbox: no date of birth, document or upload field.
    expect(html.match(/<input/g)).toHaveLength(2)
    expect(html).toContain('Your full name')
    expect(html).toMatch(/<input[^>]*autoComplete="name"/i)
    expect(html).not.toMatch(/verif(y|ied|ication) your age/i)
    expect(html).toContain('doesn’t check your age or identity')
  })
  it('links the privacy notice only when one is published', () => {
    expect(render()).not.toContain('privacy notice')
    const html = render('https://lockin.example/privacy')
    expect(html).toContain('href="https://lockin.example/privacy"')
    expect(html).toContain('(opens in a new tab)')
  })
})
