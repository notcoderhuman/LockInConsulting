-- LockIn Consulting — Derek's daily allowance and web-research record (Owner request, 12 Nov 2026).
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive only: two new tables and one nullable column. The previous
-- application version never reads them, so it keeps working against this schema.
--
-- derek_allowance_days   one row per student per Indian calendar day (Asia/Kolkata, computed by the application and
--                        passed in as quota_date): `delivered` counts the Derek AI answers that were saved into one of
--                        the student's conversations. CHECK (delivered <= 10) makes the database itself refuse an
--                        eleventh answer, whatever the application does.
-- derek_allowance_holds  a slot held while one draft is being generated (status 'held', with an expiry so a crashed
--                        process gives it back), then 'committed' in the same transaction that saves the message, or
--                        'released'. UNIQUE (draft_id): a retry of the same draft can never take a second slot.
-- ai_drafts.research     what web research found for one draft: sources (URL, publisher, retrieval time, page date),
--                        conflicts, outdated pages and failures, kept for the reviewer and for audit.
--
-- Human replies never touch these tables. Rollback (only together with the code that reads it):
-- DROP TABLE derek_allowance_holds; DROP TABLE derek_allowance_days; ALTER TABLE ai_drafts DROP COLUMN research;
-- and remove 0017 from schema_migrations.

CREATE TABLE derek_allowance_days (
  student_profile_id BIGINT UNSIGNED NOT NULL,
  quota_date DATE NOT NULL,
  delivered SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (student_profile_id, quota_date),
  CONSTRAINT fk_allowance_days_student FOREIGN KEY (student_profile_id) REFERENCES student_profiles (id) ON DELETE CASCADE,
  CONSTRAINT ck_allowance_delivered CHECK (delivered <= 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE derek_allowance_holds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_profile_id BIGINT UNSIGNED NOT NULL,
  quota_date DATE NOT NULL,
  draft_id BIGINT UNSIGNED NOT NULL,
  status ENUM('held', 'committed', 'released') NOT NULL DEFAULT 'held',
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_allowance_holds_draft UNIQUE (draft_id),
  KEY ix_allowance_holds_day (student_profile_id, quota_date, status, expires_at),
  CONSTRAINT fk_allowance_holds_student FOREIGN KEY (student_profile_id) REFERENCES student_profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_allowance_holds_draft FOREIGN KEY (draft_id) REFERENCES ai_drafts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ai_drafts ADD COLUMN research JSON NULL;
