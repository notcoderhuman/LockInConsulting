import { requireAdminApi } from '@/lib/admin/access'
import { getChainStatus } from '@/lib/admin/queries'
import { getAdminPool } from '@/lib/db/pool'

export const dynamic = 'force-dynamic'

/** Audit-chain integrity check. Owners only: it reveals the size of the change history. */
export async function GET(request: Request) {
  const actor = await requireAdminApi(request, 'members.read')
  if (actor instanceof Response) return actor
  const status = await getChainStatus(getAdminPool())
  return Response.json(status, { headers: { 'Cache-Control': 'no-store' } })
}
