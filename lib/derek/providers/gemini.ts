import { ProviderError, type AiProvider } from '../provider'

// Gemini is the owner's preferred provider, but it is BLOCKED and contains no network code.
//
// Blockers (RISKS.md R-001, R-002, R-027) — all must be cleared in writing before this file
// gains a real implementation:
//   1. Google's Gemini API Additional Terms have restricted use in services directed at, or
//      likely to be accessed by, people under 18. LockIn may be used by under-18 students.
//   2. Retention, training-on-inputs and human-review terms differ between unpaid and paid tiers;
//      student messages may not go to a tier that reviews or trains on inputs.
//   3. Commercial-use conditions for this service must be confirmed.
//   4. The model id "Gemini 4 Argon" has NOT been verified as a public API model id. It must be
//      checked against Google's official model list; no other model may be substituted silently.
//   5. No paid usage without the owner's explicit approval.
// If Google does not permit this use, Derek stays on the human workflow. Do not work around it.

export const GEMINI_BLOCKER =
  'Gemini is blocked pending a written review of Google’s under-18 eligibility, retention/training, human-review and commercial terms, and verification of the model id (RISKS.md R-001, R-027).'

export class BlockedGeminiProvider implements AiProvider {
  readonly id = 'gemini'
  readonly model = 'unverified'
  async generate(): Promise<never> {
    throw new ProviderError('blocked', false, GEMINI_BLOCKER)
  }
}
