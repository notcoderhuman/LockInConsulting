import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'

// boot-migrate.mjs is loaded from disk, not bundled: bundling makes the file tracer scan the whole
// project into the build. mysql2 is passed in because only the bundled app can resolve it there.
export async function bootMigrate() {
  const entry = pathToFileURL(`${process.cwd()}/lib/db/boot-migrate.mjs`).href
  // Production builds use Webpack (Hostinger's glibc cannot run Turbopack); next dev uses Turbopack.
  const { runBootMigration } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ entry)
  await runBootMigration(mysql)
}
