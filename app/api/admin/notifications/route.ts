import { requireAdminApi } from '@/lib/admin/access'
import { actorCan } from '@/lib/admin/roles'
import { getAdminPool } from '@/lib/db/pool'
import { getInboxCounts } from '@/lib/support/conversations'
import { countUnreadNotifications, staffViewer } from '@/lib/support/notifications'

// Polled by the admin shell every 15 s (D-009) for the notification and inbox badges.
// Counts only; no titles, names or message text.

export async function GET(request: Request) {
  const actor = await requireAdminApi(request, 'data.read')
  if (actor instanceof Response) return actor
  try {
    const db = getAdminPool()
    const notifications = await countUnreadNotifications(db, staffViewer(actor))
    const inboxUnread = actorCan(actor, 'support.read') ? (await getInboxCounts(db, actor)).unread : null
    return Response.json({ notifications, inboxUnread }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin] notification count failed', error instanceof Error ? error.name : 'unknown error')
    return Response.json({ error: 'Unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
