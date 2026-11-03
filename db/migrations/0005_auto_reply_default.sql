-- LockIn Consulting — Stage 9: routine automatic replies on by default.
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Data and default only: no column is added or removed.
--
-- The owner's "automatic replies" switch becomes a kill switch that starts ON. It still sends
-- nothing a model wrote unless lib/derek/config.ts permits the provider (adapter declaration AND
-- DEREK_AUTO_REPLY_CLEARED for that provider id); with no cleared provider, only LockIn's own
-- fixed replies (greeting, thanks, scope refusal) are sent automatically. Every other gate
-- (risk level, takeover, resolved or suspended conversations, caps, send-time checks) is unchanged.
-- An owner who already changed the setting keeps their choice (updated_by is set).

ALTER TABLE support_settings
  ALTER COLUMN auto_reply_enabled SET DEFAULT TRUE;

UPDATE support_settings SET auto_reply_enabled = TRUE WHERE id = 1 AND updated_by IS NULL;
