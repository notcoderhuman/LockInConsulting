import { requireAdminApi } from '@/lib/admin/access'
import { getAdminPool } from '@/lib/db/pool'
import { checkSameOrigin } from '@/lib/student/access'
import { handleError, json, jsonError, readJson } from '@/lib/student/http'
import { getMyAvailability, setAvailable } from '@/lib/support/availability'

// Dev's own global Online/Offline for the current admin login (lib/support/availability.ts). Server-side
// state: the routing and what students see read it from the database, never from the browser.

export async function GET(request: Request) {
  const actor = await requireAdminApi(request, 'support.reply')
  if (actor instanceof Response) return actor
  try {
    return json(await getMyAvailability(getAdminPool(), actor))
  } catch (error) {
    return handleError(error, 'Availability could not be loaded.')
  }
}

export async function POST(request: Request) {
  const crossSite = checkSameOrigin(request)
  if (crossSite) return crossSite
  const actor = await requireAdminApi(request, 'support.reply')
  if (actor instanceof Response) return actor
  const body = await readJson(request)
  if (body instanceof Response) return body
  if (typeof body.available !== 'boolean') return jsonError(400, 'Choose Online or Offline.')
  try {
    const pool = getAdminPool()
    await setAvailable(pool, actor, body.available)
    return json(await getMyAvailability(pool, actor))
  } catch (error) {
    return handleError(error, 'Availability could not be changed.')
  }
}
