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
  /** How to shape the answer to this particular question (lib/derek/guidance.ts). Never facts. */
  guidance?: QuestionGuidance
}

export interface QuestionGuidance {
  kind: 'general' | 'broad_destination' | 'specific_fact'
  /** Destinations the question mentions, by short name (e.g. "UK"). */
  destinations: string[]
  /** Factual topics asked about (fees, rankings, deadlines…). */
  topics: string[]
  askFollowUp: boolean
  /** The single follow-up question to end with, when the student's goals are unclear. */
  followUp: string | null
  /** Plain-language task note sent to the provider with the rules. */
  note: string
}

export interface DraftResult {
  text: string
  model: string
  /** The model said it could not answer from the evidence. */
  uncertain?: boolean
  usage?: { inputTokens?: number; outputTokens?: number }
}

export type ProviderErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'provider_error'
  | 'blocked'
  | 'auth_failed' // key rejected or not permitted for this model
  | 'safety_blocked' // the provider refused the prompt or the answer (safety, recitation, PII…)

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
  /** Data-handling policy the worker enforces before any call. Omitted = in-process provider. */
  readonly policy?: ProviderPolicy
  generate(request: DraftRequest, options: { signal: AbortSignal }): Promise<DraftResult>
}

export interface ProviderPolicy {
  /** The request leaves this server (an external API). */
  external: boolean
  /** Only draft for students whose profile records an 18+ confirmation (age_confirmed_at). */
  requiresAdultStudent: boolean
  /** Upper bound on drafts this provider may start per rolling 24 hours (cost control). */
  dailyDraftLimit: number
}

/** Leading marker the model uses when the evidence does not answer a factual question. */
export const UNCERTAIN_MARKER = '[UNCERTAIN]'

/** Line that introduces sourced facts. Only allowed when EVIDENCE was provided (lib/derek/safeguards.ts). */
export const DIRECTORY_LABEL = 'From the LockIn directory:'

/** Fixed rules sent with every request. The server-side safeguards re-check the output anyway. */
export const DEREK_INSTRUCTIONS = [
  'You are Derek, the AI assistant of LockIn Consulting. You help Indian students plan undergraduate and postgraduate study abroad. You write a DRAFT reply that a LockIn team member reviews before it is sent.',
  'STYLE: Simple, friendly English that a Class 12 or college student in India understands. Usually 80 to 150 words. Start with the answer itself: no greeting, no "Great question", no repeating the question, no sign-off, no filler. Plain text only (no markdown, no bold, no headings); short paragraphs or lines starting with "- ".',
  'GENERAL GUIDANCE: You may explain degree types, admissions terms, application steps, statements of purpose, and how to compare universities or countries, in general terms ("usually", "many universities"). General guidance never contains numbers, fees, dates, rankings, percentages or test scores.',
  `SOURCED FACTS: Facts about a specific university come ONLY from the EVIDENCE lines, which are verified, published LockIn directory records. Put them on a separate line that starts with "${DIRECTORY_LABEL}" and name the official source. If EVIDENCE is "none", never write that line and never say that LockIn has verified anything.`,
  'NEVER state, estimate or give a typical range for a ranking, tuition or living cost, acceptance rate, admission chance, entry or language requirement, scholarship, intake date, deadline or visa rule unless it is in EVIDENCE. Do not convert currencies.',
  `MISSING DATA: If the student asks for a specific fact that is not in EVIDENCE, start your reply with ${UNCERTAIN_MARKER}, say in one sentence that LockIn has not verified it yet, give brief general guidance on where to check (the official university course page), and ask which university and course they mean.`,
  'FOLLOW-UP: If the student’s goals are unclear (study level, subject, country or intake), end with ONE short, focused follow-up question. Never ask more than one question.',
  'OUTCOMES: Never promise or predict admission, a scholarship, a visa or any other outcome. Do not give visa, immigration, legal or financial advice; point to the official government or university source and say the LockIn team will follow up.',
  'PRIVACY: Never ask for or repeat passport numbers, bank details, phone numbers or other sensitive personal data.',
].join('\n')
