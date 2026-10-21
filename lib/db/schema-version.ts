// Every migration the running code depends on. /admin refuses to run (fails closed) unless all of
// them are recorded in schema_migrations — e.g. after a migration that failed partway, which can
// leave tables without their protective triggers. tests/schema-version.test.ts keeps this list in
// sync with db/migrations/.
export const REQUIRED_MIGRATIONS = ['0001_university_directory.sql', '0002_admin_auth.sql', '0003_support_chat.sql'] as const
