-- LockIn Consulting — Stage 3: administrator authentication, roles, tamper-evident audit log,
-- exchange-rate provider approval and capture of "not published" figures.
-- Target: MySQL 8.0.19+ or MariaDB 10.5+ (DROP CONSTRAINT and CHECK are supported by both).

-- ---------------------------------------------------------------------------------------------
-- Better Auth 1.7.8 core tables. Column names and types are exactly what Better Auth's own
-- MySQL migration generator produced for these model names (see scripts/README in ARCHITECTURE.md).
-- Public sign-up is disabled in lib/auth.ts; users are created only by scripts/admin-user.mjs.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE auth_user (
  `id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `emailVerified` BOOLEAN NOT NULL,
  `image` TEXT NULL,
  `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT uq_auth_user_email UNIQUE (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auth_session (
  `id` VARCHAR(36) NOT NULL,
  `expiresAt` TIMESTAMP(3) NOT NULL,
  `token` VARCHAR(255) NOT NULL,
  `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` TIMESTAMP(3) NOT NULL,
  `ipAddress` TEXT NULL,
  `userAgent` TEXT NULL,
  `userId` VARCHAR(36) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT uq_auth_session_token UNIQUE (`token`),
  KEY auth_session_userId_idx (`userId`),
  CONSTRAINT fk_auth_session_user FOREIGN KEY (`userId`) REFERENCES auth_user (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auth_account (
  `id` VARCHAR(36) NOT NULL,
  `accountId` TEXT NOT NULL,
  `providerId` TEXT NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `accessToken` TEXT NULL,
  `refreshToken` TEXT NULL,
  `idToken` TEXT NULL,
  `accessTokenExpiresAt` TIMESTAMP(3) NULL,
  `refreshTokenExpiresAt` TIMESTAMP(3) NULL,
  `scope` TEXT NULL,
  `password` TEXT NULL,
  `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY auth_account_userId_idx (`userId`),
  CONSTRAINT fk_auth_account_user FOREIGN KEY (`userId`) REFERENCES auth_user (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auth_verification (
  `id` VARCHAR(36) NOT NULL,
  `identifier` VARCHAR(255) NOT NULL,
  `value` TEXT NOT NULL,
  `expiresAt` TIMESTAMP(3) NOT NULL,
  `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY auth_verification_identifier_idx (`identifier`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Shared sign-in rate limiting that survives restarts and works across Node processes.
CREATE TABLE auth_rate_limit (
  `id` VARCHAR(36) NOT NULL,
  `key` VARCHAR(255) NOT NULL,
  `count` INT NOT NULL,
  `lastRequest` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT uq_auth_rate_limit_key UNIQUE (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------------------------
-- Authorisation. Having an auth_user row grants nothing: every admin request also needs an
-- active admin_members row. Roles: editor (capture) < reviewer (verify/publish) < owner (rights).
-- ---------------------------------------------------------------------------------------------

CREATE TABLE admin_members (
  user_id VARCHAR(36) NOT NULL,
  role ENUM('editor', 'reviewer', 'owner') NOT NULL,
  status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
  granted_by VARCHAR(191) NOT NULL,
  granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_admin_members_user FOREIGN KEY (user_id) REFERENCES auth_user (`id`) ON DELETE CASCADE,
  CONSTRAINT ck_admin_members_revoked CHECK (
    (status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------------------------
-- Sources: record when the editor retrieved the page and who added it.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE sources
  ADD COLUMN retrieved_at DATE NULL AFTER source_type,
  ADD COLUMN added_by VARCHAR(191) NULL AFTER notes;

-- ---------------------------------------------------------------------------------------------
-- Capture of "not published" figures. Stage 2 required an amount on every unverified fee, which
-- made it impossible to draft a fee the university doesn't publish. Now: verified needs a value,
-- unavailable needs no value, and an unverified draft may be either. Publication rules unchanged.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE tuition_fees DROP CONSTRAINT ck_tuition_fees_amount_presence;
ALTER TABLE tuition_fees ADD CONSTRAINT ck_tuition_fees_amount_presence CHECK (
  verification_status = 'unverified'
  OR (verification_status = 'unavailable' AND amount IS NULL)
  OR (verification_status = 'verified' AND amount IS NOT NULL)
);

ALTER TABLE acceptance_rates DROP CONSTRAINT ck_acceptance_rates_value_presence;
ALTER TABLE acceptance_rates ADD CONSTRAINT ck_acceptance_rates_value_presence CHECK (
  verification_status = 'unverified'
  OR (verification_status = 'unavailable' AND rate_percent IS NULL)
  OR (verification_status = 'verified' AND rate_percent IS NOT NULL)
);

-- ---------------------------------------------------------------------------------------------
-- Exchange-rate providers. A rate is only usable once its provider's terms (coverage,
-- attribution, update frequency) have been reviewed and approved by an owner.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE fx_providers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(160) NOT NULL,
  website VARCHAR(2048) NOT NULL,
  terms_url VARCHAR(2048) NOT NULL,
  terms_status ENUM('not_reviewed', 'approved', 'rejected') NOT NULL DEFAULT 'not_reviewed',
  currencies_covered VARCHAR(300) NULL,
  attribution_text VARCHAR(500) NULL,
  update_frequency VARCHAR(200) NULL,
  terms_checked_at DATE NULL,
  terms_reviewed_by VARCHAR(191) NULL,
  terms_notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_fx_providers_slug UNIQUE (slug),
  CONSTRAINT ck_fx_providers_urls CHECK (website LIKE 'https://%' AND terms_url LIKE 'https://%'),
  CONSTRAINT ck_fx_providers_approved CHECK (
    terms_status <> 'approved'
    OR (currencies_covered IS NOT NULL AND attribution_text IS NOT NULL AND update_frequency IS NOT NULL
        AND terms_checked_at IS NOT NULL AND terms_reviewed_by IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Candidate providers. Researched 15 Oct 2026 (see RISKS.md R-016): all remain unapproved ('not_reviewed'),
-- so no INR estimates can appear publicly until an owner explicitly approves a provider's terms.
INSERT INTO fx_providers (slug, name, website, terms_url, terms_status, currencies_covered, update_frequency, terms_notes) VALUES
  ('ecb', 'European Central Bank — euro foreign exchange reference rates',
   'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',
   'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html',
   'not_reviewed',
   'EUR base; covers USD, GBP, CAD, AUD, NZD, PLN and INR. Does NOT cover SAR or AED.',
   'Around 16:00 CET on TARGET working days.',
   'ECB statistics may be reused free of charge with source attribution ("Source: European Central Bank") and no distortion. ECB states reference rates are for information purposes only and discourages transaction use. INR values are cross rates derived from EUR. Does not cover SAR or AED.'),
  ('frankfurter', 'Frankfurter (open-source central-bank rate aggregator)',
   'https://frankfurter.dev/',
   'https://frankfurter.dev/license/',
   'not_reviewed',
   'Aggregates ECB, IMF, FBIL, NBP, InforEuro and other central banks; currency coverage depends on the selected upstream provider.',
   'Daily (varies by upstream central-bank provider).',
   'MIT-licensed software, but Frankfurter states it does not own the underlying rates and cannot grant rights that the upstream central bank does not grant. Blended default rates are Frankfurter calculations, not official institutional rates. Must be scoped to an approved upstream provider.'),
  ('fbil', 'Financial Benchmarks India (FBIL) — RBI reference rates',
   'https://www.fbil.org.in/#/refrates',
   'https://www.fbil.org.in/#/termsandcondition',
   'not_reviewed',
   'INR base; covers USD, GBP, EUR, AED (plus JPY, RUB, IDR). Does NOT cover CAD, AUD, NZD, PLN or SAR.',
   'Indian business days (published with delay on public web; commercial redistribution restricted).',
   'FBIL terms restrict commercial redistribution and systematic extraction without a licence. Covers AED/INR but lacks CAD, AUD, NZD, PLN and SAR.'),
  ('imf', 'International Monetary Fund — representative exchange rates',
   'https://www.imf.org/external/np/fin/ert/GUI/Pages/CountryDataBase.aspx',
   'https://www.imf.org/en/about/copyright-and-terms',
   'not_reviewed',
   'USD/SDR pivot; covers INR, USD, GBP, CAD, EUR, AUD, NZD, SAR, AED and PLN (not all currencies report on every business day).',
   'Daily on reporting business days.',
   'IMF Copyright and Usage (Special Terms for Statistical Data) permits downloading, extracting, creating derivative works and publishing IMF statistical/exchange-rate data with accurate attribution ("Source: International Monetary Fund") and explicit disclosure of any material transformation (such as cross-rate calculation to INR). Owner review required before approval.');

ALTER TABLE fx_rates
  ADD COLUMN provider_id BIGINT UNSIGNED NULL AFTER source_id,
  ADD COLUMN entered_by VARCHAR(191) NULL AFTER retrieved_at,
  ADD CONSTRAINT fk_fx_rates_provider FOREIGN KEY (provider_id) REFERENCES fx_providers (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The only FX surface the public site reads. Rates without an approved provider never appear.
CREATE VIEW public_fx_rates AS
SELECT f.id, f.base_currency, f.quote_currency, f.rate, f.rate_date, f.source_id,
       p.name AS provider_name, p.attribution_text
FROM fx_rates f
JOIN fx_providers p ON p.id = f.provider_id
WHERE p.terms_status = 'approved';

-- ---------------------------------------------------------------------------------------------
-- Audit log: more entity types and actions, plus a SHA-256 hash chain. Each row's hash covers
-- the previous row's hash, so editing or deleting any row breaks verification from that point.
-- audit_chain_head is locked FOR UPDATE inside every write transaction to serialise appends.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE data_change_log
  MODIFY COLUMN entity_type ENUM('source', 'university', 'campus', 'course', 'course_intake', 'tuition_fee', 'fx_rate', 'acceptance_rate', 'ranking_provider', 'university_ranking', 'fx_provider', 'admin_member') NOT NULL,
  MODIFY COLUMN action ENUM('create', 'update', 'submit_for_review', 'verify', 'mark_unavailable', 'publish', 'unpublish', 'rights_change', 'return_to_draft', 'reverify', 'terms_change', 'role_grant', 'role_revoke') NOT NULL,
  ADD COLUMN actor_role VARCHAR(20) NULL AFTER actor_id,
  ADD COLUMN prev_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD CONSTRAINT uq_data_change_log_row_hash UNIQUE (row_hash);

CREATE TABLE audit_chain_head (
  id TINYINT UNSIGNED NOT NULL,
  last_log_id BIGINT UNSIGNED NULL,
  last_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT ck_audit_chain_head_singleton CHECK (id = 1)
) ENGINE=InnoDB;

INSERT INTO audit_chain_head (id, last_log_id, last_hash)
VALUES (1, NULL, '0000000000000000000000000000000000000000000000000000000000000000');

-- ---------------------------------------------------------------------------------------------
-- Immutability triggers. Sources, exchange rates and audit-log rows are append-only:
--   - sources cannot be updated or deleted once recorded (citations must stay stable).
--   - fx_rates cannot be updated or deleted once entered.
--   - data_change_log cannot be updated or deleted (tamper-evident audit trail).
-- Note: MySQL/MariaDB single-statement triggers require no DELIMITER change.
-- ---------------------------------------------------------------------------------------------

CREATE TRIGGER tr_sources_no_update BEFORE UPDATE ON sources
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sources is append-only: updates are not allowed';

CREATE TRIGGER tr_sources_no_delete BEFORE DELETE ON sources
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sources is append-only: deletes are not allowed';

CREATE TRIGGER tr_fx_rates_no_update BEFORE UPDATE ON fx_rates
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fx_rates is append-only: updates are not allowed';

CREATE TRIGGER tr_fx_rates_no_delete BEFORE DELETE ON fx_rates
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fx_rates is append-only: deletes are not allowed';

CREATE TRIGGER tr_change_log_no_update BEFORE UPDATE ON data_change_log
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'data_change_log is append-only: updates are not allowed';

CREATE TRIGGER tr_change_log_no_delete BEFORE DELETE ON data_change_log
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'data_change_log is append-only: deletes are not allowed';
