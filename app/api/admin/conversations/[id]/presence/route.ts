import { requireAdminApi } from '@/lib/admin/access'
import { getAdminPool } from '@/lib/db/pool'
import { checkSameOrigin } from '@/lib/student/access'
import { handleError, json, jsonError, routeId } from '@/lib/student/http'
import { claimConversation, releaseConversation } from '@/lib/support/availability'

// Heartbeat from an open admin conversation page: "Dev is in this chat" (POST), and "Dev left" (DELETE).
// Whether the student then sees Dev online, and Derek holds back, is decided on the server.

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const crossSite = checkSameOrigin(request)
  if (crossSite) return crossSite
  const actor = await requireAdminApi(request, 'support.read')
  if (actor instanceof Response) return actor
  const id = routeId((await params).id)
  if (id == null) return jsonError(404, 'Conversation not found.')
  try {
    return json(await claimConversation(getAdminPool(), actor, id))
  } catch (error) {
    return handleError(error, 'Presence could not be recorded.')
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const crossSite = checkSameOrigin(request)
  if (crossSite) return crossSite
  const actor = await requireAdminApi(request, 'support.read')
  if (actor instanceof Response) return actor
  const id = routeId((await params).id)
  if (id == null) return jsonError(404, 'Conversation not found.')
  try {
    await releaseConversation(getAdminPool(), actor, id)
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return handleError(error, 'Presence could not be cleared.')
  }
}
