import { getAdminPool } from '@/lib/db/pool'
import { scheduleDerekDraft } from '@/lib/derek/schedule'
import { requireStudentApi } from '@/lib/student/access'
import { handleError, json, readJson } from '@/lib/student/http'
import { createConversation, listStudentConversations } from '@/lib/support/conversations'

// The signed-in student's own conversations. The student is derived from the session only.

export async function GET(request: Request) {
  const student = await requireStudentApi(request)
  if (student instanceof Response) return student
  try {
    return json({ conversations: await listStudentConversations(getAdminPool(), student) })
  } catch (error) {
    return handleError(error, 'Your conversations could not be loaded.')
  }
}

export async function POST(request: Request) {
  const student = await requireStudentApi(request, { mutation: true })
  if (student instanceof Response) return student
  const body = await readJson(request)
  if (body instanceof Response) return body
  try {
    const result = await createConversation(getAdminPool(), student, body)
    scheduleDerekDraft(result.conversationId, result.triggerMessageId)
    // 201 only once the conversation and message are committed.
    return json({ conversationId: result.conversationId, messageId: result.messageId, duplicate: result.duplicate, saved: true }, result.duplicate ? 200 : 201)
  } catch (error) {
    return handleError(error, 'Your question was not sent. Please try again.')
  }
}
