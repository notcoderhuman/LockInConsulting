import { citation, ProviderError, UNCERTAIN_MARKER, type AiProvider, type AutoReplyCapability, type DraftRequest, type DraftResult, type ProviderPolicy } from '../provider'

// Google Gemini API adapter (REST `models.generateContent`), checked 21 Oct, 26 Oct and 5 Nov 2026 (docs now
// served from aistudio.google.com/docs/models and /docs/deprecations: Stable, "No shutdown date announced")
// against https://ai.google.dev/gemini-api/docs/models (gemini-3.5-flash-lite: Stable, no shutdown date),
// https://ai.google.dev/api/generate-content and https://ai.google.dev/gemini-api/docs/api-key.
//
// Server-only. The key is read from GEMINI_API_KEY by lib/derek/config.ts, held in a private
// field, sent only in the `x-goog-api-key` header (never in the URL), and never logged, stored or
// included in an error. Error messages carry a short code only, never the response body.
//
// Terms (https://ai.google.dev/gemini-api/terms, effective 23 Mar 2026; RISKS.md R-027):
//   - The API may not be used in a client directed towards, or likely to be accessed by, people
//     under 18 → `requiresAdultStudent`: the worker only calls Gemini for students with a recorded 18+
//     confirmation (set by the Google sign-up step or the provisioning CLI).
//   - Unpaid tier: inputs/outputs may be read by human reviewers and used to improve products, and
//     Google says not to submit personal information → production requires GEMINI_PAID_TIER=true;
//     outside production the free tier is for synthetic data only.
//   - Use for this student-facing service: Google confirmed it is permitted under the standard terms,
//     subject to its conditions (D-041). Production still needs DEREK_PROVIDER_APPROVED=gemini, and
//     unreviewed replies also DEREK_AUTO_REPLY_CLEARED=gemini plus every gate in lib/derek/auto-reply.ts.

export const GEMINI_MODEL = 'gemini-3.5-flash-lite'
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Bounded output: ~150 words of reply plus headroom. Flash-Lite's default thinking level is "minimal". */
export const GEMINI_MAX_OUTPUT_TOKENS = 512
export const GEMINI_TEMPERATURE = 0.2
const MAX_RESPONSE_BYTES = 256 * 1024

// finishReason values (ai.google.dev/api/generate-content → FinishReason) that mean the provider
// refused or filtered the content. Anything else unexpected is treated as an invalid response.
const SAFETY_FINISH = new Set(['SAFETY', 'RECITATION', 'LANGUAGE', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT'])

/**
 * Gemini on Vertex AI (Google Cloud terms; docs/DEREK-PROVIDER-TERMS.md). Same generateContent request and
 * response as the Developer API, so the same adapter serves both; only the URL and provider id differ.
 * Project and location are checked so they cannot change the host or path.
 */
export function vertexEndpoint(project: string, location: string): string | null {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) || !/^(global|[a-z]+-[a-z]+\d+)$/.test(location)) return null
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${GEMINI_MODEL}:generateContent`
}

export interface GeminiOptions {
  /** 'vertex' with `url` from vertexEndpoint(); default the Gemini Developer API. */
  provider?: 'gemini' | 'vertex'
  url?: string
  apiKey: string
  model?: string
  dailyDraftLimit: number
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined)

export function buildGeminiRequest(req: DraftRequest, maxOutputTokens = GEMINI_MAX_OUTPUT_TOKENS) {
  const evidence = req.evidence.length
    ? req.evidence.map((e) => `- [${e.ref}] ${e.text} ${citation(e)}`).join('\n')
    : '- none: there is no verified LockIn directory record for this question.'
  return {
    systemInstruction: {
      parts: [{ text: `${req.instructions}${req.guidance ? `\n\nTASK FOR THIS QUESTION:\n${req.guidance.note}` : ''}\n\nEVIDENCE:\n${evidence}` }],
    },
    contents: [
      ...req.history.map((h) => ({ role: h.role === 'student' ? 'user' : 'model', parts: [{ text: h.text }] })),
      { role: 'user', parts: [{ text: req.question }] },
    ],
    generationConfig: { maxOutputTokens, temperature: GEMINI_TEMPERATURE, candidateCount: 1 },
  }
}

function httpError(status: number): ProviderError {
  if (status === 429) return new ProviderError('rate_limited', true)
  if (status === 408) return new ProviderError('timeout', true)
  // Prepaid credit used up (aistudio.google.com/docs/billing, checked 5 Nov 2026): retrying cannot help.
  if (status === 402) return new ProviderError('quota_exhausted', false)
  if (status === 401 || status === 403) return new ProviderError('auth_failed', false)
  if (status >= 500) return new ProviderError('unavailable', true)
  return new ProviderError('provider_error', false) // 400, 404 (unknown model) and other client errors
}

/** Turns a generateContent response body into a DraftResult, or throws a coded ProviderError. */
export function parseGeminiResponse(body: unknown, fallbackModel: string): DraftResult {
  if (!isObj(body)) throw new ProviderError('invalid_response', true)
  const feedback = body.promptFeedback
  if (isObj(feedback) && typeof feedback.blockReason === 'string' && feedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED')
    throw new ProviderError('safety_blocked', false)
  const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined
  if (!isObj(candidate)) throw new ProviderError('invalid_response', true)
  const finish = typeof candidate.finishReason === 'string' ? candidate.finishReason : 'FINISH_REASON_UNSPECIFIED'
  if (SAFETY_FINISH.has(finish)) throw new ProviderError('safety_blocked', false)
  if (finish === 'MALFORMED_RESPONSE') throw new ProviderError('invalid_response', true)
  const parts = isObj(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : []
  // Thought summaries (part.thought === true) are never part of the reply.
  let text = parts
    .filter((p): p is Json => isObj(p) && p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('')
    .trim()
  if (!text) throw new ProviderError('invalid_response', true)
  let uncertain = false
  if (text.startsWith(UNCERTAIN_MARKER)) {
    uncertain = true
    text = text.slice(UNCERTAIN_MARKER.length).trim()
    if (!text) throw new ProviderError('invalid_response', true)
  }
  // Anything but a clean STOP (e.g. MAX_TOKENS: a truncated answer may be missing its caveat)
  // is never treated as low risk.
  const incomplete = finish !== 'STOP'
  if (incomplete) uncertain = true

  const usage = isObj(body.usageMetadata) ? body.usageMetadata : {}
  const candidates = count(usage.candidatesTokenCount)
  const thoughts = count(usage.thoughtsTokenCount)
  return {
    text,
    model: typeof body.modelVersion === 'string' && body.modelVersion ? body.modelVersion.slice(0, 120) : fallbackModel,
    uncertain,
    ...(incomplete ? { incomplete: true } : {}),
    usage: {
      inputTokens: count(usage.promptTokenCount),
      // Billed output = visible answer + thinking tokens.
      outputTokens: candidates == null && thoughts == null ? undefined : (candidates ?? 0) + (thoughts ?? 0),
    },
  }
}

export class GeminiProvider implements AiProvider {
  // Google confirmed the intended use (D-041). This declaration is necessary but never enough: the
  // owner must also clear it (DEREK_AUTO_REPLY_CLEARED=gemini; in production DEREK_PROVIDER_APPROVED and
  // GEMINI_PAID_TIER too), and every send-time gate still applies (risk, team offline, caps, takeover).
  static readonly autoReply: AutoReplyCapability = { permitted: true }
  readonly id: 'gemini' | 'vertex'
  readonly model: string
  readonly policy: ProviderPolicy
  readonly autoReply = GeminiProvider.autoReply
  readonly #apiKey: string
  readonly #fetch: typeof fetch
  readonly #url: string

  constructor({ apiKey, model = GEMINI_MODEL, dailyDraftLimit, fetchImpl, provider = 'gemini', url }: GeminiOptions) {
    if (model !== GEMINI_MODEL) throw new Error(`Unsupported Gemini model (only ${GEMINI_MODEL} is approved).`)
    if (provider === 'vertex' && !url) throw new Error('Vertex AI needs its endpoint URL.')
    this.id = provider
    this.model = model
    this.#url = url ?? `${GEMINI_ENDPOINT}/${model}:generateContent`
    this.#apiKey = apiKey
    this.#fetch = fetchImpl ?? fetch
    this.policy = { external: true, requiresAdultStudent: true, dailyDraftLimit }
  }

  async generate(request: DraftRequest, { signal }: { signal: AbortSignal }): Promise<DraftResult> {
    let res: Response
    try {
      res = await this.#fetch(this.#url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.#apiKey },
        body: JSON.stringify(buildGeminiRequest(request)),
        signal,
        redirect: 'error',
        cache: 'no-store',
      })
    } catch (error) {
      if (signal.aborted || (error as { name?: string })?.name === 'AbortError') throw new ProviderError('timeout', true)
      throw new ProviderError('unavailable', true) // DNS, TLS, connection reset…
    }
    if (!res.ok) {
      // Release the connection without reading the error body (never logged); don't wait on it.
      void res.body?.cancel().catch(() => {})
      throw httpError(res.status)
    }
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_RESPONSE_BYTES) throw new ProviderError('invalid_response', false)
    let raw: string
    try {
      raw = await res.text()
    } catch {
      throw new ProviderError(signal.aborted ? 'timeout' : 'unavailable', true)
    }
    if (raw.length > MAX_RESPONSE_BYTES) throw new ProviderError('invalid_response', false)
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      throw new ProviderError('invalid_response', true)
    }
    return parseGeminiResponse(body, this.model)
  }

  toJSON() {
    return { id: this.id, model: this.model, policy: this.policy }
  }
}
