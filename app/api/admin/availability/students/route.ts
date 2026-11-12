import { requireAdminApi } from '@/lib/admin/access'
import { getAdminPool } from '@/lib/db/pool'
import { checkSameOrigin } from '@/lib/student/access'
import { handleError, json, jsonError, readJson } from '@/lib/student/http'
import { getMyAvailability, setStudentVisible } from '@/lib/support/availability'

// Dev's individual Online/Offline for one student, for the current admin login (lib/support/availability.ts).
export async function POST(request: Request) {
  const crossSite = checkSameOrigin(request)
  if (crossSite) return crossSite
  const actor = await requireAdminApi(request, 'support.reply')
  if (actor instanceof Response) return actor
  const body = await readJson(request)
  if (body instanceof Response) return body
  const id = Number(body.studentProfileId)
  if (!Number.isSafeInteger(id) || id <= 0 || typeof body.visible !== 'boolean') return jsonError(400, 'Choose a student and Online or Offline.')
  try {
    const pool = getAdminPool()
    await setStudentVisible(pool, actor, id, body.visible)
    return json(await getMyAvailability(pool, actor))
  } catch (error) {
    return handleError(error, 'Visibility could not be changed.')
  }
}
