-- LockIn Consulting — ranking licence terms (QS permission, 26 Oct 2026; D-042).
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive only: three columns and a wider view. The
-- previous application version never reads them, so it keeps working against this schema.
--
-- A licence switches on showing a provider's rankings (unchanged: licensed + unexpired, or not
-- required). Two further uses need their own owner-recorded permission, both off by default:
--   allow_ordering  — sort and select the public directory by this provider's rank
--   allow_ai_use    — let Derek quote the rank in text sent to the AI provider
-- attribution_text is the wording the provider requires next to every rank shown.
--
-- Rollback: recreate public_university_rankings as in 0001, DROP the three columns, and remove 0007
-- from schema_migrations (only together with the code that reads them).

ALTER TABLE ranking_providers
  ADD COLUMN attribution_text VARCHAR(500) NULL AFTER licence_scope,
  ADD COLUMN allow_ordering TINYINT(1) NOT NULL DEFAULT 0 AFTER attribution_text,
  ADD COLUMN allow_ai_use TINYINT(1) NOT NULL DEFAULT 0 AFTER allow_ordering;

-- Same rows as 0001; only the three provider columns are added.
CREATE OR REPLACE VIEW public_university_rankings AS
SELECT r.id, r.university_id, r.provider_id, p.name AS provider_name, r.ranking_year, r.edition,
       r.subject, r.rank_position, r.rank_band_low, r.rank_band_high, r.source_id, r.checked_at,
       r.review_due_at, p.attribution_text, p.allow_ordering, p.allow_ai_use
FROM university_rankings r
JOIN ranking_providers p ON p.id = r.provider_id
JOIN public_universities pu ON pu.id = r.university_id
WHERE r.publication_status = 'published'
  AND r.verification_status = 'verified'
  AND r.review_due_at >= CURDATE()
  AND (
    (p.rights_status = 'licensed' AND (p.licence_expires_at IS NULL OR p.licence_expires_at >= CURDATE()))
    OR p.rights_status = 'not_required'
  );
