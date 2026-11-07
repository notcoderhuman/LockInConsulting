// Retired: the old research listings (verified and provisional entries with their websites) are no longer public.
// The one public directory is /api/qs-directory (name, QS rank, LockIn-verified flag).
export function GET() {
  return Response.json({ error: 'This endpoint was retired. The university directory is at /api/qs-directory.' }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
}
