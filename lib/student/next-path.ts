// Where to send a student after signing in. Only the student chat is allowed, optionally with a
// conversation number, so `?next=` can never become an open redirect (no other path, host,
// protocol-relative URL or encoded trick gets through).

export const CHAT_PATH = '/chat'

export function safeNextPath(raw: unknown): string {
  if (typeof raw !== 'string') return CHAT_PATH
  return /^\/chat(?:\?c=[1-9]\d{0,15})?$/.test(raw) ? raw : CHAT_PATH
}

/** The sign-in page for a student who should come back to `next` afterwards. */
export function authPathFor(next: string = CHAT_PATH, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ ...extra, next: safeNextPath(next) })
  return `/auth?${params}`
}
