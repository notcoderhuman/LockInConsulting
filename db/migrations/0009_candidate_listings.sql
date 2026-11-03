-- LockIn Consulting — every researched candidate listed publicly, with honest labels (D-044).
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive: two columns on universities and the two 0008
-- views redefined (same names and columns, plus three). Verification status is never read to widen
-- what is shown and never written by being listed.
--
-- Unpublished candidates appear in one of two identity states:
--   checked   provisional_listing = 1, a live official-website check at most 180 days old (as 0008):
--             name, official website, check date and (when the website names it) city;
--   pending   anything else waiting for review: NAME ONLY, labelled "Identity/source check pending".
--             No website (it may be wrong), no city, no date.
-- Only records submitted for review (in_review) are listed as pending; a draft an editor is still
-- typing is not. listing_hidden = 1 (set by a reviewer, audited) removes a record from the public
-- directory entirely. institution_category = 'other' labels "Other institution type — classification
-- pending" (e.g. a polytechnic or a branch campus), so it is never presented as a university.
--
-- Rollback: recreate the two views from 0008, then drop the two columns (only together with the code
-- that reads them).

ALTER TABLE universities
  ADD COLUMN listing_hidden TINYINT(1) NOT NULL DEFAULT 0 AFTER identity_evidence,
  ADD COLUMN institution_category ENUM('university', 'other') NOT NULL DEFAULT 'university' AFTER listing_hidden;

DROP VIEW public_directory_listings;
DROP VIEW public_provisional_universities;

-- Identity fields of unpublished candidates only. The CASEs keep the website, city and date out of
-- a pending entry.
CREATE VIEW public_provisional_universities AS
SELECT c.id, c.destination_iso2, c.slug, c.name, c.identity_status, c.institution_category,
       CASE WHEN c.identity_status = 'checked' THEN c.official_website END AS official_website,
       CASE WHEN c.identity_status = 'checked' AND c.identity_city_confirmed = 1 THEN c.city END AS city,
       CASE WHEN c.identity_status = 'checked' THEN c.identity_checked_at END AS identity_checked_at
FROM (
  SELECT u.*,
         CASE WHEN u.provisional_listing = 1 AND u.official_website IS NOT NULL
                   AND u.identity_checked_at >= CURDATE() - INTERVAL 180 DAY THEN 'checked' ELSE 'pending' END AS identity_status
  FROM universities u
  WHERE u.listing_hidden = 0
    AND (u.publication_status = 'in_review' OR (u.publication_status = 'draft' AND u.provisional_listing = 1))
) c;

-- The ONLY public source of directory entries. The halves never overlap: 'published' vs draft/in_review.
CREATE VIEW public_directory_listings AS
SELECT pu.id, pu.destination_iso2, pu.slug, pu.name, 'verified' AS listing_state, NULL AS identity_checked_at
FROM public_universities pu
UNION ALL
SELECT p.id, p.destination_iso2, p.slug, p.name, 'provisional' AS listing_state, p.identity_checked_at
FROM public_provisional_universities p;
