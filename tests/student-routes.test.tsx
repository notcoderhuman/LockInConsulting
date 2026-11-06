// Homepage → Chat Now → /auth (Continue with Email | Continue with Google) → /chat, and the presence label the chat
// shows. Rendering only; the database-backed parts are in tests/db/support.db.test.ts.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))

const { ChatCta, CHAT_NOW_HREF } = await import('@/components/home/chat-cta')
const { AuthPanel } = await import('@/components/support/auth-panel')
const { StudentOnboarding } = await import('@/components/support/student-onboarding')
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
    for (const embedded of ['AuthPanel', 'StudentChat', 'HomeChat', 'getStudentPageContext']) expect(page, embedded).not.toContain(embedded)

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

describe('/auth', () => {
  const closed = getIdentityProviderStatus({})
  const google = getIdentityProviderStatus({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', STUDENT_ACCOUNTS_ENABLED: 'true' })
  const googleClosed = getIdentityProviderStatus({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })
  const render = (props: Partial<Parameters<typeof AuthPanel>[0]>) =>
    renderToStaticMarkup(<AuthPanel providers={google} emailCodes signUpOpen oauthError={null} next="/chat" {...props} />)

  it('offers exactly two methods, email and Google, and no password anywhere', () => {
    const html = render({})
    expect(html).toContain('Continue with Email')
    expect(html).toContain('Continue with Google')
    expect(html).not.toMatch(/type="password"|current-password|new-password|Forgot|password/i)
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('tester')
    expect(html).not.toContain('New student accounts aren’t open yet')
  })

  it('shows only methods that work: no Google button until it is configured and open, no email button without mail', () => {
    expect(render({ providers: googleClosed })).not.toContain('Continue with Google')
    expect(render({ providers: closed })).not.toContain('Continue with Google')
    expect(render({ emailCodes: false })).not.toContain('Continue with Email')
    expect(render({ providers: closed, emailCodes: false })).toContain('Sign-in isn’t available right now')
  })

  it('says plainly that new accounts are closed while the sign-up gate is shut, without hiding sign-in', () => {
    const html = render({ signUpOpen: false })
    expect(html).toContain('New student accounts aren’t open yet.')
    expect(html).toContain('Continue with Email')
    expect(html).toContain('Continue with Google')
  })

  it('shows a readable OAuth error and never echoes the raw code', () => {
    const html = render({ oauthError: 'Google sign-in was cancelled. You can try again whenever you’re ready.' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Google sign-in was cancelled.')
  })
})

describe('first-time onboarding', () => {
  it('asks for name, 18+ and consent, and never for a password', () => {
    const html = renderToStaticMarkup(<StudentOnboarding name="" />)
    expect(html).toContain('Your full name')
    expect(html).toContain('I am 18 or older.')
    expect(html).toMatch(/name="privacy"/)
    expect(html).not.toMatch(/password/i)
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
