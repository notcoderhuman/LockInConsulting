import { getAdminPool } from '@/lib/db/pool'
import { requireStudentApi } from '@/lib/student/access'
import { handleError, json, jsonError, routeId } from '@/lib/student/http'
import { markStudentRead } from '@/lib/support/conversations'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const student = await requireStudentApi(request, { mutation: true })
  if (student instanceof Response) return student
  const id = routeId((await params).id)
  if (id == null) return jsonError(404, 'Conversation not found.')
  try {
    await markStudentRead(getAdminPool(), student, id)
    return json({ ok: true })
  } catch (error) {
    return handleError(error)
  }
}
