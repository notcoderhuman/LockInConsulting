import { requireAdminApi } from '@/lib/admin/access'
import { getAdminPool } from '@/lib/db/pool'
import { inboxPulse } from '@/lib/support/pulse'

// Polled every few seconds by the Live Inbox pages (components/admin/live-refresh.tsx). Returns one opaque
// change token, never names or message text: the page reloads itself only when the token changes.
// `?c=<id>` scopes it to one conversation. Same permission as the Live Inbox itself.

export async function GET(request: Request) {
  const actor = await requireAdminApi(request, 'support.read')
  if (actor instanceof Response) return actor
  const raw = Number(new URL(request.url).searchParams.get('c'))
  const conversationId = Number.isSafeInteger(raw) && raw > 0 ? raw : null
  try {
    return Response.json({ token: await inboxPulse(getAdminPool(), conversationId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin] inbox pulse failed', error instanceof Error ? error.name : 'unknown error')
    return Response.json({ error: 'Unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
