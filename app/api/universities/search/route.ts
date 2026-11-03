import { parseSearch, searchUniversities } from '@/lib/data/search'
import { limitPublicRequest } from '@/lib/public-rate-limit'

// Public: search the university directory (name and city) with filters and sorting. Only the
// public_* views are read; the response carries identity fields and verification status only.
export async function GET(request: Request) {
  const query = parseSearch(new URL(request.url).searchParams)
  if (!query) return Response.json({ error: 'Invalid search.' }, { status: 400 })
  const limited = await limitPublicRequest(request, 'search')
  if (limited) return limited
  const found = await searchUniversities(query)
  if (found.state !== 'ready') return Response.json({ error: 'Search is unavailable right now.' }, { status: 503 })
  return Response.json(found.data, { headers: { 'Cache-Control': 'no-store' } })
}
