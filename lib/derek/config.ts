import type { AiProvider } from './provider'
import { BlockedGeminiProvider, GEMINI_BLOCKER } from './providers/gemini'
import { MockProvider } from './providers/mock'

// Derek's global gate. Defaults: OFF. Every flag must be set deliberately:
//
//   DEREK_AI_ENABLED=true         global feature flag (default false: no drafts at all)
//   DEREK_PROVIDER=mock|gemini    mock is development/test only; gemini is blocked (see providers/gemini.ts)
//   DEREK_AUTO_REPLY_CLEARED=true records that the provider terms, privacy and age-eligibility
//                                 review for UNREVIEWED automatic replies is complete
//
// Automatic replies additionally need the owner to switch the support mode to offline and turn
// automatic replies on in /admin/settings. Even then, only low-risk drafts are auto-sent.

type Env = Record<string, string | undefined>

export type DerekStatus =
  | { state: 'disabled'; reasons: string[]; autoReply: AutoReplyStatus }
  | { state: 'blocked'; providerId: string; reasons: string[]; autoReply: AutoReplyStatus }
  | { state: 'ready'; providerId: string; autoReply: AutoReplyStatus }

export type AutoReplyStatus = { permitted: true } | { permitted: false; blockers: string[] }

export function getDerekStatus(env: Env = process.env): DerekStatus {
  const autoBlockers: string[] = []
  if (env.DEREK_AI_ENABLED !== 'true') {
    return {
      state: 'disabled',
      reasons: ['Live AI is switched off (DEREK_AI_ENABLED is not "true").'],
      autoReply: { permitted: false, blockers: ['Derek is disabled.'] },
    }
  }
  const providerId = env.DEREK_PROVIDER ?? ''
  let blocked: string | null = null
  if (providerId === 'gemini') blocked = GEMINI_BLOCKER
  else if (providerId === 'mock') {
    if (env.NODE_ENV === 'production') blocked = 'The mock provider is for development and automated tests only.'
  } else blocked = 'No AI provider is selected (DEREK_PROVIDER).'

  if (blocked) {
    return { state: 'blocked', providerId: providerId || 'none', reasons: [blocked], autoReply: { permitted: false, blockers: [blocked] } }
  }
  if (env.DEREK_AUTO_REPLY_CLEARED !== 'true')
    autoBlockers.push('The provider-terms, privacy and age-eligibility review for unreviewed replies is not recorded (DEREK_AUTO_REPLY_CLEARED).')
  return {
    state: 'ready',
    providerId,
    autoReply: autoBlockers.length ? { permitted: false, blockers: autoBlockers } : { permitted: true },
  }
}

/** The provider to use, or null when Derek must not run. Never constructs a blocked provider. */
export function createProvider(status: DerekStatus = getDerekStatus()): AiProvider | null {
  if (status.state !== 'ready') return null
  if (status.providerId === 'mock') return new MockProvider()
  return null
}

// Exported so tests can assert the Gemini path stays inert.
export { BlockedGeminiProvider }
