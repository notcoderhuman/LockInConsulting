import { requireAdminApi } from '@/lib/admin/access'
import { getReviewQueue } from '@/lib/admin/queries'
import { getAdminPool } from '@/lib/db/pool'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const actor = await requireAdminApi(request, 'data.read')
  if (actor instanceof Response) return actor
  const items = await getReviewQueue(getAdminPool())
  return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}
