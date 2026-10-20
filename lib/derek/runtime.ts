import { ProviderError, type AiProvider, type DraftRequest, type DraftResult, type ProviderErrorCode } from './provider'

// Timeout and retry policy for every provider call (documented in ARCHITECTURE.md → Derek).
//   - Each attempt is capped at TIMEOUT_MS. The timeout is enforced here even if a provider
//     ignores the abort signal.
//   - At most MAX_ATTEMPTS attempts; only retryable errors (timeout, rate limit, transient
//     unavailability) are retried, after RETRY_DELAY_MS.
//   - Errors are reduced to a short code. Provider messages, request bodies and keys are never
//     logged or stored.

export const TIMEOUT_MS = 20_000
export const MAX_ATTEMPTS = 2
export const RETRY_DELAY_MS = 1_500

export type CallOutcome =
  | { ok: true; result: DraftResult; attempts: number; latencyMs: number }
  | { ok: false; code: ProviderErrorCode; attempts: number; latencyMs: number }

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function callProvider(
  provider: AiProvider,
  request: DraftRequest,
  {
    timeoutMs = TIMEOUT_MS,
    maxAttempts = MAX_ATTEMPTS,
    retryDelayMs = RETRY_DELAY_MS,
    sleep = defaultSleep,
    now = () => Date.now(),
  }: { timeoutMs?: number; maxAttempts?: number; retryDelayMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<CallOutcome> {
  const started = now()
  let lastCode: ProviderErrorCode = 'provider_error'
  let attempts = 0
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new ProviderError('timeout', true))
        }, timeoutMs)
      })
      const result = await Promise.race([provider.generate(request, { signal: controller.signal }), timeout])
      if (typeof result?.text !== 'string' || !result.text.trim()) throw new ProviderError('invalid_response', true)
      return { ok: true, result, attempts: attempt, latencyMs: now() - started }
    } catch (error) {
      const e = error instanceof ProviderError ? error : new ProviderError('provider_error', false)
      lastCode = e.code
      if (!e.retryable || attempt === maxAttempts) break
      await sleep(retryDelayMs)
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, code: lastCode, attempts, latencyMs: now() - started }
}
