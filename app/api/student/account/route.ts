import { getAdminPool } from '@/lib/db/pool'
import { handleError, json, jsonError, readJson } from '@/lib/student/http'
import { requireStudentApi } from '@/lib/student/access'
import { eraseOwnAccount } from '@/lib/support/conversations'

// POST { confirm: 'DELETE' }: the signed-in student deletes their own account and data through the
// same audited erasure the Owner uses (lib/support/conversations.ts). The student comes from the
// session only; nothing in the body can name another account. Sessions go with the account.
export async function POST(request: Request) {
  const student = await requireStudentApi(request, { mutation: true })
  if (student instanceof Response) return student
  const body = await readJson(request)
  if (body instanceof Response) return body
  if (body.confirm !== 'DELETE') return jsonError(400, 'Type DELETE to confirm.')
  try {
    const { conversations } = await eraseOwnAccount(getAdminPool(), student)
    return json({ ok: true, conversationsDeleted: conversations })
  } catch (error) {
    return handleError(error, 'Your account was not deleted. Please try again, or contact LockIn.')
  }
}
