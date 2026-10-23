-- LockIn Consulting — Stage 8: human takeover of a conversation, and the recorded reason when an
-- automatic Derek reply was held for a person.
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive only: two nullable columns on conversations,
-- one nullable column on ai_drafts, and two appended audit actions. Existing rows keep their
-- meaning (NULL = Derek may draft as before, no hold recorded), so the previous application
-- version keeps working against this schema.

-- A team member who takes over a conversation pauses Derek for it: no new drafts start for its
-- student messages and nothing is sent automatically, until someone explicitly returns it.
ALTER TABLE conversations
  ADD COLUMN ai_paused_by VARCHAR(36) NULL AFTER staff_last_read_id,
  ADD COLUMN ai_paused_at DATETIME(3) NULL AFTER ai_paused_by,
  ADD CONSTRAINT ck_conversations_ai_paused CHECK ((ai_paused_by IS NULL) = (ai_paused_at IS NULL));

-- Why Auto Mode did not send this draft (a short, fixed reason; never message text).
ALTER TABLE ai_drafts
  ADD COLUMN hold_reason VARCHAR(300) NULL AFTER error_code;

ALTER TABLE data_change_log
  MODIFY COLUMN action ENUM('create', 'update', 'submit_for_review', 'verify', 'mark_unavailable', 'publish', 'unpublish', 'rights_change', 'return_to_draft', 'reverify', 'terms_change', 'role_grant', 'role_revoke', 'staff_reply', 'status_change', 'draft_edit', 'draft_approve', 'draft_reject', 'draft_send', 'settings_change', 'support_grant', 'support_revoke', 'student_erase', 'ai_takeover', 'ai_return') NOT NULL;
