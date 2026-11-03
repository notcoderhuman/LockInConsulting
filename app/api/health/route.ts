import type { RowDataPacket } from 'mysql2/promise'
import { getAdminPool } from '@/lib/db/pool'
import { REQUIRED_MIGRATIONS } from '@/lib/db/schema-version'

export const dynamic = 'force-dynamic'

const reply = (status: number, body: Record<string, string>) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

// Public, so it says only whether the site can serve: no versions, names, counts or error text.
export async function GET() {
  if (!process.env.DATABASE_URL) return reply(503, { status: 'unavailable', database: 'not_configured' })
  try {
    const [rows] = await getAdminPool().query<RowDataPacket[]>('SELECT name FROM schema_migrations')
    const applied = new Set(rows.map((r) => String(r.name)))
    if (!REQUIRED_MIGRATIONS.every((m) => applied.has(m))) return reply(503, { status: 'unavailable', database: 'ok', migrations: 'incomplete' })
    return reply(200, { status: 'ok', database: 'ok', migrations: 'complete' })
  } catch (e) {
    console.error(`Health check failed: ${(e as { code?: string }).code ?? 'error'}`)
    return reply(503, { status: 'unavailable', database: 'error' })
  }
}
