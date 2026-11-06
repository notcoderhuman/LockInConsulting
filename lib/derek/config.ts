import type { AiProvider, AutoReplyCapability } from './provider'
import { GEMINI_MODEL, GeminiProvider, vertexEndpoint } from './providers/gemini'
import { MockProvider } from './providers/mock'

// Derek's global gate. Defaults: OFF. Every flag must be set deliberately:
//
//   DEREK_AI_ENABLED=true          global feature flag (default false: no drafts at all)
//   DEREK_PROVIDER=mock|gemini     default mock (offline; development/tests only, refused in production)
//   GEMINI_API_KEY=…               server-side only; required for gemini. Opaque: trimmed, never format-checked
//   DEREK_GEMINI_MODEL             optional; only gemini-3.5-flash-lite is accepted (no silent substitution).
//                                  gemini-3.5-flash is a deprecated ID that Google routes to gemini-3.6-flash
//                                  (ai.google.dev/gemini-api/docs/deprecations, checked 25 Oct and 5 Nov 2026); neither is wired in.
//   DEREK_PROVIDER_APPROVED=<id>   records that the provider's OWN terms permit this student-facing service
//                                  (for Gemini: the "not for consumer use" restriction and the under-18 rule)
//                                  and the data-handling review is done. Required in production before that
//                                  provider may see any real student message, drafts included. Neither
//                                  DEREK_AUTO_REPLY_CLEARED nor a student's 18+ checkbox counts as this.
//   GEMINI_FREE_TIER_ACCEPTED=true the Owner's recorded acceptance that Google's free (unpaid) Gemini service may store,
//                                  human-review and learn from what it receives. With it (and GEMINI_PAID_TIER unset)
//                                  Derek runs in free-tier mode (lib/derek/free-tier.ts): only screened, general
//                                  public-information questions are sent. Never set GEMINI_PAID_TIER for a free key.
//   GEMINI_PAID_TIER=true          required for gemini in production unless free-tier mode is accepted: unpaid-tier inputs may be
//                                  read by human reviewers and used to improve Google's products
//   DEREK_PROVIDER=vertex         Gemini on Vertex AI (Google Cloud terms, docs/DEREK-PROVIDER-TERMS.md):
//   VERTEX_API_KEY=…               server-side only; a Google Cloud API key restricted to Vertex AI
//   VERTEX_PROJECT_ID / VERTEX_LOCATION  project ID; region (e.g. asia-south1) or "global" (default)
//                                  Production also needs DEREK_PROVIDER_APPROVED=vertex; the model check,
//                                  the 18+ rule, the caps and every other gate are the same as gemini.
//   DEREK_GEMINI_DAILY_DRAFT_LIMIT optional cost cap (default 100 drafts per rolling 24 h, max 2000)
//   DEREK_MAX_ATTEMPTS=1|2         provider attempts per draft (default 2: one retry on 429/5xx/timeout);
//                                  1 guarantees at most one request, e.g. for a supervised smoke test
//   DEREK_DAILY_TOKEN_LIMIT        optional spend cap for every provider (default 500000 input+output
//                                  tokens per rolling 24 h, max 5000000); new drafts wait for a human
//   DEREK_AUTO_REPLY_CLEARED=<id>  records that the provider-terms, privacy and age-eligibility review
//                                  for UNREVIEWED automatic replies was done for THAT provider id
//                                  (e.g. "mock"); "true" or another provider's id clears nothing.
//                                  Never enough on its own: the provider's adapter must also declare
//                                  `autoReply.permitted` (Gemini does since D-041; production also needs
//                                  DEREK_PROVIDER_APPROVED=gemini and GEMINI_PAID_TIER=true)
//
// Automatic replies additionally need the owner's switch in /admin/settings, which is ON by
// default (0005) and works as a kill switch. Even then, only low-risk drafts that pass the
// send-time checks in lib/derek/auto-reply.ts are auto-sent. LockIn's own fixed replies
// (greeting, thanks, scope refusal) need the switch but no provider clearance.

type Env = Record<string, string | undefined>

export type DerekStatus =
  | { state: 'disabled'; reasons: string[]; autoReply: AutoReplyStatus }
  | { state: 'blocked'; providerId: string; reasons: string[]; autoReply: AutoReplyStatus }
  | { state: 'ready'; providerId: string; notes: string[]; autoReply: AutoReplyStatus; freeTier?: boolean }

export type AutoReplyStatus = { permitted: true } | { permitted: false; blockers: string[] }

export const DEFAULT_GEMINI_DAILY_DRAFT_LIMIT = 100
const MAX_GEMINI_DAILY_DRAFT_LIMIT = 2000
export const DEFAULT_DAILY_TOKEN_LIMIT = 500_000
const MAX_DAILY_TOKEN_LIMIT = 5_000_000

/** Rolling 24-hour input+output token cap across all providers. */
export function derekDailyTokenLimit(env: Env = process.env): number {
  const n = Number(env.DEREK_DAILY_TOKEN_LIMIT)
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_DAILY_TOKEN_LIMIT) : DEFAULT_DAILY_TOKEN_LIMIT
}

/** Both the adapter's own declaration and the owner's recorded review for this exact provider. */
function autoReplyFor(providerId: string, capability: AutoReplyCapability, env: Env): AutoReplyStatus {
  if (!capability.permitted) return { permitted: false, blockers: [capability.reason] }
  if (env.DEREK_AUTO_REPLY_CLEARED !== providerId)
    return {
      permitted: false,
      blockers: [`The provider-terms, privacy and age-eligibility review for unreviewed replies by "${providerId}" is not recorded (DEREK_AUTO_REPLY_CLEARED).`],
    }
  return { permitted: true }
}

/**
 * The Gemini API key exactly as it will be sent: surrounding whitespace (an accidental paste)
 * trimmed, otherwise opaque. Key formats change over time (legacy `AIza…`, newer `AQ.…`), so the
 * format is never checked here; Google decides whether the credential is valid.
 */
export function readGeminiApiKey(env: Env = process.env): string | null {
  const key = (env.GEMINI_API_KEY ?? '').trim()
  return key || null
}

// Not a format check: a value with control or non-ASCII characters cannot be carried in an HTTP
// header, so fetch would throw before reaching Google. Messages never include the key, its prefix
// or its length.
function geminiKeyProblem(env: Env, name: 'GEMINI_API_KEY' | 'VERTEX_API_KEY' = 'GEMINI_API_KEY'): string | null {
  const key = (env[name] ?? '').trim()
  if (!key) return `${name} is not set.`
  if (/[^\x20-\x7E]/.test(key)) return `${name} contains characters that cannot be sent in an HTTP header (check for a line break or a copied invisible character).`
  return null
}

export function geminiDailyDraftLimit(env: Env = process.env): number {
  const n = Number(env.DEREK_GEMINI_DAILY_DRAFT_LIMIT)
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_GEMINI_DAILY_DRAFT_LIMIT) : DEFAULT_GEMINI_DAILY_DRAFT_LIMIT
}

/** Attempts per draft: exactly "1" disables the retry; anything else keeps the default of 2. */
export function derekMaxAttempts(env: Env = process.env): 1 | 2 {
  return env.DEREK_MAX_ATTEMPTS === '1' ? 1 : 2
}

const blocked = (providerId: string, reason: string): DerekStatus => ({
  state: 'blocked',
  providerId,
  reasons: [reason],
  autoReply: { permitted: false, blockers: [reason] },
})

export function getDerekStatus(env: Env = process.env): DerekStatus {
  if (env.DEREK_AI_ENABLED !== 'true') {
    return {
      state: 'disabled',
      reasons: ['Live AI is switched off (DEREK_AI_ENABLED is not "true").'],
      autoReply: { permitted: false, blockers: ['Derek is disabled.'] },
    }
  }
  const production = env.NODE_ENV === 'production'
  const providerId = env.DEREK_PROVIDER || 'mock'

  if (providerId === 'mock') {
    if (production) return blocked('mock', 'The mock provider is for development and automated tests only.')
    return {
      state: 'ready',
      providerId,
      notes: ['Offline mock provider: no data leaves this server.'],
      autoReply: autoReplyFor('mock', MockProvider.autoReply, env),
    }
  }

  if (providerId === 'gemini') {
    const keyProblem = geminiKeyProblem(env)
    if (keyProblem) return blocked('gemini', keyProblem)
    if (env.DEREK_GEMINI_MODEL && env.DEREK_GEMINI_MODEL !== GEMINI_MODEL)
      return blocked(
        'gemini',
        env.DEREK_GEMINI_MODEL === 'gemini-3.5-flash'
          ? `DEREK_GEMINI_MODEL gemini-3.5-flash is deprecated and routed by Google to gemini-3.6-flash, which is not approved here; use ${GEMINI_MODEL}.`
          : `DEREK_GEMINI_MODEL must be ${GEMINI_MODEL}; other models are not approved.`,
      )
    if (production && env.DEREK_PROVIDER_APPROVED !== 'gemini')
      return blocked(
        'gemini',
        'Gemini may not process real student messages: approval of its terms for this student-facing service (consumer-use and under-18 restrictions) and the data-handling review are not recorded (DEREK_PROVIDER_APPROVED).',
      )
    const freeTier = env.GEMINI_PAID_TIER !== 'true' && env.GEMINI_FREE_TIER_ACCEPTED === 'true'
    if (production && env.GEMINI_PAID_TIER !== 'true' && !freeTier)
      return blocked('gemini', 'GEMINI_PAID_TIER=true is required in production: unpaid-tier prompts may be read by human reviewers and used to improve Google products.')
    return {
      state: 'ready',
      providerId,
      freeTier,
      notes: [
        ...(freeTier ? ['Free tier: Google may store, review and use what it receives. Only screened, general public-information questions are sent (no history, names, contact details or documents); anything personal goes to a person.'] : []),
        `Model ${GEMINI_MODEL}. Automatic replies only with DEREK_AUTO_REPLY_CLEARED=gemini, and only for low-risk questions while the team is offline.`,
        'Drafts are prepared only for students with a recorded 18+ confirmation (Gemini API terms).',
        `Cost cap: ${geminiDailyDraftLimit(env)} drafts per rolling 24 hours.`,
        ...(env.GEMINI_PAID_TIER === 'true' || freeTier ? [] : ['Unpaid tier: synthetic test data only. Never real student messages.']),
        ...(env.DEREK_PROVIDER_APPROVED === 'gemini' ? [] : ['Provider terms not approved for this service: synthetic local testing only (blocked in production).']),
      ],
      autoReply: autoReplyFor('gemini', GeminiProvider.autoReply, env),
    }
  }

  // Gemini on Vertex AI under the Google Cloud terms (docs/DEREK-PROVIDER-TERMS.md). Same model and gates, except
  // GEMINI_PAID_TIER: Vertex is billed through Cloud Billing and the Cloud terms bar training on customer data.
  if (providerId === 'vertex') {
    const keyProblem = geminiKeyProblem(env, 'VERTEX_API_KEY')
    if (keyProblem) return blocked('vertex', keyProblem)
    if (!vertexEndpoint(env.VERTEX_PROJECT_ID ?? '', env.VERTEX_LOCATION || 'global'))
      return blocked('vertex', 'VERTEX_PROJECT_ID must be a Google Cloud project ID and VERTEX_LOCATION a region such as asia-south1 (default global).')
    if (env.DEREK_GEMINI_MODEL && env.DEREK_GEMINI_MODEL !== GEMINI_MODEL) return blocked('vertex', `DEREK_GEMINI_MODEL must be ${GEMINI_MODEL}; other models are not approved.`)
    if (production && env.DEREK_PROVIDER_APPROVED !== 'vertex')
      return blocked('vertex', 'Vertex AI may not process real student messages: approval of the Google Cloud generative AI terms for this service (including the under-18 rule) and the data-handling review are not recorded (DEREK_PROVIDER_APPROVED).')
    return {
      state: 'ready',
      providerId,
      notes: [
        `Model ${GEMINI_MODEL} on Vertex AI (${env.VERTEX_LOCATION || 'global'}). Drafts only for students with a recorded 18+ confirmation (Service Specific Terms, Generative AI: Age Restrictions).`,
        `Cost cap: ${geminiDailyDraftLimit(env)} drafts per rolling 24 hours (DEREK_GEMINI_DAILY_DRAFT_LIMIT).`,
        ...(env.DEREK_PROVIDER_APPROVED === 'vertex' ? [] : ['Provider terms not approved for this service: synthetic local testing only (blocked in production).']),
      ],
      autoReply: autoReplyFor('vertex', GeminiProvider.autoReply, env),
    }
  }

  return blocked(providerId, `Unknown AI provider "${providerId.slice(0, 40)}" (DEREK_PROVIDER must be mock, gemini or vertex).`)
}

/** The provider to use, or null when Derek must not run. Never constructs a provider that is not ready. */
export function createProvider(status: DerekStatus = getDerekStatus(), env: Env = process.env): AiProvider | null {
  if (status.state !== 'ready') return null
  if (status.providerId === 'mock') return new MockProvider()
  const apiKey = status.providerId === 'gemini' ? readGeminiApiKey(env) : null
  if (apiKey) return new GeminiProvider({ apiKey, model: GEMINI_MODEL, dailyDraftLimit: geminiDailyDraftLimit(env) })
  const vertexKey = status.providerId === 'vertex' ? (env.VERTEX_API_KEY ?? '').trim() : ''
  const url = vertexEndpoint(env.VERTEX_PROJECT_ID ?? '', env.VERTEX_LOCATION || 'global')
  if (vertexKey && url) return new GeminiProvider({ apiKey: vertexKey, provider: 'vertex', url, dailyDraftLimit: geminiDailyDraftLimit(env) })
  return null
}
