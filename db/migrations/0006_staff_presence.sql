-- LockIn Consulting — Stage 10: live team presence for the student chat.
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive only: one new table. The previous application
-- version never reads it, so it keeps working against this schema.
--
-- One row per team member who has opened the admin panel. The panel's heartbeat (POST
-- /api/admin/presence, authenticated staff with support access only) refreshes last_seen_at at
-- most every 20 s; a member counts as online while it is newer than the lease (lib/support/presence.ts).
-- Nothing else is stored: no IP, device, page or activity detail.
--
-- Rollback: DROP TABLE staff_presence; and remove 0006 from schema_migrations (only together with
-- the code that reads it).

CREATE TABLE staff_presence (
  user_id VARCHAR(36) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id),
  KEY staff_presence_last_seen_idx (last_seen_at),
  CONSTRAINT fk_staff_presence_user FOREIGN KEY (user_id) REFERENCES auth_user (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
