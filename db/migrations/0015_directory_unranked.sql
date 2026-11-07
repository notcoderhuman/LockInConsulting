-- LockIn Consulting — universities QS does not rank, listed after the ranked ones (Owner decision, 7 Nov 2026).
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. One additive column, and public_qs_directory redefined with the same
-- columns plus is_ranked. Nothing existing is changed for rows already shown.
--
-- directory_unranked = 1 marks a university the Owner chose to list although QS 2027 does not rank it. It is listed
-- WITHOUT any rank, after every ranked university of its destination, alphabetically, within the same 50-per-destination
-- cut. It is never listed if it has a QS 2027 overall rank row (then it is a ranked university, or one beyond the cut),
-- if it is hidden/archived (listing_hidden), or if it is not a university. Like the ranked part, the whole view stays
-- dark unless the QS licence is recorded as licensed with attribution and ordering allowed.
-- 'verified' keeps its meaning: LockIn itself published and verified the university.
--
-- Rollback (only together with the code that reads it): recreate public_qs_directory as in 0014, then
-- ALTER TABLE universities DROP COLUMN directory_unranked, and remove 0015 from schema_migrations.

ALTER TABLE universities
  ADD COLUMN directory_unranked TINYINT(1) NOT NULL DEFAULT 0 AFTER listing_hidden;

DROP VIEW public_qs_directory;

CREATE SQL SECURITY INVOKER VIEW public_qs_directory AS
SELECT x.id, x.destination_iso2, x.slug, x.name, x.is_ranked, x.rank_order, x.rank_position, x.rank_band_low, x.rank_band_high, x.rank_label, x.verified,
       x.attribution_text, x.attribution_url
FROM (
  SELECT y.*,
         ROW_NUMBER() OVER (PARTITION BY y.destination_iso2 ORDER BY y.is_ranked DESC, y.rank_order, y.name, y.id) AS destination_position
  FROM (
    SELECT u.id, u.destination_iso2, u.slug, u.name, 1 AS is_ranked,
           COALESCE(r.rank_position, r.rank_band_low) AS rank_order, r.rank_position, r.rank_band_low, r.rank_band_high, r.rank_label,
           (u.publication_status = 'published' AND u.verification_status = 'verified') AS verified,
           p.attribution_text, p.attribution_url
    FROM university_rankings r
    JOIN ranking_providers p ON p.id = r.provider_id
    JOIN universities u ON u.id = r.university_id
    WHERE p.slug = 'qs'
      AND p.rights_status = 'licensed'
      AND (p.licence_expires_at IS NULL OR p.licence_expires_at >= CURDATE())
      AND p.allow_ordering = 1
      AND p.attribution_text IS NOT NULL AND p.attribution_url IS NOT NULL
      AND r.ranking_year = 2027 AND r.subject = ''
      AND r.source_id IS NOT NULL
      AND r.publication_status <> 'unpublished'
      AND r.verification_status <> 'unavailable'
      AND u.listing_hidden = 0
      AND u.institution_category = 'university'
    UNION ALL
    SELECT u.id, u.destination_iso2, u.slug, u.name, 0 AS is_ranked,
           NULL AS rank_order, NULL AS rank_position, NULL AS rank_band_low, NULL AS rank_band_high, NULL AS rank_label,
           (u.publication_status = 'published' AND u.verification_status = 'verified') AS verified,
           p.attribution_text, p.attribution_url
    FROM universities u
    JOIN ranking_providers p ON p.slug = 'qs'
    WHERE p.rights_status = 'licensed'
      AND (p.licence_expires_at IS NULL OR p.licence_expires_at >= CURDATE())
      AND p.allow_ordering = 1
      AND p.attribution_text IS NOT NULL AND p.attribution_url IS NOT NULL
      AND u.directory_unranked = 1
      AND u.listing_hidden = 0
      AND u.institution_category = 'university'
      AND NOT EXISTS (
        SELECT 1 FROM university_rankings r2 WHERE r2.university_id = u.id AND r2.provider_id = p.id AND r2.ranking_year = 2027 AND r2.subject = ''
      )
  ) y
) x
WHERE x.destination_position <= 50;
