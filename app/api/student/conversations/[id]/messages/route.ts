import { getAdminPool } from '@/lib/db/pool'
import { scheduleDerekDraft } from '@/lib/derek/schedule'
import { requireStudentApi } from '@/lib/student/access'
import { handleError, json, jsonError, readJson, routeId } from '@/lib/student/http'
import { getStudentMessages, sendStudentMessage } from '@/lib/support/conversations'
import { parsePageParams } from '@/lib/support/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const student = await requireStudentApi(request)
  if (student instanceof Response) return student
  const id = routeId((await params).id)
  if (id == null) return jsonError(404, 'Conversation not found.')
  try {
    return json(await getStudentMessages(getAdminPool(), student, id, parsePageParams(new URL(request.url))))
  } catch (error) {
    return handleError(error, 'Messages could not be loaded.')
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const student = await requireStudentApi(request, { mutation: true })
  if (student instanceof Response) return student
  const id = routeId((await params).id)
  if (id == null) return jsonError(404, 'Conversation not found.')
  const body = await readJson(request)
  if (body instanceof Response) return body
  try {
    const result = await sendStudentMessage(getAdminPool(), student, id, body)
    scheduleDerekDraft(result.conversationId, result.triggerMessageId)
    return json({ messageId: result.messageId, duplicate: result.duplicate, saved: true }, result.duplicate ? 200 : 201)
  } catch (error) {
    return handleError(error, 'Your message was not sent. Please try again.')
  }
}
