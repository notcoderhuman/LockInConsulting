-- LockIn Consulting — Dev availability, per-student visibility and active-chat presence (Owner request, 12 Nov 2026).
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive only: two columns and two new tables. The previous application
-- version never reads them, so it keeps working against this schema.
--
-- Three separate facts, all scoped to ONE admin login session (auth_session.id), so a new sign-in starts Offline
-- with every student Offline, a page refresh keeps them, and signing out (the session row is deleted) ends them:
--
--   staff_presence.available           global availability: the team member switched themself Online for this session
--   staff_student_visibility           individual eligibility: the students they chose to appear online to (this session)
--   conversation_presence              active-chat presence: the team member has this conversation open right now
--                                      (heartbeat lease; one holder per conversation, so two people cannot both claim it)
--
-- A student sees the team member online, and Derek holds back, only when all three hold for that student's
-- conversation and the heartbeats are fresh (lib/support/availability.ts). Everything else means Derek answers.
--
-- Rollback (only together with the code that reads it): DROP TABLE conversation_presence; DROP TABLE
-- staff_student_visibility; ALTER TABLE staff_presence DROP COLUMN availability_session_id, DROP COLUMN available;
-- and remove 0016 from schema_migrations.

ALTER TABLE staff_presence
  ADD COLUMN available TINYINT(1) NOT NULL DEFAULT 0 AFTER last_seen_at,
  ADD COLUMN availability_session_id VARCHAR(36) NULL AFTER available;

CREATE TABLE staff_student_visibility (
  user_id VARCHAR(36) NOT NULL,
  student_profile_id BIGINT UNSIGNED NOT NULL,
  session_id VARCHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, student_profile_id),
  KEY staff_student_visibility_student_idx (student_profile_id),
  CONSTRAINT fk_visibility_user FOREIGN KEY (user_id) REFERENCES auth_user (`id`) ON DELETE CASCADE,
  CONSTRAINT fk_visibility_student FOREIGN KEY (student_profile_id) REFERENCES student_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conversation_presence (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  session_id VARCHAR(36) NOT NULL,
  joined_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  PRIMARY KEY (conversation_id),
  KEY conversation_presence_user_idx (user_id),
  CONSTRAINT fk_conversation_presence_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_presence_user FOREIGN KEY (user_id) REFERENCES auth_user (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
