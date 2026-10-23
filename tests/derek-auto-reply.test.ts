import { describe, expect, it } from 'vitest'
import { AUTO_REPLY_LIMITS, autoReplyContentBlockers } from '@/lib/derek/auto-reply'
import { DEFAULT_DAILY_TOKEN_LIMIT, derekDailyTokenLimit, getDerekStatus } from '@/lib/derek/config'
import { GeminiProvider } from '@/lib/derek/providers/gemini'
import { MockProvider } from '@/lib/derek/providers/mock'

const mock = { DEREK_AI_ENABLED: 'true', DEREK_PROVIDER: 'mock', NODE_ENV: 'test' }

describe('automatic replies need a provider-specific review AND the adapter’s own permission', () => {
  it('clears only the exact provider id that was reviewed', () => {
    expect(getDerekStatus({ ...mock, DEREK_AUTO_REPLY_CLEARED: 'mock' }).autoReply).toEqual({ permitted: true })
    for (const value of [undefined, '', 'true', 'TRUE', 'Mock', ' mock', 'gemini', 'mock,gemini'])
      expect(getDerekStatus({ ...mock, DEREK_AUTO_REPLY_CLEARED: value }).autoReply, String(value)).toMatchObject({ permitted: false, blockers: [expect.stringContaining('"mock"')] })
  })

  it('never permits Gemini, even with its review recorded and the paid tier attested', () => {
    expect(GeminiProvider.autoReply.permitted).toBe(false)
    expect(new GeminiProvider({ apiKey: 'FAKE-test-key', dailyDraftLimit: 1 }).autoReply.permitted).toBe(false)
    const status = getDerekStatus({ DEREK_AI_ENABLED: 'true', DEREK_PROVIDER: 'gemini', GEMINI_API_KEY: 'FAKE-test-key', GEMINI_PAID_TIER: 'true', DEREK_AUTO_REPLY_CLEARED: 'gemini' })
    expect(status).toMatchObject({ state: 'ready', autoReply: { permitted: false, blockers: [expect.stringMatching(/not approved for Gemini/)] } })
  })

  it('refuses the mock in production, so no provider can auto-send there today', () => {
    expect(MockProvider.autoReply.permitted).toBe(true)
    expect(getDerekStatus({ ...mock, NODE_ENV: 'production', DEREK_AUTO_REPLY_CLEARED: 'mock' })).toMatchObject({ state: 'blocked', autoReply: { permitted: false } })
  })
})

describe('content checks before an unreviewed reply', () => {
  const evidence = [{ ref: 'tuition_fee:1', text: 'Fee', sourceUrl: 'https://uni.example/fees', checkedAt: '2026-10-01' }]

  it('passes short, ordinary answers and links taken from verified evidence', () => {
    expect(autoReplyContentBlockers('A statement of purpose explains your goals.', [])).toEqual([])
    expect(autoReplyContentBlockers('Check the official page (https://uni.example/fees).', evidence)).toEqual([])
  })

  it('blocks long replies, links from anywhere else, and refusals', () => {
    expect(autoReplyContentBlockers('x'.repeat(AUTO_REPLY_LIMITS.maxChars + 1), [])).toEqual([`Longer than ${AUTO_REPLY_LIMITS.maxChars} characters`])
    for (const text of ['See https://uni.example/apply.', 'See https://evil.example/fees', 'See http://uni.example/fees'])
      expect(autoReplyContentBlockers(text, evidence), text).toEqual(['Contains a link that is not from verified evidence'])
    for (const text of ['I can’t help with that.', "I'm unable to answer this.", 'I cannot provide that.', 'As an AI, I do not know.', "I'm sorry, but I can't do that."])
      expect(autoReplyContentBlockers(text, []), text).toEqual(['Reads like a refusal'])
    expect(autoReplyContentBlockers('LockIn has not verified this yet, so I won’t guess.', [])).toEqual([])
  })
})

describe('daily token budget', () => {
  it('defaults to 500,000 tokens, accepts positive integers and is capped at 5,000,000', () => {
    expect(derekDailyTokenLimit({})).toBe(DEFAULT_DAILY_TOKEN_LIMIT)
    expect(derekDailyTokenLimit({ DEREK_DAILY_TOKEN_LIMIT: '1000' })).toBe(1000)
    for (const bad of ['0', '-5', '1.5', 'abc']) expect(derekDailyTokenLimit({ DEREK_DAILY_TOKEN_LIMIT: bad })).toBe(DEFAULT_DAILY_TOKEN_LIMIT)
    expect(derekDailyTokenLimit({ DEREK_DAILY_TOKEN_LIMIT: '99999999' })).toBe(5_000_000)
  })
})
