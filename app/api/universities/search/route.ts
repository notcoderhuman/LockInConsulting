import { parseSearch, publicListing, publicQuery, searchUniversities } from '@/lib/data/search'
import { limitPublicRequest } from '@/lib/public-rate-limit'

// Public: search the university directory (name and city) with filters and sorting. Only the
// public_* views are read; the response carries identity fields only. A verification filter or
// status sort in an old link is ignored, so the response never reveals verification status.
export async function GET(request: Request) {
  const parsed = parseSearch(new URL(request.url).searchParams)
  if (!parsed) return Response.json({ error: 'Invalid search.' }, { status: 400 })
  const limited = await limitPublicRequest(request, 'search')
  if (limited) return limited
  const found = await searchUniversities(publicQuery(parsed))
  if (found.state !== 'ready') return Response.json({ error: 'Search is unavailable right now.' }, { status: 503 })
  return Response.json({ ...found.data, results: found.data.results.map(publicListing) }, { headers: { 'Cache-Control': 'no-store' } })
}
