import { getDerekStatus } from '@/lib/derek/config'
import { getAdminPool } from '@/lib/db/pool'
import { json, jsonError, requireStudentApi } from '@/lib/student/access'
import { presenceForStudent } from '@/lib/support/availability'
import { autoReplyActive, getSupportSettings } from '@/lib/support/settings'

// What the student chat shows about the team, for THIS student only: online only while a team member who chose
// to appear online to them has one of their conversations open (lib/support/availability.ts); otherwise offline,
// and whether Derek can actually answer right now. `joinedAt` identifies one "has joined your chat" event so
// several tabs notify once. Read-only; never says anything about other students.
export async function GET(request: Request) {
  const student = await requireStudentApi(request)
  if (student instanceof Response) return student
  try {
    const db = getAdminPool()
    const handler = await presenceForStudent(db, student.profileId)
    // Only promise Derek when a cleared provider may really answer; otherwise the team follows up.
    const derekAvailable = autoReplyActive(await getSupportSettings(db), getDerekStatus())
    return json(
      handler
        ? { state: 'online', name: handler.name, conversationId: handler.conversationId, joinedAt: handler.joinedAt, derekAvailable }
        : { state: 'offline', name: null, conversationId: null, joinedAt: null, derekAvailable },
    )
  } catch (error) {
    console.error('[student] presence failed', error instanceof Error ? error.name : 'unknown error')
    return jsonError(503, 'Unavailable.')
  }
}
