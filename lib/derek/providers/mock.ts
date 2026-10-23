import { DIRECTORY_LABEL, ProviderError, type AiProvider, type AutoReplyCapability, type DraftRequest, type DraftResult } from '../provider'

// Deterministic, offline provider for development and automated tests. It never makes a network
// call, costs nothing and sees only synthetic data. It is refused in production (lib/derek/config.ts).
//
// Default behaviour follows the same answer contract as a real provider, using only the request's
// guidance and verified evidence and never adding figures of its own. Tests inject other
// behaviours to exercise failures, timeouts and invented figures.

export type MockBehaviour =
  | { kind: 'evidence' }
  | { kind: 'fixed'; text: string; uncertain?: boolean }
  | { kind: 'fail'; code?: ProviderError['code']; retryable?: boolean; times?: number }
  | { kind: 'hang' }

export class MockProvider implements AiProvider {
  /** Offline and synthetic, so no third-party terms apply; production refuses the mock anyway. */
  static readonly autoReply: AutoReplyCapability = { permitted: true }
  readonly id = 'mock'
  readonly model = 'mock-derek-1'
  readonly autoReply = MockProvider.autoReply
  calls = 0
  readonly requests: DraftRequest[] = []

  constructor(private behaviour: MockBehaviour = { kind: 'evidence' }) {}

  async generate(request: DraftRequest, { signal }: { signal: AbortSignal }): Promise<DraftResult> {
    this.calls += 1
    this.requests.push(request)
    const b = this.behaviour
    if (b.kind === 'hang')
      return new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new ProviderError('timeout', true))))
    if (b.kind === 'fail' && (b.times == null || this.calls <= b.times))
      throw new ProviderError(b.code ?? 'unavailable', b.retryable ?? true)
    const usage = { inputTokens: request.question.length, outputTokens: 0 }
    if (b.kind === 'fixed') return { text: b.text, model: this.model, uncertain: b.uncertain, usage: { ...usage, outputTokens: b.text.length } }
    const { text, uncertain } = contractAnswer(request)
    return { text, model: this.model, uncertain, usage: { ...usage, outputTokens: text.length } }
  }
}

function contractAnswer(request: DraftRequest): { text: string; uncertain: boolean } {
  const g = request.guidance
  const facts = request.evidence.slice(0, 5).map((e) => `- ${e.text} (official source: ${e.sourceUrl}, checked ${e.checkedAt})`)
  const followUp = g?.followUp ? `\n${g.followUp}` : ''

  // A specific fact with matching verified evidence: quote it, nothing else.
  if (g?.kind === 'specific_fact' && !g.askFollowUp && facts.length)
    return { text: `${DIRECTORY_LABEL}\n${facts.join('\n')}\nDetails can change, so confirm on the official page before you apply.`, uncertain: false }

  // A specific fact LockIn has not verified (or no guidance and no evidence at all).
  if (g?.kind === 'specific_fact' || (!g && !facts.length))
    return {
      text: `LockIn has not verified ${g?.topics.join(' or ') || 'this information'} yet, so I won’t guess. The official course page of the university is the best place to check, and a LockIn team member will follow up.${followUp || '\nWhich university and course are you interested in?'}`,
      uncertain: true,
    }

  const where = g?.destinations.length ? ` in ${g.destinations.join(' and ')}` : ''
  const general =
    g?.kind === 'broad_destination'
      ? `When you compare universities${where}, look at:\n- course content and structure\n- entry requirements for your level\n- total cost, including tuition and living costs\n- location and city life\n- application timelines and intakes\nThese differ between universities, so check each official course page.`
      : 'In general, this depends on the university and the course, so treat this as general guidance and check the official course page for the details.'
  const sourced = facts.length ? `\n${DIRECTORY_LABEL}\n${facts.join('\n')}` : ''
  return { text: `${general}${sourced}${followUp}`, uncertain: false }
}
