import { requireAdminApi } from '@/lib/admin/access'
import { getAdminPool } from '@/lib/db/pool'
import { checkSameOrigin } from '@/lib/student/access'
import { touchPresence } from '@/lib/support/presence'

// Heartbeat from the admin panel (lib/support/presence.ts). Only a signed-in team member who may
// reply to students is recorded; everyone else gets the usual 401/403 and nothing is written.

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  const crossSite = checkSameOrigin(request)
  if (crossSite) return crossSite
  const actor = await requireAdminApi(request, 'support.reply')
  if (actor instanceof Response) return actor
  try {
    await touchPresence(getAdminPool(), actor.userId)
    return new Response(null, { status: 204, headers: NO_STORE })
  } catch (error) {
    console.error('[admin] presence heartbeat failed', error instanceof Error ? error.name : 'unknown error')
    return Response.json({ error: 'Unavailable.' }, { status: 503, headers: NO_STORE })
  }
}
