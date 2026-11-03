import { getDerekStatus } from '@/lib/derek/config'
import { getAdminPool } from '@/lib/db/pool'
import { json, jsonError, requireStudentApi } from '@/lib/student/access'
import { getTeamPresence } from '@/lib/support/presence'
import { autoReplyActive, getSupportSettings } from '@/lib/support/settings'

// What the student chat shows about the team: online / reconnecting / offline, a first name, and
// whether Derek can actually answer on the team's behalf right now. Read-only.
export async function GET(request: Request) {
  const student = await requireStudentApi(request)
  if (student instanceof Response) return student
  try {
    const db = getAdminPool()
    const team = await getTeamPresence(db)
    // Only promise Derek when a cleared provider may really answer; otherwise the team follows up.
    const derekAvailable = autoReplyActive(await getSupportSettings(db), getDerekStatus())
    return json({ ...team, derekAvailable })
  } catch (error) {
    console.error('[student] presence failed', error instanceof Error ? error.name : 'unknown error')
    return jsonError(503, 'Unavailable.')
  }
}
