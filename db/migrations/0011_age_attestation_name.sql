-- LockIn Consulting — the student's full name, given on /age-confirm (D-046).
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive only: one nullable column the previous code never reads.
--
-- The name waits here only until it reaches its home, student_profiles.display_name (which erasure
-- already scrubs). It is cleared when the profile is created, when the attempt is revoked or the
-- unfinished sign-in is discarded; unused rows are deleted once expired, when the next one is issued.
--
-- Rollback: ALTER TABLE student_age_attestations DROP COLUMN full_name (together with the previous code).

ALTER TABLE student_age_attestations ADD COLUMN full_name VARCHAR(120) NULL AFTER policy_version;
