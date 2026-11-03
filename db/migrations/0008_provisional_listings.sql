-- LockIn Consulting — provisional university listings (D-043).
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive only: columns on universities, one audit action
-- and one new view. The previous application version never reads them.
--
-- A provisional listing shows ONLY an institution's name, its official website and (when the website
-- itself names it) its city, labelled "Not yet verified", while the full record waits for review.
-- It never exposes courses, fees, rankings, acceptance rates, requirements or any other field.
--
-- A university is listed provisionally only when:
--   provisional_listing = 1      set by the research import after a live check of the official
--                                website, or by a reviewer (audited as provisional_change);
--   identity_checked_at          that check is at most 180 days old;
--   publication_status           draft or in review (unpublished = withdrawn, so hidden).
-- Once a reviewer verifies and publishes it, the same row appears through public_universities
-- instead: same id and slug, one card, now with its approved details.
--
-- Rollback: DROP VIEW public_directory_listings; drop the constraint and four columns; restore the
-- 0004 action list (only together with the code that reads them, and only if no provisional_change
-- rows exist).

ALTER TABLE universities
  ADD COLUMN provisional_listing TINYINT(1) NOT NULL DEFAULT 0 AFTER institution_type,
  ADD COLUMN identity_checked_at DATE NULL AFTER provisional_listing,
  ADD COLUMN identity_city_confirmed TINYINT(1) NOT NULL DEFAULT 0 AFTER identity_checked_at,
  ADD COLUMN identity_evidence VARCHAR(1000) NULL AFTER identity_city_confirmed,
  ADD CONSTRAINT ck_universities_provisional CHECK (
    provisional_listing = 0 OR (official_website IS NOT NULL AND identity_checked_at IS NOT NULL AND identity_evidence IS NOT NULL AND source_id IS NOT NULL)
  );

ALTER TABLE data_change_log
  MODIFY COLUMN action ENUM('create', 'update', 'submit_for_review', 'verify', 'mark_unavailable', 'publish', 'unpublish', 'rights_change', 'return_to_draft', 'reverify', 'terms_change', 'role_grant', 'role_revoke', 'staff_reply', 'status_change', 'draft_edit', 'draft_approve', 'draft_reject', 'draft_send', 'settings_change', 'support_grant', 'support_revoke', 'student_erase', 'ai_takeover', 'ai_return', 'provisional_change') NOT NULL;

-- The ONLY public source of directory entries. Verified rows come from public_universities (all of
-- its gates apply); provisional rows expose identity fields only. The two halves never overlap:
-- one needs 'published', the other 'draft' or 'in_review'.
CREATE VIEW public_directory_listings AS
SELECT pu.id, pu.destination_iso2, pu.slug, pu.name, 'verified' AS listing_state, NULL AS identity_checked_at
FROM public_universities pu
UNION ALL
SELECT u.id, u.destination_iso2, u.slug, u.name, 'provisional' AS listing_state, u.identity_checked_at
FROM universities u
WHERE u.provisional_listing = 1
  AND u.publication_status IN ('draft', 'in_review')
  AND u.official_website IS NOT NULL
  AND u.identity_checked_at >= CURDATE() - INTERVAL 180 DAY;

-- Identity fields of provisional entries only (city only when the official website names it).
CREATE VIEW public_provisional_universities AS
SELECT u.id, u.destination_iso2, u.slug, u.name, u.official_website,
       CASE WHEN u.identity_city_confirmed = 1 THEN u.city END AS city, u.identity_checked_at
FROM universities u
WHERE u.provisional_listing = 1
  AND u.publication_status IN ('draft', 'in_review')
  AND u.official_website IS NOT NULL
  AND u.identity_checked_at >= CURDATE() - INTERVAL 180 DAY;
