-- LockIn Consulting — Stage 7: persistent student support chat, Derek drafts with human review,
-- conversation state history and in-site notifications.
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Uses only features 0001/0002 already rely on (CHECK,
-- single-statement SIGNAL triggers, foreign keys), so the existing capability probe covers it.
--
-- Nothing here enables student accounts. Student sign-up stays disabled (lib/auth.ts) and the
-- student chat fails closed unless STUDENT_ACCOUNTS_ENABLED=true (docs/ENVIRONMENT.md).

-- ---------------------------------------------------------------------------------------------
-- Student identity. A student is an auth_user with an active student_profiles row and NO
-- admin_members row; an administrator is the reverse. lib/admin/access.ts and
-- lib/student/access.ts each refuse a user who holds both.
-- After erasure the row stays as a tombstone (user_id NULL, name scrubbed) so audit entries that
-- reference its numeric id still resolve, while the account and every message are gone.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE student_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(36) NULL,
  display_name VARCHAR(120) NOT NULL,
  status ENUM('active', 'suspended', 'erased') NOT NULL DEFAULT 'active',
  -- Recorded only once the age-eligibility and privacy-notice flow exists (legal review pending).
  age_confirmed_at DATETIME(3) NULL,
  privacy_notice_version VARCHAR(40) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  erased_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_student_profiles_user UNIQUE (user_id),
  CONSTRAINT fk_student_profiles_user FOREIGN KEY (user_id) REFERENCES auth_user (`id`) ON DELETE SET NULL,
  CONSTRAINT ck_student_profiles_erased CHECK ((status = 'erased') = (erased_at IS NOT NULL)),
  CONSTRAINT ck_student_profiles_name CHECK (CHAR_LENGTH(display_name) BETWEEN 1 AND 120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Editors only handle student conversations when an owner explicitly authorises it.
ALTER TABLE admin_members ADD COLUMN support_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER status;

-- ---------------------------------------------------------------------------------------------
-- Support mode. Owner-controlled singleton. Automatic replies are off by default and are only
-- honoured at send time when the AI provider, legal clearance and this setting all allow it
-- (lib/derek/config.ts).
-- ---------------------------------------------------------------------------------------------

CREATE TABLE support_settings (
  id TINYINT UNSIGNED NOT NULL,
  support_mode ENUM('online', 'offline') NOT NULL DEFAULT 'online',
  auto_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by VARCHAR(191) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT ck_support_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB;

INSERT INTO support_settings (id, support_mode, auto_reply_enabled) VALUES (1, 'online', FALSE);

-- ---------------------------------------------------------------------------------------------
-- Conversations and messages.
-- State machine (lib/support/state.ts): open, awaiting_human_review, awaiting_student_reply,
-- resolved, failed. Every change is recorded in conversation_events.
-- Unread: staff see a conversation as unread while last_student_message_id > staff_last_read_id;
-- a student's unread count is replies with id > student_last_read_id.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_profile_id BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(160) NOT NULL,
  status ENUM('open', 'awaiting_human_review', 'awaiting_student_reply', 'resolved', 'failed') NOT NULL DEFAULT 'open',
  client_request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_message_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_student_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  student_last_read_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  staff_last_read_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- A retried "start conversation" request returns the first conversation instead of a duplicate.
  CONSTRAINT uq_conversations_request UNIQUE (student_profile_id, client_request_id),
  KEY ix_conversations_status (status, last_message_at),
  KEY ix_conversations_student (student_profile_id, last_message_at),
  CONSTRAINT fk_conversations_student FOREIGN KEY (student_profile_id) REFERENCES student_profiles (id) ON DELETE CASCADE,
  CONSTRAINT ck_conversations_subject CHECK (CHAR_LENGTH(subject) BETWEEN 1 AND 160)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- author_kind is the ONLY attribution source shown to students:
--   student → the student; staff → the named team member (author_user_id);
--   derek   → Derek, the AI assistant. reviewed_by is the human who approved that exact draft
--             revision, or NULL when it was sent automatically. A human-written reply can never
--             be stored as 'derek' (draft_id is required) and Derek's text can never be stored as
--             'staff' (draft_id must be NULL).
CREATE TABLE messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  author_kind ENUM('student', 'staff', 'derek') NOT NULL,
  author_user_id VARCHAR(36) NULL,
  reviewed_by VARCHAR(36) NULL,
  draft_id BIGINT UNSIGNED NULL,
  body TEXT NOT NULL,
  client_request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_messages_conversation (conversation_id, id),
  KEY ix_messages_author (author_user_id, created_at),
  -- Double-clicked or retried sends are stored once.
  CONSTRAINT uq_messages_request UNIQUE (conversation_id, author_kind, client_request_id),
  -- A draft is delivered at most once, whoever (human or worker) tries to send it.
  CONSTRAINT uq_messages_draft UNIQUE (draft_id),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT ck_messages_body CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 4000),
  CONSTRAINT ck_messages_attribution CHECK (
    (author_kind = 'derek' AND author_user_id IS NULL AND draft_id IS NOT NULL)
    OR (author_kind IN ('student', 'staff') AND author_user_id IS NOT NULL AND draft_id IS NULL AND reviewed_by IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conversation_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  from_status ENUM('open', 'awaiting_human_review', 'awaiting_student_reply', 'resolved', 'failed') NULL,
  to_status ENUM('open', 'awaiting_human_review', 'awaiting_student_reply', 'resolved', 'failed') NOT NULL,
  actor_kind ENUM('student', 'staff', 'derek', 'system') NOT NULL,
  actor_id VARCHAR(191) NULL,
  reason VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_conversation_events_conversation (conversation_id, id),
  CONSTRAINT fk_conversation_events_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------------------------
-- Derek drafts. One draft per student message (UNIQUE trigger_message_id), so two workers can
-- never generate or send two answers to the same question. Text lives in append-only revisions;
-- an edit creates a new revision, and an approval names the revision number AND its SHA-256, so
-- editing after approval invalidates that approval.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE ai_drafts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  trigger_message_id BIGINT UNSIGNED NOT NULL,
  status ENUM('generating', 'ready', 'sent', 'rejected', 'superseded', 'failed') NOT NULL DEFAULT 'generating',
  current_revision INT UNSIGNED NOT NULL DEFAULT 0,
  risk_level ENUM('low', 'uncertain', 'high') NULL,
  risk_reasons TEXT NULL,
  evidence_refs TEXT NULL,
  provider VARCHAR(40) NOT NULL,
  model VARCHAR(120) NULL,
  input_tokens INT UNSIGNED NULL,
  output_tokens INT UNSIGNED NULL,
  latency_ms INT UNSIGNED NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(60) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_ai_drafts_trigger UNIQUE (trigger_message_id),
  KEY ix_ai_drafts_conversation (conversation_id, status),
  CONSTRAINT fk_ai_drafts_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_drafts_trigger FOREIGN KEY (trigger_message_id) REFERENCES messages (id) ON DELETE CASCADE,
  CONSTRAINT ck_ai_drafts_ready CHECK (status NOT IN ('ready', 'sent') OR (current_revision > 0 AND risk_level IS NOT NULL)),
  CONSTRAINT ck_ai_drafts_failed CHECK (status <> 'failed' OR error_code IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ai_draft_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  draft_id BIGINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  body_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_kind ENUM('derek', 'staff') NOT NULL,
  created_by VARCHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_ai_draft_revisions UNIQUE (draft_id, revision),
  CONSTRAINT fk_ai_draft_revisions_draft FOREIGN KEY (draft_id) REFERENCES ai_drafts (id) ON DELETE CASCADE,
  CONSTRAINT ck_ai_draft_revisions_body CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 4000),
  CONSTRAINT ck_ai_draft_revisions_author CHECK ((created_by_kind = 'derek') = (created_by IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE draft_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  draft_id BIGINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  body_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decision ENUM('approve', 'reject') NOT NULL,
  reviewer_id VARCHAR(36) NOT NULL,
  reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_draft_reviews_draft (draft_id, revision),
  CONSTRAINT fk_draft_reviews_draft FOREIGN KEY (draft_id) REFERENCES ai_drafts (id) ON DELETE CASCADE,
  CONSTRAINT ck_draft_reviews_reason CHECK (decision <> 'reject' OR CHAR_LENGTH(reason) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------------------------
-- In-site notifications (no email, Telegram or other external channel).
-- audience 'user' → one recipient (staff or student). 'staff_support' → every member allowed to
-- read support conversations. 'staff_review' → every member allowed to review directory data.
-- Titles never contain message text or student contact details. Read state is per user.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  audience ENUM('user', 'staff_support', 'staff_review') NOT NULL,
  recipient_user_id VARCHAR(36) NULL,
  kind ENUM('new_question', 'student_reply', 'human_review', 'draft_ready', 'high_risk', 'ai_failure', 'review_overdue', 'staff_reply') NOT NULL,
  conversation_id BIGINT UNSIGNED NULL,
  title VARCHAR(200) NOT NULL,
  target_path VARCHAR(300) NOT NULL,
  dedupe_key VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT uq_notifications_dedupe UNIQUE (dedupe_key),
  KEY ix_notifications_audience (audience, created_at),
  KEY ix_notifications_recipient (recipient_user_id, created_at),
  CONSTRAINT fk_notifications_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT ck_notifications_recipient CHECK ((audience = 'user') = (recipient_user_id IS NOT NULL)),
  -- Same-site paths only: never an absolute or protocol-relative URL.
  CONSTRAINT ck_notifications_target CHECK (target_path LIKE '/%' AND target_path NOT LIKE '//%' AND target_path NOT LIKE '%\\\\%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_reads (
  notification_id BIGINT UNSIGNED NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  read_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (notification_id, user_id),
  KEY ix_notification_reads_user (user_id),
  CONSTRAINT fk_notification_reads_notification FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------------------------
-- Audit log: support actions are hash-chained like directory changes. Entries carry ids, statuses
-- and SHA-256 digests only — never message text — because the audit log is permanent while
-- student messages must remain erasable.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE data_change_log
  MODIFY COLUMN entity_type ENUM('source', 'university', 'campus', 'course', 'course_intake', 'tuition_fee', 'fx_rate', 'acceptance_rate', 'ranking_provider', 'university_ranking', 'fx_provider', 'admin_member', 'conversation', 'ai_draft', 'support_settings', 'student_profile') NOT NULL,
  MODIFY COLUMN action ENUM('create', 'update', 'submit_for_review', 'verify', 'mark_unavailable', 'publish', 'unpublish', 'rights_change', 'return_to_draft', 'reverify', 'terms_change', 'role_grant', 'role_revoke', 'staff_reply', 'status_change', 'draft_edit', 'draft_approve', 'draft_reject', 'draft_send', 'settings_change', 'support_grant', 'support_revoke', 'student_erase') NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- Immutability. Messages, state history, draft revisions and review decisions cannot be edited
-- or deleted directly. Erasure deletes the conversation; InnoDB foreign-key cascades do not fire
-- triggers, so the cascade removes the dependent rows (tested in tests/db/support.db.test.ts).
-- ---------------------------------------------------------------------------------------------

CREATE TRIGGER tr_messages_no_update BEFORE UPDATE ON messages
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'messages is append-only: updates are not allowed';

CREATE TRIGGER tr_messages_no_delete BEFORE DELETE ON messages
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'messages can only be removed by erasing their conversation';

CREATE TRIGGER tr_conversation_events_no_update BEFORE UPDATE ON conversation_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'conversation_events is append-only: updates are not allowed';

CREATE TRIGGER tr_conversation_events_no_delete BEFORE DELETE ON conversation_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'conversation_events can only be removed by erasing their conversation';

CREATE TRIGGER tr_ai_draft_revisions_no_update BEFORE UPDATE ON ai_draft_revisions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ai_draft_revisions is append-only: updates are not allowed';

CREATE TRIGGER tr_ai_draft_revisions_no_delete BEFORE DELETE ON ai_draft_revisions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ai_draft_revisions can only be removed by erasing their conversation';

CREATE TRIGGER tr_draft_reviews_no_update BEFORE UPDATE ON draft_reviews
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'draft_reviews is append-only: updates are not allowed';

CREATE TRIGGER tr_draft_reviews_no_delete BEFORE DELETE ON draft_reviews
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'draft_reviews can only be removed by erasing their conversation';
