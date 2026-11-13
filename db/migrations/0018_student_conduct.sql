-- LockIn Consulting — student conduct record: misuse incidents and account restrictions (Owner request, 13 Nov 2026).
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive only: two new tables. The previous application version never reads them,
-- so it keeps working against this schema.
--
-- student_abuse_incidents  one row per student message Derek refused as misuse. category A = ordinary off-topic or a question
--                          about LockIn's internals (a polite refusal, nothing more); B = a warning or cooldown because such
--                          requests repeated; C = an attempt to obtain credentials, secrets, other students' data or system
--                          internals, or to bypass security. `evidence` is a short redacted excerpt of the message, kept for
--                          staff review only. UNIQUE (message_id): a retry of the same message can never record it twice.
-- student_restrictions     an account restriction (the student's status becomes 'suspended'). `reason` and `policy` are the
--                          wording the student is shown and emailed; no internal rules or thresholds are ever stored here.
--                          email_claimed_at / email_sent_at make the notice email send exactly once. Staff can lift a
--                          restriction after review (status 'lifted', reviewed_by, review_note) or record an appeal.
--
-- Rollback (only together with the code that reads it): DROP TABLE student_restrictions; DROP TABLE student_abuse_incidents;
-- and remove 0018 from schema_migrations.

CREATE TABLE student_abuse_incidents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_profile_id BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NULL,
  message_id BIGINT UNSIGNED NULL,
  category ENUM('A', 'B', 'C') NOT NULL,
  kind ENUM('off_topic', 'internals', 'injection', 'security') NOT NULL,
  reason VARCHAR(300) NOT NULL,
  evidence VARCHAR(300) NULL,
  action ENUM('refused', 'warned', 'cooldown', 'blocked', 'restricted') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_abuse_incidents_message UNIQUE (message_id),
  KEY ix_abuse_incidents_student (student_profile_id, created_at),
  CONSTRAINT fk_abuse_incidents_student FOREIGN KEY (student_profile_id) REFERENCES student_profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_abuse_incidents_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL,
  CONSTRAINT fk_abuse_incidents_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE student_restrictions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_profile_id BIGINT UNSIGNED NOT NULL,
  incident_id BIGINT UNSIGNED NULL,
  status ENUM('active', 'appealed', 'lifted') NOT NULL DEFAULT 'active',
  policy VARCHAR(120) NOT NULL,
  reason VARCHAR(300) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  email_claimed_at DATETIME(3) NULL,
  email_sent_at DATETIME(3) NULL,
  email_error VARCHAR(120) NULL,
  appeal_note VARCHAR(1000) NULL,
  reviewed_by VARCHAR(191) NULL,
  review_note VARCHAR(500) NULL,
  reviewed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_restrictions_incident UNIQUE (incident_id),
  KEY ix_restrictions_student (student_profile_id, status),
  CONSTRAINT fk_restrictions_student FOREIGN KEY (student_profile_id) REFERENCES student_profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_restrictions_incident FOREIGN KEY (incident_id) REFERENCES student_abuse_incidents (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
