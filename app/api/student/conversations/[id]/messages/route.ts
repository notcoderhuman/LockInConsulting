import { getAdminPool } from '@/lib/db/pool'
import { failAbandonedDrafts, handOffToDerek } from '@/lib/derek/drafts'
import { scheduleDerekDraft } from '@/lib/derek/schedule'
import { requireStudentApi } from '@/lib/student/access'
import { handleError, json, jsonError, readJson, routeId } from '@/lib/student/http'
import { getStudentMessages, sendStudentMessage } from '@/lib/support/conversations'
import { conversationHandler } from '@/lib/support/availability'
import { parsePageParams } from '@/lib/support/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const student = await requireStudentApi(request)
  if (student instanceof Response) return student
  const id = routeId((await params).id)
  if (id == null) return jsonError(404, 'Conversation not found.')
  try {
    const pool = getAdminPool()
    const page = parsePageParams(new URL(request.url))
    await failAbandonedDrafts(pool, id).catch(() => 0) // a dead worker must not leave the question behind a spinner
    const view = await getStudentMessages(pool, student, id, page) // also proves the conversation is this student's
    // Nobody is handling this chat (Dev left it, went Offline, or never entered): Derek may take over now (lib/derek/drafts.ts).
    if (view.conversation.acknowledgement && page.before == null && !(await conversationHandler(pool, id))) {
      const handoff = await handOffToDerek(pool, id).catch((error) => {
        console.error('[derek] handoff failed', error instanceof Error ? error.name : 'unknown error')
        return { state: 'none' as const }
      })
      if (handoff.state === 'sent') return json(await getStudentMessages(pool, student, id, page))
    }
    return json(view)
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
