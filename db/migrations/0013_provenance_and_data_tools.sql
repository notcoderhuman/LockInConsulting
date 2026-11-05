-- LockIn Consulting — field provenance, data-tool tables and conditional ranking rights (5 Nov 2026).
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive only: new nullable columns, new tables, wider ENUMs
-- and one wider view. The previous application version never reads them, so it keeps working.
--
-- 1. universities: admissions_url, institution_subtype (admin detail; the public 'other' label stays
--    institution_category from 0009). courses: other_language_requirements.
-- 2. field_sources: provenance for a single field when it comes from a different page than its row's
--    source (row-level source_id stays the default). Secondary sources can never make a field verified.
-- 3. data_conflicts: queue of conflicting values and possible duplicates, resolved by a reviewer.
-- 4. import_batches: one row per bulk import file; the file hash makes re-importing the same file a no-op.
-- 5. academic_years: managed list; at most one current year (unique generated flag).
-- 6. ranking_providers: rights_status 'conditional' (accepted in principle, formal agreement pending — still
--    never displayed: the public view keeps requiring 'licensed' or 'not_required'), attribution_url.
-- 7. data_change_log: new entity types and actions for the above. Its append-only triggers are unchanged.
--
-- Rollback (only together with the code that reads them): recreate public_university_rankings as in 0007,
-- DROP the four tables, DROP the added columns and constraints, narrow the ENUMs back once no row uses
-- the new values, and remove 0013 from schema_migrations.

ALTER TABLE universities
  ADD COLUMN admissions_url VARCHAR(2048) NULL AFTER official_website,
  ADD COLUMN institution_subtype ENUM('research_university', 'university_of_applied_sciences', 'college', 'institute', 'other') NULL AFTER institution_category,
  ADD CONSTRAINT ck_universities_admissions_url CHECK (admissions_url IS NULL OR admissions_url LIKE 'https://%');

ALTER TABLE courses
  ADD COLUMN other_language_requirements TEXT NULL AFTER language_requirements;

ALTER TABLE ranking_providers
  MODIFY COLUMN rights_status ENUM('not_confirmed', 'requested', 'conditional', 'licensed', 'denied', 'not_required') NOT NULL DEFAULT 'not_confirmed',
  ADD COLUMN attribution_url VARCHAR(2048) NULL AFTER attribution_text,
  ADD CONSTRAINT ck_ranking_providers_conditional CHECK (rights_status <> 'conditional' OR (licence_reference IS NOT NULL AND rights_checked_at IS NOT NULL AND rights_notes IS NOT NULL)),
  ADD CONSTRAINT ck_ranking_providers_attribution_url CHECK (attribution_url IS NULL OR attribution_url LIKE 'https://%');

CREATE TABLE academic_years (
  code CHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  -- NULL for every non-current year, so the unique key allows exactly one current year.
  current_flag TINYINT(1) AS (IF(is_current = 1, 1, NULL)) STORED,
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (code),
  CONSTRAINT uq_academic_years_current UNIQUE (current_flag),
  CONSTRAINT ck_academic_years_code CHECK (code REGEXP '^[0-9]{4}-[0-9]{4}$' AND CAST(SUBSTRING(code, 6, 4) AS UNSIGNED) = CAST(SUBSTRING(code, 1, 4) AS UNSIGNED) + 1),
  CONSTRAINT ck_academic_years_dates CHECK (ends_on > starts_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE field_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type ENUM('university', 'campus', 'course', 'course_intake', 'tuition_fee', 'acceptance_rate', 'university_ranking') NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  field_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  accessed_on DATE NOT NULL,
  applicable_period VARCHAR(40) NULL,
  status ENUM('pending', 'verified', 'not_publicly_available', 'discontinued', 'conflicting', 'expired') NOT NULL DEFAULT 'pending',
  method ENUM('official_page', 'official_document', 'government_register', 'accreditation_body', 'secondary_discovery', 'other') NOT NULL,
  discrepancy_notes TEXT NULL,
  verified_at DATETIME NULL,
  verified_by VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_field_sources UNIQUE (entity_type, entity_id, field_name),
  KEY ix_field_sources_source (source_id),
  CONSTRAINT fk_field_sources_source FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_field_sources_field CHECK (field_name REGEXP '^[a-z][a-z0-9_]*$'),
  CONSTRAINT ck_field_sources_verified CHECK (status <> 'verified' OR (verified_at IS NOT NULL AND verified_by IS NOT NULL AND method <> 'secondary_discovery'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE import_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_name VARCHAR(255) NOT NULL,
  file_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rows_total INT UNSIGNED NOT NULL,
  created_count INT UNSIGNED NOT NULL,
  duplicate_count INT UNSIGNED NOT NULL,
  conflict_count INT UNSIGNED NOT NULL,
  imported_by VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_import_batches_file UNIQUE (file_sha256),
  CONSTRAINT ck_import_batches_sha CHECK (file_sha256 REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE data_conflicts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind ENUM('field_value', 'duplicate') NOT NULL,
  entity_type ENUM('university', 'campus', 'course', 'course_intake', 'tuition_fee', 'acceptance_rate', 'university_ranking') NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  other_entity_id BIGINT UNSIGNED NULL,
  field_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  current_value TEXT NULL,
  proposed_value TEXT NULL,
  proposed_source_id BIGINT UNSIGNED NULL,
  import_batch_id BIGINT UNSIGNED NULL,
  detail VARCHAR(500) NULL,
  status ENUM('open', 'kept_current', 'accepted_proposed', 'not_duplicate', 'duplicate_confirmed', 'dismissed') NOT NULL DEFAULT 'open',
  resolution_note VARCHAR(1000) NULL,
  resolved_by VARCHAR(191) NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_data_conflicts_open (status, kind),
  KEY ix_data_conflicts_entity (entity_type, entity_id),
  CONSTRAINT fk_data_conflicts_source FOREIGN KEY (proposed_source_id) REFERENCES sources (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_data_conflicts_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_data_conflicts_resolved CHECK (status = 'open' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL)),
  CONSTRAINT ck_data_conflicts_duplicate CHECK (kind <> 'duplicate' OR (other_entity_id IS NOT NULL AND other_entity_id <> entity_id)),
  CONSTRAINT ck_data_conflicts_field CHECK (kind <> 'field_value' OR field_name IS NOT NULL),
  CONSTRAINT ck_data_conflicts_outcome CHECK (
    status IN ('open', 'dismissed')
    OR (kind = 'duplicate' AND status IN ('not_duplicate', 'duplicate_confirmed'))
    OR (kind = 'field_value' AND status IN ('kept_current', 'accepted_proposed'))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE data_change_log
  MODIFY COLUMN entity_type ENUM('source', 'university', 'campus', 'course', 'course_intake', 'tuition_fee', 'fx_rate', 'acceptance_rate', 'ranking_provider', 'university_ranking', 'fx_provider', 'admin_member', 'conversation', 'ai_draft', 'support_settings', 'student_profile', 'academic_year', 'field_source', 'data_conflict', 'import_batch') NOT NULL,
  MODIFY COLUMN action ENUM('create', 'update', 'submit_for_review', 'verify', 'mark_unavailable', 'publish', 'unpublish', 'rights_change', 'return_to_draft', 'reverify', 'terms_change', 'role_grant', 'role_revoke', 'staff_reply', 'status_change', 'draft_edit', 'draft_approve', 'draft_reject', 'draft_send', 'settings_change', 'support_grant', 'support_revoke', 'student_erase', 'ai_takeover', 'ai_return', 'provisional_change', 'import', 'resolve_conflict') NOT NULL;

-- Same rows as 0007 (a 'conditional' provider is still never shown); adds the attribution link.
CREATE OR REPLACE VIEW public_university_rankings AS
SELECT r.id, r.university_id, r.provider_id, p.name AS provider_name, r.ranking_year, r.edition,
       r.subject, r.rank_position, r.rank_band_low, r.rank_band_high, r.source_id, r.checked_at,
       r.review_due_at, p.attribution_text, p.allow_ordering, p.allow_ai_use, p.attribution_url
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
