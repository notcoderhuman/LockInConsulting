import { getDestinationDirectory } from '@/lib/data/directory'
import { DIRECTORY_MAX as MAX, DIRECTORY_PAGE_SIZE as PAGE } from '@/lib/db/directory-queries'
import { DESTINATIONS } from '@/lib/destinations'

// Public: the next page of a destination's directory for "See more universities". The public_*
// views decide what is listed; this only checks the destination and the offset.
export async function GET(request: Request, { params }: { params: Promise<{ iso2: string }> }) {
  const { iso2 } = await params
  const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
  if (!DESTINATIONS.some((d) => d.iso2 === iso2) || !Number.isInteger(offset) || offset < 0 || offset >= MAX || offset % PAGE !== 0)
    return Response.json({ error: 'Not found.' }, { status: 404 })
  const directory = await getDestinationDirectory(iso2, offset)
  if (directory.state !== 'ready') return Response.json({ error: 'The directory could not be loaded.' }, { status: 503 })
  return Response.json({ entries: directory.entries, total: directory.total }, { headers: { 'Cache-Control': 'no-store' } })
}
