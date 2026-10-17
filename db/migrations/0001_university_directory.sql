-- LockIn Consulting — university directory schema.
-- Target: MySQL 8.0.16+ (CHECK constraints enforced). Written to avoid MySQL-only syntax so it
-- can also run on MariaDB 10.5+, which some Hostinger plans provide (see RISKS.md R-013).
--
-- Every fact table carries the same verification columns. Two CHECK constraints enforce, per row:
--   1. A row can only be marked verified/unavailable with a source, a check date, a verifier and a
--      review-due date.
--   2. A row can only be published once verified (or verified as "not publicly available").
-- Cross-table rules (ranking rights, expiry, parent visibility) live in the public_* views, which
-- are the only surface the public site reads.
--
-- Note: MySQL forbids CHECK constraints on columns used by FK cascade actions, so `source_id`
-- uses ON DELETE RESTRICT — a source still cited by a fact can't be deleted.

CREATE TABLE destinations (
  iso2 CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (iso2),
  CONSTRAINT uq_destinations_slug UNIQUE (slug),
  CONSTRAINT ck_destinations_iso2 CHECK (iso2 REGEXP '^[A-Z]{2}$'),
  CONSTRAINT ck_destinations_slug CHECK (slug REGEXP '^[a-z]+(-[a-z]+)*$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kept in sync with lib/destinations.ts by tests/db/migrations.db.test.ts.
INSERT INTO destinations (iso2, slug) VALUES
  ('US', 'usa'), ('GB', 'uk'), ('CA', 'canada'), ('IT', 'italy'), ('DE', 'germany'),
  ('AU', 'australia'), ('NZ', 'new-zealand'), ('SA', 'saudi-arabia'), ('AE', 'uae'),
  ('FI', 'finland'), ('PL', 'poland');

CREATE TABLE sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  url VARCHAR(2048) NOT NULL,
  url_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin AS (SHA2(url, 256)) STORED,
  title VARCHAR(300) NOT NULL,
  publisher VARCHAR(200) NOT NULL,
  source_type ENUM('university_official', 'government', 'regulator', 'ranking_provider', 'exchange_rate_provider', 'other') NOT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_sources_url UNIQUE (url_sha256),
  CONSTRAINT ck_sources_https CHECK (url LIKE 'https://%'),
  CONSTRAINT ck_sources_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT ck_sources_publisher CHECK (CHAR_LENGTH(TRIM(publisher)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE universities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  destination_iso2 CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(255) NOT NULL,
  official_website VARCHAR(2048) NULL,
  city VARCHAR(120) NULL,
  sub_region VARCHAR(120) NULL,
  institution_type ENUM('public', 'private', 'unknown') NOT NULL DEFAULT 'unknown',
  publication_status ENUM('draft', 'in_review', 'published', 'unpublished') NOT NULL DEFAULT 'draft',
  verification_status ENUM('unverified', 'verified', 'unavailable') NOT NULL DEFAULT 'unverified',
  source_id BIGINT UNSIGNED NULL,
  checked_at DATE NULL,
  verified_at DATETIME NULL,
  verified_by VARCHAR(191) NULL,
  review_due_at DATE NULL,
  verification_notes TEXT NULL,
  unpublished_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_universities_slug UNIQUE (destination_iso2, slug),
  KEY ix_universities_public (destination_iso2, publication_status, verification_status),
  KEY ix_universities_review_due (review_due_at),
  CONSTRAINT fk_universities_destination FOREIGN KEY (destination_iso2) REFERENCES destinations (iso2) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_universities_source FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_universities_slug CHECK (slug REGEXP '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_universities_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT ck_universities_website CHECK (official_website IS NULL OR official_website LIKE 'https://%'),
  CONSTRAINT ck_universities_verified CHECK (verification_status = 'unverified' OR (source_id IS NOT NULL AND checked_at IS NOT NULL AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND review_due_at IS NOT NULL)),
  CONSTRAINT ck_universities_publish CHECK (publication_status <> 'published' OR verification_status = 'verified'),
  CONSTRAINT ck_universities_published_website CHECK (publication_status <> 'published' OR official_website IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE campuses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  city VARCHAR(120) NULL,
  sub_region VARCHAR(120) NULL,
  is_main TINYINT(1) NOT NULL DEFAULT 0,
  publication_status ENUM('draft', 'in_review', 'published', 'unpublished') NOT NULL DEFAULT 'draft',
  verification_status ENUM('unverified', 'verified', 'unavailable') NOT NULL DEFAULT 'unverified',
  source_id BIGINT UNSIGNED NULL,
  checked_at DATE NULL,
  verified_at DATETIME NULL,
  verified_by VARCHAR(191) NULL,
  review_due_at DATE NULL,
  verification_notes TEXT NULL,
  unpublished_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_campuses_university (university_id),
  CONSTRAINT fk_campuses_university FOREIGN KEY (university_id) REFERENCES universities (id) ON DELETE CASCADE,
  CONSTRAINT fk_campuses_source FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_campuses_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT ck_campuses_verified CHECK (verification_status = 'unverified' OR (source_id IS NOT NULL AND checked_at IS NOT NULL AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND review_due_at IS NOT NULL)),
  CONSTRAINT ck_campuses_publish CHECK (publication_status <> 'published' OR verification_status = 'verified')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE courses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  campus_id BIGINT UNSIGNED NULL,
  slug VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(255) NOT NULL,
  qualification ENUM('foundation', 'certificate', 'diploma', 'bachelor', 'master', 'doctorate', 'other') NOT NULL,
  study_level ENUM('UG', 'PG') NOT NULL,
  duration_months SMALLINT UNSIGNED NULL,
  study_mode ENUM('full_time', 'part_time', 'online', 'blended') NULL,
  teaching_language VARCHAR(60) NULL,
  entry_requirements TEXT NULL,
  language_requirements TEXT NULL,
  course_url VARCHAR(2048) NULL,
  publication_status ENUM('draft', 'in_review', 'published', 'unpublished') NOT NULL DEFAULT 'draft',
  verification_status ENUM('unverified', 'verified', 'unavailable') NOT NULL DEFAULT 'unverified',
  source_id BIGINT UNSIGNED NULL,
  checked_at DATE NULL,
  verified_at DATETIME NULL,
  verified_by VARCHAR(191) NULL,
  review_due_at DATE NULL,
  verification_notes TEXT NULL,
  unpublished_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_courses_slug UNIQUE (university_id, slug),
  KEY ix_courses_public (university_id, publication_status, verification_status),
  KEY ix_courses_level (study_level, qualification),
  CONSTRAINT fk_courses_university FOREIGN KEY (university_id) REFERENCES universities (id) ON DELETE CASCADE,
  CONSTRAINT fk_courses_campus FOREIGN KEY (campus_id) REFERENCES campuses (id) ON DELETE SET NULL,
  CONSTRAINT fk_courses_source FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_courses_slug CHECK (slug REGEXP '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_courses_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT ck_courses_duration CHECK (duration_months IS NULL OR duration_months BETWEEN 1 AND 120),
  CONSTRAINT ck_courses_url CHECK (course_url IS NULL OR course_url LIKE 'https://%'),
  CONSTRAINT ck_courses_level_match CHECK (
    (study_level = 'UG' AND qualification IN ('foundation', 'certificate', 'diploma', 'bachelor', 'other'))
    OR (study_level = 'PG' AND qualification IN ('certificate', 'diploma', 'master', 'doctorate', 'other'))
  ),
  CONSTRAINT ck_courses_verified CHECK (verification_status = 'unverified' OR (source_id IS NOT NULL AND checked_at IS NOT NULL AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND review_due_at IS NOT NULL)),
  CONSTRAINT ck_courses_publish CHECK (publication_status <> 'published' OR verification_status = 'verified')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE course_intakes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  intake_month TINYINT UNSIGNED NOT NULL,
  intake_year SMALLINT UNSIGNED NULL,
  application_deadline DATE NULL,
  publication_status ENUM('draft', 'in_review', 'published', 'unpublished') NOT NULL DEFAULT 'draft',
  verification_status ENUM('unverified', 'verified', 'unavailable') NOT NULL DEFAULT 'unverified',
  source_id BIGINT UNSIGNED NULL,
  checked_at DATE NULL,
  verified_at DATETIME NULL,
  verified_by VARCHAR(191) NULL,
  review_due_at DATE NULL,
  verification_notes TEXT NULL,
  unpublished_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_course_intakes_course (course_id, intake_year, intake_month),
  CONSTRAINT fk_course_intakes_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT fk_course_intakes_source FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_course_intakes_month CHECK (intake_month BETWEEN 1 AND 12),
  CONSTRAINT ck_course_intakes_year CHECK (intake_year IS NULL OR intake_year BETWEEN 2000 AND 2100),
  CONSTRAINT ck_course_intakes_verified CHECK (verification_status = 'unverified' OR (source_id IS NOT NULL AND checked_at IS NOT NULL AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND review_due_at IS NOT NULL)),
  CONSTRAINT ck_course_intakes_publish CHECK (publication_status <> 'published' OR verification_status = 'verified')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Money is DECIMAL in its original currency. INR is never stored here; it's derived at read time
-- from fx_rates so the rate, its date and its source are always shown alongside it.
CREATE TABLE tuition_fees (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  fee_category ENUM('international', 'domestic', 'eu_eea', 'other') NOT NULL DEFAULT 'international',
  amount DECIMAL(14, 2) NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  billing_period ENUM('per_year', 'per_semester', 'per_term', 'per_credit', 'total_programme') NOT NULL,
  academic_year VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NULL,
  valid_from DATE NULL,
  valid_to DATE NULL,
  fee_notes TEXT NULL,
  publication_status ENUM('draft', 'in_review', 'published', 'unpublished') NOT NULL DEFAULT 'draft',
  verification_status ENUM('unverified', 'verified', 'unavailable') NOT NULL DEFAULT 'unverified',
  source_id BIGINT UNSIGNED NULL,
  checked_at DATE NULL,
  verified_at DATETIME NULL,
  verified_by VARCHAR(191) NULL,
  review_due_at DATE NULL,
  verification_notes TEXT NULL,
  unpublished_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_tuition_fees_course (course_id, publication_status),
  KEY ix_tuition_fees_validity (valid_to, review_due_at),
  CONSTRAINT fk_tuition_fees_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT fk_tuition_fees_source FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_tuition_fees_currency CHECK (currency REGEXP '^[A-Z]{3}$'),
  CONSTRAINT ck_tuition_fees_amount_positive CHECK (amount IS NULL OR amount > 0),
  CONSTRAINT ck_tuition_fees_amount_presence CHECK (
    (verification_status = 'unavailable' AND amount IS NULL)
    OR (verification_status <> 'unavailable' AND amount IS NOT NULL)
  ),
  CONSTRAINT ck_tuition_fees_academic_year CHECK (academic_year IS NULL OR academic_year REGEXP '^[0-9]{4}(-[0-9]{4})?$'),
  CONSTRAINT ck_tuition_fees_validity_order CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT ck_tuition_fees_dated CHECK (verification_status <> 'verified' OR academic_year IS NOT NULL OR valid_to IS NOT NULL),
  CONSTRAINT ck_tuition_fees_verified CHECK (verification_status = 'unverified' OR (source_id IS NOT NULL AND checked_at IS NOT NULL AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND review_due_at IS NOT NULL)),
  CONSTRAINT ck_tuition_fees_publish CHECK (publication_status <> 'published' OR verification_status IN ('verified', 'unavailable'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fx_rates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  base_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quote_currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'INR',
  rate DECIMAL(20, 10) NOT NULL,
  rate_date DATE NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  retrieved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_fx_rates UNIQUE (base_currency, quote_currency, rate_date, source_id),
  KEY ix_fx_rates_latest (base_currency, quote_currency, rate_date),
  CONSTRAINT fk_fx_rates_source FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fx_rates_codes CHECK (base_currency REGEXP '^[A-Z]{3}$' AND quote_currency REGEXP '^[A-Z]{3}$'),
  CONSTRAINT ck_fx_rates_distinct CHECK (base_currency <> quote_currency),
  CONSTRAINT ck_fx_rates_positive CHECK (rate > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A rate is only stored with a written definition (e.g. "offers ÷ completed applications").
-- When a university doesn't publish one, record verification_status = 'unavailable' with no value.
CREATE TABLE acceptance_rates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NULL,
  rate_percent DECIMAL(5, 2) NULL,
  definition TEXT NOT NULL,
  applicant_scope ENUM('all', 'international', 'domestic', 'programme') NOT NULL,
  cohort_label VARCHAR(60) NOT NULL,
  publication_status ENUM('draft', 'in_review', 'published', 'unpublished') NOT NULL DEFAULT 'draft',
  verification_status ENUM('unverified', 'verified', 'unavailable') NOT NULL DEFAULT 'unverified',
  source_id BIGINT UNSIGNED NULL,
  checked_at DATE NULL,
  verified_at DATETIME NULL,
  verified_by VARCHAR(191) NULL,
  review_due_at DATE NULL,
  verification_notes TEXT NULL,
  unpublished_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_acceptance_rates_university (university_id, publication_status),
  CONSTRAINT fk_acceptance_rates_university FOREIGN KEY (university_id) REFERENCES universities (id) ON DELETE CASCADE,
  CONSTRAINT fk_acceptance_rates_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT fk_acceptance_rates_source FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_acceptance_rates_range CHECK (rate_percent IS NULL OR rate_percent BETWEEN 0 AND 100),
  CONSTRAINT ck_acceptance_rates_definition CHECK (CHAR_LENGTH(TRIM(definition)) >= 10),
  CONSTRAINT ck_acceptance_rates_cohort CHECK (CHAR_LENGTH(TRIM(cohort_label)) > 0),
  CONSTRAINT ck_acceptance_rates_value_presence CHECK (
    (verification_status = 'unavailable' AND rate_percent IS NULL)
    OR (verification_status <> 'unavailable' AND rate_percent IS NOT NULL)
  ),
  CONSTRAINT ck_acceptance_rates_verified CHECK (verification_status = 'unverified' OR (source_id IS NOT NULL AND checked_at IS NOT NULL AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND review_due_at IS NOT NULL)),
  CONSTRAINT ck_acceptance_rates_publish CHECK (publication_status <> 'published' OR verification_status IN ('verified', 'unavailable'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ranking_providers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(160) NOT NULL,
  website VARCHAR(2048) NOT NULL,
  rights_status ENUM('not_confirmed', 'requested', 'licensed', 'denied', 'not_required') NOT NULL DEFAULT 'not_confirmed',
  licence_reference VARCHAR(200) NULL,
  licence_scope TEXT NULL,
  licence_expires_at DATE NULL,
  rights_checked_at DATE NULL,
  rights_notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_ranking_providers_slug UNIQUE (slug),
  CONSTRAINT ck_ranking_providers_website CHECK (website LIKE 'https://%'),
  CONSTRAINT ck_ranking_providers_licensed CHECK (rights_status <> 'licensed' OR (licence_reference IS NOT NULL AND licence_scope IS NOT NULL AND rights_checked_at IS NOT NULL)),
  CONSTRAINT ck_ranking_providers_not_required CHECK (rights_status <> 'not_required' OR (rights_checked_at IS NOT NULL AND rights_notes IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- QS is recorded so the admin can track the rights request. Rights are NOT confirmed (RISKS.md R-004).
INSERT INTO ranking_providers (slug, name, website, rights_status, rights_notes) VALUES
  ('qs', 'QS Quacquarelli Symonds', 'https://www.topuniversities.com/', 'not_confirmed',
   'QS terms require prior written consent for commercial reproduction. No licence held.');

CREATE TABLE university_rankings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  university_id BIGINT UNSIGNED NOT NULL,
  provider_id BIGINT UNSIGNED NOT NULL,
  ranking_year SMALLINT UNSIGNED NOT NULL,
  edition VARCHAR(120) NULL,
  -- Empty string = overall ranking (kept NOT NULL so the unique key works).
  subject VARCHAR(120) NOT NULL DEFAULT '',
  rank_position INT UNSIGNED NULL,
  rank_band_low INT UNSIGNED NULL,
  rank_band_high INT UNSIGNED NULL,
  publication_status ENUM('draft', 'in_review', 'published', 'unpublished') NOT NULL DEFAULT 'draft',
  verification_status ENUM('unverified', 'verified', 'unavailable') NOT NULL DEFAULT 'unverified',
  source_id BIGINT UNSIGNED NULL,
  checked_at DATE NULL,
  verified_at DATETIME NULL,
  verified_by VARCHAR(191) NULL,
  review_due_at DATE NULL,
  verification_notes TEXT NULL,
  unpublished_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_university_rankings UNIQUE (university_id, provider_id, ranking_year, subject),
  KEY ix_university_rankings_provider (provider_id, ranking_year),
  CONSTRAINT fk_university_rankings_university FOREIGN KEY (university_id) REFERENCES universities (id) ON DELETE CASCADE,
  CONSTRAINT fk_university_rankings_provider FOREIGN KEY (provider_id) REFERENCES ranking_providers (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_university_rankings_source FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_university_rankings_year CHECK (ranking_year BETWEEN 2000 AND 2100),
  CONSTRAINT ck_university_rankings_shape CHECK (
    (rank_position IS NOT NULL AND rank_band_low IS NULL AND rank_band_high IS NULL)
    OR (rank_position IS NULL AND rank_band_low IS NOT NULL AND rank_band_high IS NOT NULL AND rank_band_low <= rank_band_high)
  ),
  CONSTRAINT ck_university_rankings_positive CHECK ((rank_position IS NULL OR rank_position >= 1) AND (rank_band_low IS NULL OR rank_band_low >= 1)),
  CONSTRAINT ck_university_rankings_verified CHECK (verification_status = 'unverified' OR (source_id IS NOT NULL AND checked_at IS NOT NULL AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND review_due_at IS NOT NULL)),
  CONSTRAINT ck_university_rankings_publish CHECK (publication_status <> 'published' OR verification_status = 'verified')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only record of every admin change. actor_id becomes the Better Auth user id in Phase 6.
CREATE TABLE data_change_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type ENUM('source', 'university', 'campus', 'course', 'course_intake', 'tuition_fee', 'fx_rate', 'acceptance_rate', 'ranking_provider', 'university_ranking') NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  action ENUM('create', 'update', 'submit_for_review', 'verify', 'mark_unavailable', 'publish', 'unpublish', 'rights_change') NOT NULL,
  actor_id VARCHAR(191) NOT NULL,
  reason VARCHAR(500) NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_data_change_log_entity (entity_type, entity_id, created_at),
  KEY ix_data_change_log_actor (actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------------------------
-- Public read surface. The website only reads these views. A row appears only when it, and every
-- parent it depends on, is published, verified and inside its review window.
-- ---------------------------------------------------------------------------------------------

CREATE VIEW public_universities AS
SELECT u.id, u.destination_iso2, u.slug, u.name, u.official_website, u.city, u.sub_region,
       u.institution_type, u.source_id, u.checked_at, u.review_due_at
FROM universities u
WHERE u.publication_status = 'published'
  AND u.verification_status = 'verified'
  AND u.review_due_at >= CURDATE();

CREATE VIEW public_courses AS
SELECT c.id, c.university_id, c.slug, c.name, c.qualification, c.study_level, c.duration_months,
       c.study_mode, c.teaching_language, c.entry_requirements, c.language_requirements, c.course_url,
       c.source_id, c.checked_at, c.review_due_at
FROM courses c
JOIN public_universities pu ON pu.id = c.university_id
WHERE c.publication_status = 'published'
  AND c.verification_status = 'verified'
  AND c.review_due_at >= CURDATE();

CREATE VIEW public_course_intakes AS
SELECT i.id, i.course_id, i.intake_month, i.intake_year, i.application_deadline,
       i.source_id, i.checked_at, i.review_due_at
FROM course_intakes i
JOIN public_courses pc ON pc.id = i.course_id
WHERE i.publication_status = 'published'
  AND i.verification_status = 'verified'
  AND i.review_due_at >= CURDATE()
  AND (i.application_deadline IS NULL OR i.application_deadline >= CURDATE());

CREATE VIEW public_tuition_fees AS
SELECT f.id, f.course_id, f.fee_category, f.amount, f.currency, f.billing_period, f.academic_year,
       f.valid_from, f.valid_to, f.fee_notes, f.verification_status, f.source_id, f.checked_at,
       f.review_due_at
FROM tuition_fees f
JOIN public_courses pc ON pc.id = f.course_id
WHERE f.publication_status = 'published'
  AND f.verification_status IN ('verified', 'unavailable')
  AND f.review_due_at >= CURDATE()
  AND (f.valid_to IS NULL OR f.valid_to >= CURDATE());

CREATE VIEW public_acceptance_rates AS
SELECT a.id, a.university_id, a.course_id, a.rate_percent, a.definition, a.applicant_scope,
       a.cohort_label, a.verification_status, a.source_id, a.checked_at, a.review_due_at
FROM acceptance_rates a
JOIN public_universities pu ON pu.id = a.university_id
WHERE a.publication_status = 'published'
  AND a.verification_status IN ('verified', 'unavailable')
  AND a.review_due_at >= CURDATE();

-- Rankings additionally require the provider's reuse rights to be licensed (and unexpired) or
-- formally recorded as not required. While QS stays 'not_confirmed', this view returns no QS rows.
CREATE VIEW public_university_rankings AS
SELECT r.id, r.university_id, r.provider_id, p.name AS provider_name, r.ranking_year, r.edition,
       r.subject, r.rank_position, r.rank_band_low, r.rank_band_high, r.source_id, r.checked_at,
       r.review_due_at
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

CREATE VIEW public_sources AS
SELECT s.id, s.url, s.title, s.publisher, s.source_type
FROM sources s;
