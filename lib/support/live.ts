// Shared by both live views (student chat, Live Inbox): polling cadence and message merging.
// Polling asks the existing endpoints only for what is new (an id cursor), so a quiet conversation costs one
// small query every few seconds. MariaDB stays the source of truth; nothing here keeps its own copy.

export const POLL_MS = 3_000
export const MAX_BACKOFF_MS = 30_000

/** Next wait: the normal beat after a good poll, doubling (to a cap) after each failure. */
export function nextDelay(current: number, ok: boolean): number {
  return ok ? POLL_MS : Math.min(MAX_BACKOFF_MS, Math.max(current, POLL_MS) * 2)
}

/** Appends messages not already shown, oldest first. Returns the same array when nothing is new, so React skips the render. */
export function mergeNew<T extends { id: number }>(shown: T[], incoming: T[]): T[] {
  if (!incoming.length) return shown
  const seen = new Set(shown.map((m) => m.id))
  const fresh = incoming.filter((m) => !seen.has(m.id))
  if (!fresh.length) return shown
  return [...shown, ...fresh].sort((a, b) => a.id - b.id)
}

/** The highest message id shown, or 0. */
export const lastId = (shown: { id: number }[]): number => shown.reduce((max, m) => (m.id > max ? m.id : max), 0)
