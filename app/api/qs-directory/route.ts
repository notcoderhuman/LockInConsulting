import { getQsDirectory, parseQsRequest } from '@/lib/data/qs-directory'
import { limitPublicRequest } from '@/lib/public-rate-limit'

// Public: one page of the university directory (name, QS rank as printed, LockIn-verified flag) for one of the
// eleven destinations. Only public_qs_directory is read, so nothing is returned until QS is licensed.
export async function GET(request: Request) {
  const parsed = parseQsRequest(new URL(request.url).searchParams)
  if (!parsed) return Response.json({ error: 'Invalid request.' }, { status: 400 })
  const limited = await limitPublicRequest(request, 'search')
  if (limited) return limited
  const result = await getQsDirectory(parsed)
  if (result.state !== 'ready') return Response.json({ error: 'The directory is unavailable right now.' }, { status: 503 })
  const { state: _state, ...page } = result
  return Response.json(page, { headers: { 'Cache-Control': 'no-store' } })
}
