type Env = Record<string, string | undefined>

export type CspMode = 'enforce' | 'report-only'

/**
 * Enforcing is the default. Report-only is an explicit, temporary opt-out for diagnosing a
 * staging regression; it protects nothing, so any value other than exactly "report-only" enforces.
 */
export function resolveCspMode(env: Env = process.env): CspMode {
  return env.CSP_MODE === 'report-only' ? 'report-only' : 'enforce'
}

export function cspHeaderName(mode: CspMode): string {
  return mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'
}

export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Every resource the site loads is first-party: scripts and CSS from /_next/static, fonts
 * self-hosted by next/font, globe textures and photos from /public, and API calls to /api.
 * - script-src: nonce + 'strict-dynamic' so only Next's nonced bootstrap and the chunks it loads run.
 * - style-src: nonce for <style> elements; style-src-attr allows the `style=""` attributes React
 *   and React Three Fiber set for layout (attributes cannot carry script).
 * - Development only: React needs eval for debug stacks, and HMR uses a websocket.
 */
export function buildCsp(nonce: string, { isDev = false }: { isDev?: boolean } = {}): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", `'nonce-${nonce}'`],
    'style-src-attr': ["'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(isDev ? ['ws:', 'wss:'] : [])],
    'worker-src': ["'self'", 'blob:'],
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'frame-ancestors': isDev ? ["'self'", '*'] : ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'manifest-src': ["'self'"],
  }
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`)
  if (!isDev) policy.push('upgrade-insecure-requests')
  return policy.join('; ')
}
