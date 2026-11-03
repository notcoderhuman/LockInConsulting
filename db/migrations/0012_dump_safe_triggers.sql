-- LockIn Consulting — make the append-only triggers survive mysqldump.
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Same triggers, same refusals, same messages; no data touched.
--
-- A single-statement trigger created over a multi-statement connection keeps its final semicolon in
-- the stored definition. mysqldump then writes "...; */;;", which mysql refuses on restore (ERROR 1064),
-- so a plain dump could not be restored, and forcing past the error would silently lose these triggers.
-- A BEGIN ... END body is stored without that semicolon. Found by a restore test on MySQL 8.4.
--
-- Run during a quiet moment: each trigger is absent for an instant between its DROP and CREATE.
-- Rollback: not needed; the older form is functionally identical.

DROP TRIGGER tr_sources_no_update;
CREATE TRIGGER tr_sources_no_update BEFORE UPDATE ON sources
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sources is append-only: updates are not allowed'; END;

DROP TRIGGER tr_sources_no_delete;
CREATE TRIGGER tr_sources_no_delete BEFORE DELETE ON sources
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sources is append-only: deletes are not allowed'; END;

DROP TRIGGER tr_fx_rates_no_update;
CREATE TRIGGER tr_fx_rates_no_update BEFORE UPDATE ON fx_rates
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fx_rates is append-only: updates are not allowed'; END;

DROP TRIGGER tr_fx_rates_no_delete;
CREATE TRIGGER tr_fx_rates_no_delete BEFORE DELETE ON fx_rates
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fx_rates is append-only: deletes are not allowed'; END;

DROP TRIGGER tr_change_log_no_update;
CREATE TRIGGER tr_change_log_no_update BEFORE UPDATE ON data_change_log
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'data_change_log is append-only: updates are not allowed'; END;

DROP TRIGGER tr_change_log_no_delete;
CREATE TRIGGER tr_change_log_no_delete BEFORE DELETE ON data_change_log
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'data_change_log is append-only: deletes are not allowed'; END;

DROP TRIGGER tr_messages_no_update;
CREATE TRIGGER tr_messages_no_update BEFORE UPDATE ON messages
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'messages is append-only: updates are not allowed'; END;

DROP TRIGGER tr_messages_no_delete;
CREATE TRIGGER tr_messages_no_delete BEFORE DELETE ON messages
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'messages can only be removed by erasing their conversation'; END;

DROP TRIGGER tr_conversation_events_no_update;
CREATE TRIGGER tr_conversation_events_no_update BEFORE UPDATE ON conversation_events
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'conversation_events is append-only: updates are not allowed'; END;

DROP TRIGGER tr_conversation_events_no_delete;
CREATE TRIGGER tr_conversation_events_no_delete BEFORE DELETE ON conversation_events
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'conversation_events can only be removed by erasing their conversation'; END;

DROP TRIGGER tr_ai_draft_revisions_no_update;
CREATE TRIGGER tr_ai_draft_revisions_no_update BEFORE UPDATE ON ai_draft_revisions
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ai_draft_revisions is append-only: updates are not allowed'; END;

DROP TRIGGER tr_ai_draft_revisions_no_delete;
CREATE TRIGGER tr_ai_draft_revisions_no_delete BEFORE DELETE ON ai_draft_revisions
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ai_draft_revisions can only be removed by erasing their conversation'; END;

DROP TRIGGER tr_draft_reviews_no_update;
CREATE TRIGGER tr_draft_reviews_no_update BEFORE UPDATE ON draft_reviews
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'draft_reviews is append-only: updates are not allowed'; END;

DROP TRIGGER tr_draft_reviews_no_delete;
CREATE TRIGGER tr_draft_reviews_no_delete BEFORE DELETE ON draft_reviews
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'draft_reviews can only be removed by erasing their conversation'; END;
