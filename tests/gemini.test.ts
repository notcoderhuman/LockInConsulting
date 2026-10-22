// Gemini adapter tests. Every call goes to an injected fake `fetch`: no network, no API key, no
// cost. A guard below fails the suite if anything ever reaches the real global fetch.
import { inspect } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createProvider, derekMaxAttempts, getDerekStatus, readGeminiApiKey } from '@/lib/derek/config'
import { DEREK_INSTRUCTIONS, ProviderError, type DraftRequest, type EvidenceItem } from '@/lib/derek/provider'
import { buildGeminiRequest, GEMINI_ENDPOINT, GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL, GeminiProvider, parseGeminiResponse } from '@/lib/derek/providers/gemini'
import { callProvider } from '@/lib/derek/runtime'
import { assessDraft, assessQuestion } from '@/lib/derek/safeguards'

const KEY = 'AIzaSyFAKE-test-key-0000000000000000000'
const evidence: EvidenceItem[] = [
  { ref: 'tuition_fee:7', text: 'MSc Data Science tuition fee (international): EUR 15000.00 per year, academic year 2026-2027', sourceUrl: 'https://uni.example/fees', checkedAt: '2026-10-01' },
]
const request: DraftRequest = {
  question: 'What is a conditional offer?',
  history: [
    { role: 'student', text: 'Hi, I am applying for a master’s.' },
    { role: 'team', text: 'Happy to help.' },
  ],
  evidence,
  instructions: DEREK_INSTRUCTIONS,
}

const realFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error('A test tried to use the real network.')
  }) as typeof fetch
})
afterAll(() => {
  globalThis.fetch = realFetch
})

function geminiBody(text: string, extra: Record<string, unknown> = {}, finishReason = 'STOP') {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 812, candidatesTokenCount: 96, thoughtsTokenCount: 24, totalTokenCount: 932 },
    modelVersion: 'gemini-3.5-flash-lite',
    responseId: 'resp-1',
    ...extra,
  }
}
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fakeFetch(...responses: (Response | Error | ((init: RequestInit) => Promise<Response>))[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next(init)
    return next.clone()
  })
  return { impl: impl as unknown as typeof fetch, calls }
}
const provider = (impl: typeof fetch) => new GeminiProvider({ apiKey: KEY, dailyDraftLimit: 10, fetchImpl: impl })
const signal = () => new AbortController().signal

describe('Gemini request', () => {
  it('calls generateContent for gemini-3.5-flash-lite with the key only in the header', async () => {
    const { impl, calls } = fakeFetch(jsonResponse(geminiBody('A conditional offer is…')))
    await provider(impl).generate(request, { signal: signal() })
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe(`${GEMINI_ENDPOINT}/gemini-3.5-flash-lite:generateContent`)
    expect(url).not.toContain(KEY)
    expect(url).not.toContain('key=')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY)
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends rules and verified evidence as the system instruction, history as turns, and bounds output', () => {
    const body = buildGeminiRequest(request)
    const system = body.systemInstruction.parts[0].text
    expect(system).toContain('Facts about a specific university come ONLY from the EVIDENCE')
    expect(system).toContain('[tuition_fee:7] MSc Data Science tuition fee (international): EUR 15000.00')
    expect(system).toContain('official source: https://uni.example/fees')
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(body.contents.at(-1)!.parts[0].text).toBe('What is a conditional offer?')
    expect(body.generationConfig).toEqual({ maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS, temperature: 0.2, candidateCount: 1 })
    expect(GEMINI_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(512)
    expect(buildGeminiRequest({ ...request, evidence: [] }).systemInstruction.parts[0].text).toMatch(/EVIDENCE:\n- none/)
  })

  it('refuses any model other than gemini-3.5-flash-lite (no silent substitution)', () => {
    expect(GEMINI_MODEL).toBe('gemini-3.5-flash-lite')
    expect(() => new GeminiProvider({ apiKey: KEY, model: 'gemini-4-argon', dailyDraftLimit: 1 })).toThrow(/Unsupported Gemini model/)
  })

  it('never exposes the key through serialisation, inspection or errors', async () => {
    const p = provider(fakeFetch(jsonResponse({ error: { message: `bad key ${KEY}` } }, 401)).impl)
    expect(JSON.stringify(p)).not.toContain(KEY)
    expect(inspect(p, { depth: 5 })).not.toContain(KEY)
    expect(String(Object.values(p))).not.toContain(KEY)
    const error = await p.generate(request, { signal: signal() }).catch((e) => e)
    expect(error).toMatchObject({ code: 'auth_failed', retryable: false })
    expect(`${error.message} ${error.stack} ${JSON.stringify(error)}`).not.toContain(KEY)
    expect(error.message).not.toContain('bad key')
  })
})

describe('Gemini responses', () => {
  it('returns the text, model version and billed usage (answer + thinking tokens)', async () => {
    const out = await provider(fakeFetch(jsonResponse(geminiBody('A conditional offer means…'))).impl).generate(request, { signal: signal() })
    expect(out).toEqual({ text: 'A conditional offer means…', model: 'gemini-3.5-flash-lite', uncertain: false, usage: { inputTokens: 812, outputTokens: 120 } })
  })

  it('drops thought parts and joins text parts', () => {
    const body = geminiBody('')
    body.candidates[0].content.parts = [{ text: 'internal reasoning', thought: true } as never, { text: 'Hello ' }, { text: 'there.' }]
    expect(parseGeminiResponse(body, GEMINI_MODEL).text).toBe('Hello there.')
  })

  it('turns the [UNCERTAIN] marker and truncated answers into uncertain drafts', () => {
    expect(parseGeminiResponse(geminiBody('[UNCERTAIN] I do not have verified fee data.'), GEMINI_MODEL)).toMatchObject({ text: 'I do not have verified fee data.', uncertain: true })
    expect(parseGeminiResponse(geminiBody('A conditional offer is', {}, 'MAX_TOKENS'), GEMINI_MODEL).uncertain).toBe(true)
  })

  it('tolerates missing usage metadata', () => {
    const body: Record<string, unknown> = geminiBody('Ok.')
    delete body.usageMetadata
    expect(parseGeminiResponse(body, GEMINI_MODEL).usage).toEqual({ inputTokens: undefined, outputTokens: undefined })
  })

  it.each([
    ['non-JSON body', new Response('<html>502</html>', { status: 200 }), 'invalid_response', true],
    ['no candidates', jsonResponse({ usageMetadata: {} }), 'invalid_response', true],
    ['empty text', jsonResponse(geminiBody('   ')), 'invalid_response', true],
    ['only the uncertainty marker', jsonResponse(geminiBody('[UNCERTAIN]')), 'invalid_response', true],
    ['prompt blocked', jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }), 'safety_blocked', false],
    ['answer filtered for safety', jsonResponse(geminiBody('x', {}, 'SAFETY')), 'safety_blocked', false],
    ['recitation', jsonResponse(geminiBody('x', {}, 'RECITATION')), 'safety_blocked', false],
    ['personal data detected', jsonResponse(geminiBody('x', {}, 'SPII')), 'safety_blocked', false],
    ['malformed response', jsonResponse(geminiBody('x', {}, 'MALFORMED_RESPONSE')), 'invalid_response', true],
    ['oversized body', new Response('x'.repeat(300 * 1024), { status: 200 }), 'invalid_response', false],
  ] as const)('rejects %s', async (_name, response, code, retryable) => {
    const error = await provider(fakeFetch(response as Response).impl).generate(request, { signal: signal() }).catch((e) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ code, retryable })
  })

  it.each([
    [429, 'rate_limited', true],
    [500, 'unavailable', true],
    [503, 'unavailable', true],
    [408, 'timeout', true],
    [400, 'provider_error', false],
    [404, 'provider_error', false],
    [401, 'auth_failed', false],
    [403, 'auth_failed', false],
  ] as const)('maps HTTP %i to %s', async (status, code, retryable) => {
    const error = await provider(fakeFetch(jsonResponse({ error: { message: 'details' } }, status)).impl).generate(request, { signal: signal() }).catch((e) => e)
    expect(error).toMatchObject({ code, retryable })
  })

  it('maps network failures to a retryable unavailable error', async () => {
    const error = await provider(fakeFetch(new TypeError('fetch failed')).impl).generate(request, { signal: signal() }).catch((e) => e)
    expect(error).toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('Gemini through the timeout and retry policy', () => {
  it('aborts a hanging request, retries once, then reports a timeout', async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const { impl, calls } = fakeFetch(hang)
    const out = await callProvider(provider(impl), request, { timeoutMs: 20, retryDelayMs: 0 })
    expect(out).toMatchObject({ ok: false, code: 'timeout', attempts: 2 })
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.init.signal!.aborted)).toBe(true)
  })

  it('DEREK_MAX_ATTEMPTS=1 makes at most one request, even on a retryable error', async () => {
    expect(derekMaxAttempts({})).toBe(2)
    expect(derekMaxAttempts({ DEREK_MAX_ATTEMPTS: '1' })).toBe(1)
    for (const other of ['0', '3', '2', 'one', '']) expect(derekMaxAttempts({ DEREK_MAX_ATTEMPTS: other })).toBe(2)
    const { impl, calls } = fakeFetch(jsonResponse({}, 429), jsonResponse(geminiBody('never reached')))
    expect(await callProvider(provider(impl), request, { maxAttempts: derekMaxAttempts({ DEREK_MAX_ATTEMPTS: '1' }), retryDelayMs: 0 })).toMatchObject({ ok: false, code: 'rate_limited', attempts: 1 })
    expect(calls).toHaveLength(1)
  })

  it('retries a 429 once and succeeds; never retries a 400 or a key error', async () => {
    const ok = fakeFetch(jsonResponse({}, 429), jsonResponse(geminiBody('Done.')))
    expect(await callProvider(provider(ok.impl), request, { retryDelayMs: 0 })).toMatchObject({ ok: true, attempts: 2 })
    for (const status of [400, 401]) {
      const bad = fakeFetch(jsonResponse({}, status))
      expect(await callProvider(provider(bad.impl), request, { retryDelayMs: 0 })).toMatchObject({ ok: false, attempts: 1 })
      expect(bad.calls).toHaveLength(1)
    }
  })
})

describe('unsupported claims in Gemini answers are escalated', () => {
  it('flags invented fees, rankings and requirements as high risk, and keeps general answers low', async () => {
    const answer = async (text: string, question = request.question, ev = evidence) => {
      const out = await provider(fakeFetch(jsonResponse(geminiBody(text))).impl).generate({ ...request, question, evidence: ev }, { signal: signal() })
      return assessDraft(out.text, assessQuestion(question, ev), ev, { modelUncertain: out.uncertain })
    }
    expect((await answer('A conditional offer means you are admitted once you meet the remaining conditions, such as final grades. Requirements vary by university.')).level).toBe('low')
    expect((await answer('The fee is EUR 15000.00 per year for 2026-2027 (official source: https://uni.example/fees).', 'What is the fee?')).level).toBe('low')
    for (const invented of ['Fees are about EUR 18,000 per year.', 'It is ranked #12 in the world.', 'You need IELTS 6.5 overall.', 'The acceptance rate is 8%.', 'You are guaranteed admission.'])
      expect((await answer(invented)).level, invented).toBe('high')
    expect((await answer('[UNCERTAIN] I do not have verified deadline information.', 'When is the deadline?', [])).level).toBe('uncertain')
  })
})

describe('Gemini configuration', () => {
  const base = { DEREK_AI_ENABLED: 'true', DEREK_PROVIDER: 'gemini', GEMINI_API_KEY: KEY }

  it('is ready only with an explicit provider and key, and builds the real adapter', () => {
    const status = getDerekStatus(base)
    expect(status).toMatchObject({ state: 'ready', providerId: 'gemini' })
    const p = createProvider(status, base)
    expect(p).toBeInstanceOf(GeminiProvider)
    expect(p).toMatchObject({ model: 'gemini-3.5-flash-lite', policy: { external: true, requiresAdultStudent: true, dailyDraftLimit: 100 } })
    expect(JSON.stringify(status)).not.toContain(KEY)
  })

  /** Builds the provider exactly as the app does (createProvider) with a fake global fetch. */
  async function viaCreateProvider(env: Record<string, string>) {
    const { impl, calls } = fakeFetch(jsonResponse(geminiBody('A conditional offer means…')))
    const guard = globalThis.fetch
    globalThis.fetch = impl
    try {
      const p = createProvider(getDerekStatus(env), env) as GeminiProvider
      expect(p).toBeInstanceOf(GeminiProvider)
      await p.generate(request, { signal: signal() })
      return { p, calls }
    } finally {
      globalThis.fetch = guard
    }
  }

  // Placeholders only: shaped like each format, obviously fake, never real credentials.
  const LEGACY_PLACEHOLDER = 'AIzaSyFAKE-legacy-placeholder-000000000'
  const NEW_PLACEHOLDER = 'AQ.FAKE_new-format.placeholder-not-a-real-key-0000'

  it.each([
    ['legacy AIza-prefixed', LEGACY_PLACEHOLDER],
    ['newer AQ.-prefixed', NEW_PLACEHOLDER],
    ['short opaque', 'Q9z~FAKE'],
    ['containing words like "your"', 'AQ.yourFAKExxxxxxxxplaceholder'],
  ])('accepts a %s key as an opaque secret and sends it only in the x-goog-api-key header', async (_kind, key) => {
    const env = { ...base, GEMINI_API_KEY: key }
    const status = getDerekStatus(env)
    expect(status).toMatchObject({ state: 'ready', providerId: 'gemini' })
    const { p, calls } = await viaCreateProvider(env)
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe(key)
    expect(calls[0].url).toBe(`${GEMINI_ENDPOINT}/gemini-3.5-flash-lite:generateContent`)
    expect(new URL(calls[0].url).search).toBe('')
    expect(calls[0].url).not.toContain(key)
    expect(String(calls[0].init.body)).not.toContain(key)
    for (const exposed of [JSON.stringify(status), JSON.stringify(p), inspect(p, { depth: 5 })]) {
      expect(exposed).not.toContain(key)
      if (key.length > 3) expect(exposed).not.toContain(key.slice(0, 6))
    }
  })

  it('trims accidental surrounding whitespace and sends the trimmed key', async () => {
    for (const raw of [`  ${NEW_PLACEHOLDER}  `, `${LEGACY_PLACEHOLDER}
`, `	${NEW_PLACEHOLDER}
`]) {
      const env = { ...base, GEMINI_API_KEY: raw }
      expect(readGeminiApiKey(env)).toBe(raw.trim())
      expect(getDerekStatus(env).state).toBe('ready')
      const { calls } = await viaCreateProvider(env)
      expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe(raw.trim())
    }
  })

  it('refuses only values that cannot travel in an HTTP header, without revealing them', () => {
    for (const bad of [`${NEW_PLACEHOLDER.slice(0, 10)}\n${NEW_PLACEHOLDER.slice(10)}`, `${NEW_PLACEHOLDER}\u0000`, `AQ.FAKE​placeholder`, 'AQ.FAKE-placeholder-ключ']) {
      const status = getDerekStatus({ ...base, GEMINI_API_KEY: bad })
      expect(status).toMatchObject({ state: 'blocked', reasons: [expect.stringMatching(/cannot be sent in an HTTP header/)] })
      expect(JSON.stringify(status)).not.toContain('AQ.')
      expect(JSON.stringify(status)).not.toMatch(/\d+ characters|length/i)
    }
    expect(getDerekStatus({ ...base, GEMINI_API_KEY: '' })).toMatchObject({ state: 'blocked', reasons: ['GEMINI_API_KEY is not set.'] })
  })

  it('never permits automatic replies with Gemini, even with every other gate open', () => {
    const status = getDerekStatus({ ...base, DEREK_AUTO_REPLY_CLEARED: 'true', GEMINI_PAID_TIER: 'true' })
    expect(status.autoReply).toEqual({ permitted: false, blockers: [expect.stringMatching(/not approved for Gemini/)] })
  })

  it('requires the paid tier in production and flags the free tier as synthetic-data only elsewhere', () => {
    expect(getDerekStatus({ ...base, NODE_ENV: 'production' })).toMatchObject({ state: 'blocked', reasons: [expect.stringMatching(/GEMINI_PAID_TIER/)] })
    expect(getDerekStatus({ ...base, NODE_ENV: 'production', GEMINI_PAID_TIER: 'true' }).state).toBe('ready')
    const dev = getDerekStatus(base)
    expect(dev.state === 'ready' && dev.notes.join(' ')).toMatch(/synthetic test data only/)
  })

  it('accepts only the approved model id and a bounded daily cap', () => {
    expect(getDerekStatus({ ...base, DEREK_GEMINI_MODEL: 'gemini-3.5-flash-lite' }).state).toBe('ready')
    expect(getDerekStatus({ ...base, DEREK_GEMINI_MODEL: 'gemini-4-argon' }).state).toBe('blocked')
    expect(createProvider(getDerekStatus(base), { ...base, DEREK_GEMINI_DAILY_DRAFT_LIMIT: '5' })?.policy?.dailyDraftLimit).toBe(5)
    expect(createProvider(getDerekStatus(base), { ...base, DEREK_GEMINI_DAILY_DRAFT_LIMIT: '999999' })?.policy?.dailyDraftLimit).toBe(2000)
    expect(createProvider(getDerekStatus(base), { ...base, DEREK_GEMINI_DAILY_DRAFT_LIMIT: '-1' })?.policy?.dailyDraftLimit).toBe(100)
  })
})
