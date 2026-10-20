import { getAdminPool } from '@/lib/db/pool'
import { requireStudentApi } from '@/lib/student/access'
import { handleError, json, readJson } from '@/lib/student/http'
import { countUnreadNotifications, listNotifications, markNotificationsRead, studentViewer } from '@/lib/support/notifications'

// A student only ever sees notifications addressed to their own account.

export async function GET(request: Request) {
  const student = await requireStudentApi(request)
  if (student instanceof Response) return student
  try {
    const viewer = studentViewer(student.userId)
    const db = getAdminPool()
    const [items, unread] = await Promise.all([listNotifications(db, viewer, { limit: 20 }), countUnreadNotifications(db, viewer)])
    return json({ notifications: items, unread })
  } catch (error) {
    return handleError(error, 'Notifications could not be loaded.')
  }
}

export async function POST(request: Request) {
  const student = await requireStudentApi(request, { mutation: true })
  if (student instanceof Response) return student
  const body = await readJson(request)
  if (body instanceof Response) return body
  try {
    const ids = body.ids === 'all' ? 'all' : Array.isArray(body.ids) ? body.ids.map(Number) : []
    const marked = await markNotificationsRead(getAdminPool(), studentViewer(student.userId), ids)
    return json({ marked })
  } catch (error) {
    return handleError(error)
  }
}
