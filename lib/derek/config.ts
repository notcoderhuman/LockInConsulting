import type { AiProvider } from './provider'
import { GEMINI_MODEL, GeminiProvider } from './providers/gemini'
import { MockProvider } from './providers/mock'

// Derek's global gate. Defaults: OFF. Every flag must be set deliberately:
//
//   DEREK_AI_ENABLED=true          global feature flag (default false: no drafts at all)
//   DEREK_PROVIDER=mock|gemini     default mock (offline; development/tests only, refused in production)
//   GEMINI_API_KEY=…               server-side only; required for gemini. Opaque: trimmed, never format-checked
//   DEREK_GEMINI_MODEL             optional; only gemini-3.5-flash-lite is accepted (no silent substitution)
//   GEMINI_PAID_TIER=true          required for gemini in production: unpaid-tier inputs may be
//                                  read by human reviewers and used to improve Google's products
//   DEREK_GEMINI_DAILY_DRAFT_LIMIT optional cost cap (default 100 drafts per rolling 24 h, max 2000)
//   DEREK_MAX_ATTEMPTS=1|2         provider attempts per draft (default 2: one retry on 429/5xx/timeout);
//                                  1 guarantees at most one request, e.g. for a supervised smoke test
//   DEREK_AUTO_REPLY_CLEARED=true  records the review for UNREVIEWED automatic replies; never
//                                  enough for gemini, which is drafts-only until separately approved
//
// Automatic replies additionally need the owner to switch the support mode to offline and turn
// automatic replies on in /admin/settings. Even then, only low-risk drafts are auto-sent.

type Env = Record<string, string | undefined>

export type DerekStatus =
  | { state: 'disabled'; reasons: string[]; autoReply: AutoReplyStatus }
  | { state: 'blocked'; providerId: string; reasons: string[]; autoReply: AutoReplyStatus }
  | { state: 'ready'; providerId: string; notes: string[]; autoReply: AutoReplyStatus }

export type AutoReplyStatus = { permitted: true } | { permitted: false; blockers: string[] }

export const DEFAULT_GEMINI_DAILY_DRAFT_LIMIT = 100
const MAX_GEMINI_DAILY_DRAFT_LIMIT = 2000
const GEMINI_AUTO_BLOCKER = 'Automatic replies are not approved for Gemini: Derek only prepares drafts for human review.'

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
function geminiKeyProblem(env: Env): string | null {
  const key = readGeminiApiKey(env)
  if (!key) return 'GEMINI_API_KEY is not set.'
  if (/[^\x20-\x7E]/.test(key)) return 'GEMINI_API_KEY contains characters that cannot be sent in an HTTP header (check for a line break or a copied invisible character).'
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
      autoReply:
        env.DEREK_AUTO_REPLY_CLEARED === 'true'
          ? { permitted: true }
          : { permitted: false, blockers: ['The provider-terms, privacy and age-eligibility review for unreviewed replies is not recorded (DEREK_AUTO_REPLY_CLEARED).'] },
    }
  }

  if (providerId === 'gemini') {
    const keyProblem = geminiKeyProblem(env)
    if (keyProblem) return blocked('gemini', keyProblem)
    if (env.DEREK_GEMINI_MODEL && env.DEREK_GEMINI_MODEL !== GEMINI_MODEL)
      return blocked('gemini', `DEREK_GEMINI_MODEL must be ${GEMINI_MODEL}; other models are not approved.`)
    if (production && env.GEMINI_PAID_TIER !== 'true')
      return blocked('gemini', 'GEMINI_PAID_TIER=true is required in production: unpaid-tier prompts may be read by human reviewers and used to improve Google products.')
    return {
      state: 'ready',
      providerId,
      notes: [
        `Model ${GEMINI_MODEL}; drafts only, every reply needs human approval.`,
        'Drafts are prepared only for students with a recorded 18+ confirmation (Gemini API terms).',
        `Cost cap: ${geminiDailyDraftLimit(env)} drafts per rolling 24 hours.`,
        ...(env.GEMINI_PAID_TIER === 'true' ? [] : ['Unpaid tier: synthetic test data only. Never real student messages.']),
      ],
      autoReply: { permitted: false, blockers: [GEMINI_AUTO_BLOCKER] },
    }
  }

  return blocked(providerId, `Unknown AI provider "${providerId.slice(0, 40)}" (DEREK_PROVIDER must be mock or gemini).`)
}

/** The provider to use, or null when Derek must not run. Never constructs a provider that is not ready. */
export function createProvider(status: DerekStatus = getDerekStatus(), env: Env = process.env): AiProvider | null {
  if (status.state !== 'ready') return null
  if (status.providerId === 'mock') return new MockProvider()
  const apiKey = status.providerId === 'gemini' ? readGeminiApiKey(env) : null
  if (apiKey) return new GeminiProvider({ apiKey, model: GEMINI_MODEL, dailyDraftLimit: geminiDailyDraftLimit(env) })
  return null
}
