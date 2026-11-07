// Every migration the running code depends on. /admin refuses to run (fails closed) unless all of
// them are recorded in schema_migrations — e.g. after a migration that failed partway, which can
// leave tables without their protective triggers. tests/schema-version.test.ts keeps this list in
// sync with db/migrations/.
export const REQUIRED_MIGRATIONS = ['0001_university_directory.sql', '0002_admin_auth.sql', '0003_support_chat.sql', '0004_derek_handoff.sql', '0005_auto_reply_default.sql', '0006_staff_presence.sql', '0007_ranking_licence_uses.sql', '0008_provisional_listings.sql', '0009_candidate_listings.sql', '0010_age_attestations.sql', '0011_age_attestation_name.sql', '0012_dump_safe_triggers.sql', '0013_provenance_and_data_tools.sql', '0014_qs_directory.sql'] as const
