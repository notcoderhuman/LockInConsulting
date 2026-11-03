-- LockIn Consulting — 18+ self-attestation before a new student account is created (D-045).
-- Target: MySQL 8.0.19+ or MariaDB 10.5+. Additive only: one new table the previous code never reads.
--
-- /age-confirm records that a person ticked "I confirm that I am 18 years of age or older". It is a
-- self-attestation, not age or identity verification. The browser holds only a random token in an
-- HttpOnly cookie; this table holds its SHA-256, so a database read never yields a usable token.
-- The Google sign-up callback consumes the row (once, before it expires) or no account is created.
-- Nothing else is stored: no date of birth, document, IP address or user agent.
--
-- Rollback: DROP TABLE student_age_attestations (only together with the code that reads it).

CREATE TABLE student_age_attestations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_sha256 CHAR(64) NOT NULL,
  policy_version VARCHAR(40) NOT NULL,
  confirmed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  -- Set once, by the sign-up callback that used it, or when the flow is cancelled.
  consumed_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  -- The account it created (NULL if unused, or after that account is removed).
  user_id VARCHAR(36) NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_age_attestations_token UNIQUE (token_sha256),
  CONSTRAINT uq_age_attestations_user UNIQUE (user_id),
  CONSTRAINT fk_age_attestations_user FOREIGN KEY (user_id) REFERENCES auth_user (`id`) ON DELETE SET NULL,
  CONSTRAINT ck_age_attestations_once CHECK (consumed_at IS NULL OR revoked_at IS NULL),
  KEY ix_age_attestations_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
