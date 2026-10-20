// Provider-independent contract for Derek. Server-only by convention: nothing under lib/derek is
// imported by a client component, and no provider key is ever exposed to the browser.

export interface EvidenceItem {
  /** Stable reference, e.g. `tuition_fee:12`, stored with the draft for the reviewer. */
  ref: string
  text: string
  sourceUrl: string
  checkedAt: string
}

export interface DraftRequest {
  /** The student's question, with contact details redacted (lib/derek/safeguards.ts). */
  question: string
  /** Recent turns for context, oldest first, also redacted. */
  history: { role: 'student' | 'team'; text: string }[]
  /** Verified, published, unexpired directory facts only (lib/derek/evidence.ts). */
  evidence: EvidenceItem[]
  instructions: string
}

export interface DraftResult {
  text: string
  model: string
  /** The model said it could not answer from the evidence. */
  uncertain?: boolean
  usage?: { inputTokens?: number; outputTokens?: number }
}

export type ProviderErrorCode = 'timeout' | 'rate_limited' | 'unavailable' | 'invalid_response' | 'provider_error' | 'blocked'

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly retryable: boolean,
    message: string = code,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export interface AiProvider {
  readonly id: string
  readonly model: string
  generate(request: DraftRequest, options: { signal: AbortSignal }): Promise<DraftResult>
}

/** Fixed rules sent with every request. The server-side safeguards re-check the output anyway. */
export const DEREK_INSTRUCTIONS = [
  'You are Derek, the AI assistant of LockIn Consulting, drafting a reply that a human team member may review.',
  'Answer ONLY from the EVIDENCE provided. Each evidence line is a verified, published LockIn directory record with its official source.',
  'Never state a university ranking, tuition or living cost, acceptance rate, admission probability, entry or language requirement, scholarship, intake or deadline unless it appears in the EVIDENCE, and then quote it exactly with its source.',
  'If the evidence does not cover the question, say plainly what is not known and that a LockIn team member will follow up. Do not guess.',
  'Never promise admission, a scholarship or a visa outcome. Do not give immigration or legal advice; refer the student to the official government source and the team.',
  'Do not convert currencies.',
  'Be concise, warm and factual.',
].join('\n')
