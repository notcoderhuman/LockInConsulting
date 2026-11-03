// Next.js calls this once per server start and waits for it before serving. Migrations run only on
// a deliberate boot; every other start does nothing (see lib/db/boot-migrate.mjs).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.MIGRATE_ON_BOOT === '1') {
    const { bootMigrate } = await import('./lib/db/boot-entry')
    await bootMigrate()
  }
}
