-- LockIn Consulting — the public QS directory: exact rank labels and one public view.
-- Target: MySQL 8.0.19+ or MariaDB 10.5+ (window functions). Additive: one nullable column and one new view.
-- Nothing existing is changed, so the previous release keeps working against this schema.
--
-- rank_label stores the rank exactly as the ranking provider prints it: "45", "=45" (a tie), "731-740" (a band) or
-- "1401+" (an open band with no upper bound). rank_position (or rank_band_low for a band) keeps the number for
-- ordering (45, 45, 731, 1401). The label is optional: without one a position is shown as "#45".
--
-- public_qs_directory is the ONLY source of the public university directory (card = name, QS rank, verified badge).
-- Everything it shows is gated in the database, in the same way as public_university_rankings:
--   * the provider is QS (slug 'qs') and its reuse rights are 'licensed' (not conditional, not expired), with the
--     attribution text and link recorded and the licence covering ordering and display (allow_ordering = 1);
--     until the Owner records that executed licence in Admin → Settings, this view returns no rows at all;
--   * the QS 2027 overall rank (subject '') of a university that is not hidden from the public directory
--     (listing_hidden = 0) and whose rank cites its source. The rank rows themselves may still be drafts: QS is the
--     source and the licence is the gate, so ranks are not reviewed one by one (unlike public_university_rankings);
--     only a rank marked unpublished or unavailable is withheld;
--   * at most 50 universities per destination, best global rank first (ties by name, then id).
-- 'verified' is 1 only when the university itself is published (it passed LockIn's own review workflow);
-- it is never inferred from QS, from a website check or from a rank.
--
-- Rollback (only together with the code that reads it): DROP VIEW public_qs_directory; then
-- ALTER TABLE university_rankings DROP CONSTRAINT ck_university_rankings_label, DROP COLUMN rank_label;
-- and remove 0014 from schema_migrations.

ALTER TABLE university_rankings
  ADD COLUMN rank_label VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER rank_position,
  ADD CONSTRAINT ck_university_rankings_label CHECK (rank_label IS NULL OR rank_label REGEXP '^=?[0-9]{1,4}([-][0-9]{1,4}|[+])?$');

CREATE VIEW public_qs_directory AS
SELECT x.id, x.destination_iso2, x.slug, x.name, x.rank_order, x.rank_position, x.rank_band_low, x.rank_band_high, x.rank_label, x.verified,
       x.attribution_text, x.attribution_url
FROM (
  SELECT u.id, u.destination_iso2, u.slug, u.name, COALESCE(r.rank_position, r.rank_band_low) AS rank_order, r.rank_position, r.rank_band_low, r.rank_band_high, r.rank_label,
         (u.publication_status = 'published' AND u.verification_status = 'verified') AS verified,
         p.attribution_text, p.attribution_url,
         ROW_NUMBER() OVER (PARTITION BY u.destination_iso2 ORDER BY COALESCE(r.rank_position, r.rank_band_low), u.name, u.id) AS destination_position
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
) x
WHERE x.destination_position <= 50;
