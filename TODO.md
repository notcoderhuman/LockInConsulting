# Implementation roadmap

Legend: `[x]` done and verified · `[~]` partial · `[ ]` not started

- [x] **Phase 0**: repository, assets and environment inspection
- [x] **Phase 1**: architecture, risks, decisions, directory data model
- [x] **Phase 2**: design tokens, typography, responsive shell, and `/admin` dashboard shell
- [x] **Phase 3**: homepage, country list and panel, `/destinations` index, 11 `/destinations/[slug]` pages
- [~] **Phase 4**: globe, IST lighting and fallbacks (done; reused on destination pages); real-device performance (pending)
- [~] **Phase 5**: university directory & governance
  - [x] Schema, migrations (`0001`, `0002`), CHECK constraints, public views, append-only triggers, migration runner
  - [x] `zod` validation, publication/ranking/FX gates, INR conversion & provider attribution rule
  - [x] Read path (`public_*` views → destination pages) tested on MySQL 8.4
  - [x] Official-link live investigation (30 verified HTTPS links across all 11 destinations; 7 WAF/timeout links isolated in `UNRESOLVED_OFFICIAL_LINKS`)
  - [x] Exchange-rate source & terms review (`ecb`, `frankfurter`, `fbil`, `imf` recorded and seeded as `not_reviewed` pending owner selection — R-016)
  - [x] Admin editor, review queue, publication workflow, and SHA-256 hash-chained + trigger-protected audit-log writes
  - [ ] Connect Hostinger MySQL / MariaDB (blocked by R-005, R-013, R-014, R-018)
  - [ ] Owner approval of FX provider(s) in `/admin/settings` (R-016)
  - [x] Audit of the supplied directory PDF: rejected as a source; 25 identity leads in `db/intake/` (R-022)
  - [x] Research checklist and private review file (`db/intake/RESEARCH-CHECKLIST.md`, `2026-10-17-initial-batch.json`). One university per destination, identity captured; validated by `tests/intake-batch.test.ts`
  - [ ] Enter batch 1 in `/admin` as drafts, with a second-person review (needs a database, so blocked by staging). **Nothing is entered or published.**
  - [ ] Browser checks for Melbourne and Khalifa homepages (bot-blocked); locate official Polimi and Helsinki fee pages
  - [ ] Real university data, entered from official sources and verified by a human reviewer in `/admin`
  - [ ] Browser check of the 8 bot-protected candidate homepages (`identity_check_blocked`)
- [x] **Phase 6**: Better Auth 1.7.8 for `/admin` (email/password, public sign-up disabled, DB rate limit, CLI provisioning via `scripts/admin-user.mjs`; OAuth and Apple deferred).
- [ ] **Phase 7**: human-reviewed support: student questions, team replies in the admin inbox. No simulated chat.
- [ ] **Phase 8**: AI provider. **Not connected by owner decision (D-002, R-001, R-002).**
- [ ] **Phase 9**: online/offline state and attribution (human replies never shown as Derek)
- [~] **Phase 10**: `/admin` dashboard
  - [x] Overview, Review Queue, Universities & child records (`campus`, `course`, `course_intake`, `tuition_fee`, `acceptance_rate`, `university_ranking`), Official Sources, Audit Change Log, and Settings (ranking rights, FX provider terms, FX rates, member roles)
  - [ ] Student Inbox, Students, Our Team (Phases 7, 11, 12)
- [ ] **Phase 11**: document upload, validation, 30-day deletion (no AI processing)
- [ ] **Phase 12**: team manager (move `lib/content/team.ts` into the DB; bio pending approved copy)
- [~] **Phase 13**: legal drafts, privacy controls, CSP enforcement, rate limits
  - [x] Enforcing nonce CSP (`proxy.ts`). Checked locally against `next start`: all scripts and stylesheets nonced, 0 violations on `/`, globe textures, fonts and images load
  - [x] Auth rate limits (5 sign-ins / 5 min, 60 req/min, DB-backed); admin fails closed
  - [ ] Real-browser and staging check of the CSP across browsers (R-023)
  - [ ] Legal drafts, privacy controls
- [ ] **Phase 14**: E2E, a11y and performance audit
- [~] **Phase 15**: Hostinger staging & production deployment and launch checklist
  - [x] Stage 4 local readiness: 90 unit tests and 46 DB tests (MySQL 8.4.9 **and** MariaDB 10.5.29), typecheck, build, production-server smoke test without configuration
  - [x] Migration safety: capability probe, migration lock, never recording partial failures, `/admin` schema gate, `pnpm db:preflight`
  - [x] Stage 5 local verification (17 Oct 2026): 103 unit tests, 46 DB tests on MySQL 8.4.9 and 46 on MariaDB 10.5.29, typecheck, production build
  - [ ] Staging environment (blocked: plan, staging hostname, empty DB + user, Remote MySQL allow-list)
  - [ ] Production (not authorised)

## Staging readiness checklist (run in order; stop at the first failure)
1. **Before buying**, get Hostinger pre-sales to confirm in writing the seven questions in R-021 for the **Unlimited** plan. Buy only once the website is complete, and only with the owner's approval. No upgrade.
2. Create a **separate** staging website (e.g. `staging.<domain>`) with Node **22.x or 24.x**. Confirm whether the build uses pnpm (R-019).
3. In hPanel, create an **empty** staging database and user. Do not reuse any production database or user.
4. In hPanel → Remote MySQL, temporarily allow-list only the operator's IP.
5. From the trusted machine: `PREFLIGHT_DATABASE_URL=... pnpm db:preflight --probe`, which must report "no blockers". Record the engine/version, `sql_mode` and binlog lines.
6. `DB_TEST_URL=<same empty staging DB> pnpm test:db`. The harness refuses non-empty databases and drops everything it creates. Never point it at production.
7. `DATABASE_URL=... pnpm db:migrate`, then rerun preflight. It should list no pending migrations.
8. In hPanel → Environment Variables (staging site only), set `DATABASE_URL`, `BETTER_AUTH_SECRET` (new, ≥ 32 chars, staging-only), `BETTER_AUTH_URL=https://staging.<domain>` and `ADMIN_DISABLED=false`. Redeploy, then restart.
9. `pnpm admin:user create --email <synthetic owner> --name "Staging Owner" --role owner`, entering the password through the hidden TTY prompt. Also create a synthetic editor.
10. Run the smoke tests (Stage 4 §6) with synthetic data only, then `pnpm admin:user verify-audit`.
11. Remove the Remote MySQL allow-list entry.

## Open items
- Confirm the Hostinger plan and its exact MySQL/MariaDB version; run `DB_TEST_URL=... pnpm test:db` against that engine (R-005, R-013, R-014)
- Owner decision on FX provider strategy (R-016). IMF needs written permission from copyright@imf.org first (commercial reuse + automated download, R-024; evidence in `db/intake/2026-10-17-imf-terms-review.md`)
- Manual browser check of the 3 listed links that block automated checks, plus the unresolved ones (`db/intake/2026-10-17-link-check.md`, R-015)
- Check the reduced-motion fallback with the OS setting enabled in a real browser
- Measure globe FPS and LCP on a mid-range Android phone
- Verify the enforcing CSP on staging in Chrome, Safari and Firefox; check `/admin` sign-in and server actions under it (R-023)
- Set `NEXT_PUBLIC_SITE_URL` once a domain exists, then rebuild

## Hostinger Unlimited suitability checklist (confirm in writing before buying; do not buy until the site is complete)
- [ ] Node.js Web App included on **Unlimited** and how many apps (R-021)
- [ ] Supported Node versions include 22.x or 24.x (Next.js 16 needs ≥ 20.9)
- [ ] Runs a persistent `next start` server. Required: every page is dynamic (CSP nonces), `proxy.ts` runs on each request, server actions. A static export is **not** possible.
- [ ] Process limits: RAM, CPU, entry processes, maximum concurrent requests, and idle-sleep behaviour
- [ ] Build: pnpm 12 support or npm-only (R-019); build-time memory; build logs
- [ ] Environment variables per website (staging separate from production); custom response headers are not stripped
- [ ] Database: engine and exact version (MySQL 8.0+/8.4 or MariaDB ≥ 10.5), enforced `CHECK`, stored generated columns, views, `CREATE TRIGGER` with binary logging (`log_bin_trust_function_creators`, R-014), `GET_LOCK`
- [ ] Database size limit, max connections per user (the app opens up to 3 pools × 5 connections), `max_user_connections`
- [ ] Remote MySQL with an IP allow-list for operator scripts (R-018)
- [ ] HTTPS certificate on the staging subdomain; HSTS not overridden
- [ ] Deployment workflow: Git deploy or upload; whether deploys overwrite files (R-006); rollback
