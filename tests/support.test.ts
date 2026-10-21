import { describe, expect, it } from 'vitest'
import { createProvider, getDerekStatus } from '@/lib/derek/config'
import { isStaleAcademicYear } from '@/lib/derek/evidence'
import type { EvidenceItem } from '@/lib/derek/provider'
import { BlockedGeminiProvider } from '@/lib/derek/providers/gemini'
import { MockProvider } from '@/lib/derek/providers/mock'
import { callProvider } from '@/lib/derek/runtime'
import { assessDraft, assessQuestion, redactPersonalData, unsupportedFigures } from '@/lib/derek/safeguards'
import { ACCOUNT_POLICIES, getIdentityProviderStatus, getStudentAreaStatus } from '@/lib/identity/policy'
import { attributionLabel } from '@/lib/support/attribution'
import { autoReplyActive } from '@/lib/support/settings'
import { CONVERSATION_STATUSES, nextStatus, STUDENT_STATUS_LABEL, TransitionError } from '@/lib/support/state'
import { deriveSubject, isSafeTargetPath, messageBody, newConversationInput, normaliseText, parsePageParams } from '@/lib/support/validation'

const evidence: EvidenceItem[] = [
  { ref: 'tuition_fee:7', text: 'MSc Data tuition fee (international): EUR 15000.00 per year, academic year 2026-2027', sourceUrl: 'https://uni.example/fees', checkedAt: '2026-10-01' },
  { ref: 'university_ranking:3', text: 'Example U ranking: Licensed Provider 2026: #120', sourceUrl: 'https://rank.example/', checkedAt: '2026-09-01' },
]

describe('conversation state machine', () => {
  it('reopens on a student message unless review or intervention is still pending', () => {
    expect(nextStatus('awaiting_student_reply', { type: 'student_message' })).toBe('open')
    expect(nextStatus('resolved', { type: 'student_message' })).toBe('open')
    expect(nextStatus('awaiting_human_review', { type: 'student_message' })).toBe('awaiting_human_review')
    expect(nextStatus('failed', { type: 'student_message' })).toBe('failed')
  })
  it('routes drafts and failures, and any sent reply waits for the student', () => {
    expect(nextStatus('open', { type: 'draft_needs_review' })).toBe('awaiting_human_review')
    expect(nextStatus('open', { type: 'ai_failed' })).toBe('failed')
    expect(nextStatus('awaiting_student_reply', { type: 'ai_failed' })).toBe('awaiting_student_reply')
    expect(() => nextStatus('resolved', { type: 'draft_needs_review' })).toThrow(TransitionError)
    for (const s of CONVERSATION_STATUSES) expect(nextStatus(s, { type: 'reply_sent' })).toBe('awaiting_student_reply')
  })
  it('lets staff set only manual statuses, and never a no-op', () => {
    expect(nextStatus('open', { type: 'staff_set', to: 'resolved' })).toBe('resolved')
    expect(() => nextStatus('open', { type: 'staff_set', to: 'awaiting_student_reply' })).toThrow(/automatically/)
    expect(() => nextStatus('open', { type: 'staff_set', to: 'open' })).toThrow(/already/)
  })
  it('never exposes internal review or failure states to students', () => {
    expect(STUDENT_STATUS_LABEL.failed).toBe(STUDENT_STATUS_LABEL.open)
    expect(STUDENT_STATUS_LABEL.awaiting_human_review).toBe(STUDENT_STATUS_LABEL.open)
  })
})

describe('message validation', () => {
  it('normalises text and strips invisible and bidi control characters', () => {
    expect(normaliseText('  Hi\r\nthere​‮\u0007  ')).toBe('Hi\nthere')
    expect(normaliseText('a\n\n\n\n\n\nb')).toBe('a\n\n\nb')
  })
  it('enforces size and non-empty bodies', () => {
    expect(messageBody.safeParse('x'.repeat(4000)).success).toBe(true)
    expect(messageBody.safeParse('x'.repeat(4001)).success).toBe(false)
    expect(messageBody.safeParse(' ​ ').success).toBe(false)
    expect(messageBody.safeParse(42).success).toBe(false)
    expect(newConversationInput.safeParse({ body: 'Hi', clientRequestId: 'short' }).success).toBe(false)
  })
  it('derives a bounded subject and safe pagination', () => {
    expect(deriveSubject(undefined, 'First line\nsecond')).toBe('First line')
    expect(deriveSubject('', 'y'.repeat(300))).toHaveLength(160)
    expect(parsePageParams(new URL('https://x/?before=-3&limit=999'))).toEqual({ before: null, limit: 50 })
    expect(parsePageParams(new URL('https://x/?before=12'))).toEqual({ before: 12, limit: 30 })
  })
  it('allows only same-site notification targets', () => {
    expect(isSafeTargetPath('/admin/inbox/3')).toBe(true)
    expect(isSafeTargetPath('/support?c=3')).toBe(true)
    for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example', 'admin'])
      expect(isSafeTargetPath(bad)).toBe(false)
  })
})

describe('Derek safeguards', () => {
  it('flags visa, distress and payment questions as high risk', () => {
    expect(assessQuestion('Will my student visa be approved?', []).level).toBe('high')
    expect(assessQuestion('I feel hopeless and want to hurt myself', []).level).toBe('high')
    expect(assessQuestion('How do I pay the fee?', evidence).level).toBe('high')
  })
  it('marks factual questions without verified evidence as uncertain', () => {
    expect(assessQuestion('What is the ranking of Nowhere U?', [])).toMatchObject({ level: 'uncertain', reasons: ['No verified evidence for rankings'] })
    expect(assessQuestion('What are my chances of admission?', evidence).level).toBe('uncertain')
    expect(assessQuestion('What are the tuition fees?', evidence).level).toBe('low')
  })
  it('accepts figures quoted from evidence and rejects invented ones', () => {
    expect(unsupportedFigures('The fee is EUR 15000.00 per year (checked 2026-10-01) and it ranks #120.', evidence)).toEqual([])
    expect(unsupportedFigures('The fee is EUR 14,000 and the acceptance rate is 12%. IELTS 6.5 is required. Ranked #3.', evidence)).toEqual(
      expect.arrayContaining(['EUR 14,000', '12%', 'IELTS 6.5', 'Ranked #3']),
    )
    // A URL containing digits is not a claim.
    expect(unsupportedFigures('See https://uni.example/fees/2099/12345', evidence)).toEqual([])
  })
  it('escalates guarantees, outcome predictions, INR conversions and model uncertainty', () => {
    const q = assessQuestion('Tell me about the course', evidence)
    expect(assessDraft('Admission is guaranteed for you.', q, evidence).level).toBe('high')
    expect(assessDraft('Your visa will be approved.', q, evidence).level).toBe('high')
    expect(assessDraft('That is about INR 1350000 per year.', q, evidence).level).toBe('high')
    expect(assessDraft('I am not sure.', q, evidence, { modelUncertain: true }).level).toBe('uncertain')
    expect(assessDraft('The programme is taught in English.', q, evidence).level).toBe('low')
  })
  it('redacts contact details before anything reaches a provider', () => {
    expect(redactPersonalData('Mail me at asha@example.com or +91 98765 43210, passport K1234567')).toBe(
      'Mail me at [email removed] or [number removed], passport [document number removed]',
    )
  })
  it('treats fees for an academic year that has ended as stale', () => {
    expect(isStaleAcademicYear('2024-2025', '2026-10-21')).toBe(true)
    expect(isStaleAcademicYear('2025', '2026-10-21')).toBe(true)
    expect(isStaleAcademicYear('2025/26', '2026-10-21')).toBe(false)
    expect(isStaleAcademicYear('2026-2027', '2026-10-21')).toBe(false)
    expect(isStaleAcademicYear(null, '2026-10-21')).toBe(false)
  })
})

describe('Derek configuration fails closed', () => {
  it('is disabled by default and builds no provider', () => {
    const status = getDerekStatus({})
    expect(status.state).toBe('disabled')
    expect(status.autoReply.permitted).toBe(false)
    expect(createProvider(status)).toBeNull()
  })
  it('keeps Gemini blocked even when explicitly selected', async () => {
    const status = getDerekStatus({ DEREK_AI_ENABLED: 'true', DEREK_PROVIDER: 'gemini', DEREK_AUTO_REPLY_CLEARED: 'true' })
    expect(status).toMatchObject({ state: 'blocked', providerId: 'gemini', autoReply: { permitted: false } })
    expect(createProvider(status)).toBeNull()
    await expect(new BlockedGeminiProvider().generate()).rejects.toMatchObject({ code: 'blocked', retryable: false })
  })
  it('refuses the mock provider in production and an unknown provider anywhere', () => {
    expect(getDerekStatus({ DEREK_AI_ENABLED: 'true', DEREK_PROVIDER: 'mock', NODE_ENV: 'production' }).state).toBe('blocked')
    expect(getDerekStatus({ DEREK_AI_ENABLED: 'true', DEREK_PROVIDER: 'openai' }).state).toBe('blocked')
    expect(getDerekStatus({ DEREK_AI_ENABLED: 'true' }).state).toBe('blocked')
  })
  it('permits automatic replies only with every gate open', () => {
    const drafting = getDerekStatus({ DEREK_AI_ENABLED: 'true', DEREK_PROVIDER: 'mock', NODE_ENV: 'test' })
    expect(drafting).toMatchObject({ state: 'ready', autoReply: { permitted: false } })
    const cleared = getDerekStatus({ DEREK_AI_ENABLED: 'true', DEREK_PROVIDER: 'mock', NODE_ENV: 'test', DEREK_AUTO_REPLY_CLEARED: 'true' })
    expect(cleared.autoReply.permitted).toBe(true)
    const on = { mode: 'offline' as const, autoReplyEnabled: true, updatedBy: null, updatedAt: '' }
    expect(autoReplyActive(on, cleared)).toBe(true)
    expect(autoReplyActive({ ...on, mode: 'online' }, cleared)).toBe(false)
    expect(autoReplyActive({ ...on, autoReplyEnabled: false }, cleared)).toBe(false)
    expect(autoReplyActive(on, drafting)).toBe(false)
  })
})

describe('provider timeout and retry policy', () => {
  const req = { question: 'q', history: [], evidence: [], instructions: '' }
  it('times out a hanging provider and retries once', async () => {
    const hang = new MockProvider({ kind: 'hang' })
    const out = await callProvider(hang, req, { timeoutMs: 20, retryDelayMs: 0 })
    expect(out).toMatchObject({ ok: false, code: 'timeout', attempts: 2 })
    expect(hang.calls).toBe(2)
  })
  it('does not retry a non-retryable error', async () => {
    const p = new MockProvider({ kind: 'fail', code: 'blocked', retryable: false })
    expect(await callProvider(p, req, { retryDelayMs: 0 })).toMatchObject({ ok: false, code: 'blocked', attempts: 1 })
  })
  it('recovers from one transient failure and reports usage', async () => {
    const p = new MockProvider({ kind: 'fail', code: 'rate_limited', retryable: true, times: 1 })
    const out = await callProvider(p, req, { retryDelayMs: 0 })
    expect(out).toMatchObject({ ok: true, attempts: 2 })
    if (out.ok) expect(out.result.usage?.inputTokens).toBe(1)
  })
  it('rejects an empty response and hides unexpected errors behind a code', async () => {
    expect(await callProvider(new MockProvider({ kind: 'fixed', text: '   ' }), req, { retryDelayMs: 0 })).toMatchObject({ ok: false, code: 'invalid_response' })
    const throwing = { id: 'x', model: 'x', generate: async () => { throw new Error('secret key sk-123 leaked in message') } }
    const out = await callProvider(throwing, req)
    expect(out).toEqual({ ok: false, code: 'provider_error', attempts: 1, latencyMs: expect.any(Number) })
    expect(JSON.stringify(out)).not.toContain('sk-123')
  })
  it('the default mock answers "unknown" without evidence and quotes evidence otherwise', async () => {
    const none = await new MockProvider().generate(req, { signal: new AbortController().signal })
    expect(none).toMatchObject({ uncertain: true })
    expect(none.text).toMatch(/won’t guess/)
    const quoted = await new MockProvider().generate({ ...req, evidence }, { signal: new AbortController().signal })
    expect(unsupportedFigures(quoted.text, evidence)).toEqual([])
  })
})

describe('identity policies', () => {
  it('keeps every account type closed to self-sign-up and students disabled', () => {
    for (const p of Object.values(ACCOUNT_POLICIES)) expect(p.selfSignUp).toBe(false)
    expect(ACCOUNT_POLICIES.student.provisioning).toBe('disabled')
    expect(getStudentAreaStatus({}, true)).toEqual({ enabled: false, reason: 'student_accounts_disabled' })
    expect(getStudentAreaStatus({ STUDENT_ACCOUNTS_ENABLED: 'true' }, false)).toEqual({ enabled: false, reason: 'auth_not_configured' })
    expect(getStudentAreaStatus({ STUDENT_ACCOUNTS_ENABLED: 'true' }, true)).toEqual({ enabled: true })
    expect(getStudentAreaStatus({ STUDENT_ACCOUNTS_ENABLED: '1' }, true).enabled).toBe(false)
  })
  it('never reports a social provider as operational', () => {
    const none = getIdentityProviderStatus({})
    expect(none.map((p) => [p.id, p.state])).toEqual([
      ['google', 'not_configured'],
      ['microsoft', 'not_configured'],
      ['yahoo', 'not_configured'],
      ['apple', 'deferred'],
    ])
    const supplied = getIdentityProviderStatus({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', APPLE_CLIENT_ID: 'x' })
    expect(supplied.find((p) => p.id === 'google')?.state).toBe('credentials_supplied_untested')
    expect(supplied.find((p) => p.id === 'apple')?.state).toBe('deferred')
    expect(JSON.stringify(supplied)).not.toContain('secret')
  })
})

describe('message attribution', () => {
  it('labels humans as humans and Derek as Derek, including who reviewed it', () => {
    expect(attributionLabel({ authorKind: 'staff', authorName: 'Dev Gautam', reviewedByName: null, editedByHuman: false }, 'student')).toBe('Replied by Dev Gautam · LockIn team')
    expect(attributionLabel({ authorKind: 'derek', authorName: null, reviewedByName: 'Dev Gautam', editedByHuman: false }, 'student')).toBe('Replied by Derek · AI assistant · reviewed by Dev Gautam')
    expect(attributionLabel({ authorKind: 'derek', authorName: null, reviewedByName: 'Dev Gautam', editedByHuman: true }, 'student')).toMatch(/^Drafted by Derek .* edited and approved by Dev Gautam$/)
    expect(attributionLabel({ authorKind: 'derek', authorName: null, reviewedByName: null, editedByHuman: false }, 'student')).toMatch(/automatic reply, not reviewed by a person/)
    expect(attributionLabel({ authorKind: 'student', authorName: 'Asha', reviewedByName: null, editedByHuman: false }, 'student')).toBe('You')
    expect(attributionLabel({ authorKind: 'student', authorName: 'Asha', reviewedByName: null, editedByHuman: false }, 'staff')).toBe('Asha')
  })
})
