import { lookupUniversities, parseLookupKeys, publicListing } from '@/lib/data/search'
import { limitPublicRequest } from '@/lib/public-rate-limit'

// Public: the current state of universities saved or viewed on a device (`?u=US:slug`, up to 50).
// The device's list never leaves the browser except as these public keys; nothing is stored here.
export async function GET(request: Request) {
  const keys = parseLookupKeys(new URL(request.url).searchParams)
  if (!keys) return Response.json({ error: 'Invalid request.' }, { status: 400 })
  const limited = await limitPublicRequest(request, 'lookup')
  if (limited) return limited
  const found = await lookupUniversities(keys)
  if (found.state !== 'ready') return Response.json({ error: 'Unavailable right now.' }, { status: 503 })
  // Identity fields only: verification status is not public.
  return Response.json({ results: found.data.map(publicListing) }, { headers: { 'Cache-Control': 'no-store' } })
}
