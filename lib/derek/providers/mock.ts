import { ProviderError, type AiProvider, type DraftRequest, type DraftResult } from '../provider'

// Deterministic, offline provider for development and automated tests. It never makes a network
// call, costs nothing and sees only synthetic data. It is refused in production (lib/derek/config.ts).
//
// Default behaviour: quote the evidence verbatim if there is any, otherwise say the answer is not
// known. Tests inject other behaviours to exercise failures, timeouts and invented figures.

export type MockBehaviour =
  | { kind: 'evidence' }
  | { kind: 'fixed'; text: string; uncertain?: boolean }
  | { kind: 'fail'; code?: ProviderError['code']; retryable?: boolean; times?: number }
  | { kind: 'hang' }

export class MockProvider implements AiProvider {
  readonly id = 'mock'
  readonly model = 'mock-derek-1'
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
    if (!request.evidence.length) {
      const text =
        'I don’t have verified information in the LockIn directory to answer this yet, so I won’t guess. A member of the LockIn team will follow up with you.'
      return { text, model: this.model, uncertain: true, usage: { ...usage, outputTokens: text.length } }
    }
    const lines = request.evidence.slice(0, 5).map((e) => `• ${e.text} (source: ${e.sourceUrl}, checked ${e.checkedAt})`)
    const text = `Here is what the LockIn directory has verified:\n${lines.join('\n')}\nPlease confirm on the official page before applying.`
    return { text, model: this.model, usage: { ...usage, outputTokens: text.length } }
  }
}
