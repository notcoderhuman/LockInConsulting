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
  - [x] Research checklist (`db/intake/RESEARCH-CHECKLIST.md`) and a private review file (initial batch). One university per destination, identity captured; validated by `tests/intake-batch.test.ts` when `LOCKIN_RESEARCH_DIR` points at the private research
  - [x] Stage 6: 33 genuine universities researched (3 per destination across all 11 destinations) with verified official websites, degree programmes, international fees, language and entry requirements, and deadlines (research batch and report kept outside this public repository since 23 Oct 2026; validated by `tests/intake-batch-stage6.test.ts` with `LOCKIN_RESEARCH_DIR`). Status: `pending_admin_entry`.
  - [ ] Enter batches in `/admin` as drafts, with a second-person review (needs a database, so blocked by staging). **Nothing is entered or published.**
  - [ ] Real university data, entered from official sources and verified by a human reviewer in `/admin`
- [x] **Phase 6**: Better Auth 1.7.8 for `/admin` (email/password, public sign-up disabled, DB rate limit, CLI provisioning via `scripts/admin-user.mjs`; OAuth and Apple deferred).
- [~] **Phase 7**: human-reviewed support. Stage 7: persistent conversations/messages (`0003`), student chat `/support` + `/api/student/*`, Live Inbox, Students, notifications, erasure; DB-tested on MySQL 8.4 (`tests/db/support.db.test.ts`) and browser-tested locally with synthetic data. **Not open to students** (R-026). Still to do: MariaDB/Hostinger run (R-031), age/consent/privacy flow, retention schedule, abuse reporting/blocking.
- [~] **Phase 8**: AI provider. Provider interface, mock, safeguards, draft/review workflow done (D-030, D-031). Gemini `gemini-3.5-flash-lite` adapter implemented with interlocks and mocked tests (D-035). **Not live:** supervised smoke test pending owner approval; real use blocked by R-026/R-027 (18+ verification, paid tier).
- [x] **Phase 9**: online/offline mode (owner setting) and DB-enforced attribution (D-032)
- [~] **Phase 10**: `/admin` dashboard
  - [x] Overview, Review Queue, Universities & child records (`campus`, `course`, `course_intake`, `tuition_fee`, `acceptance_rate`, `university_ranking`), Official Sources, Audit Change Log, and Settings (ranking rights, FX provider terms, FX rates, member roles)
  - [x] Live Inbox, Students, Our Team (members: revoke + editor support delegation), Notifications, real support counts on Overview (Stage 7)
  - [ ] Our Team public profiles in the DB (still `lib/content/team.ts`, D-010)
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
  - [x] Phase E re-run at `d8a0e64` (17 Oct 2026): 103/103 unit, 46/46 DB (default MySQL 8.4 harness), 46/46 DB on a disposable MariaDB 10.5.29 (non-root, schema-scoped user, left empty), `tsc` clean, `next build` OK. `next start` HTTP checks: enforcing CSP, a different nonce per request, 0 un-nonced scripts/styles, all 11 destinations 200 with one `<h1>` each, `/destinations/dubai` 404, `/admin` → `/admin/unavailable`, admin/auth APIs 503 without config, no secret values in `.next/static`. Headless Chromium (preview): 0 overflow at 390px on the sampled pages, skip link is the first Tab stop, reduced motion swaps the WebGL globe for the static fallback, and textures/fonts load under CSP
  - [ ] Router-error investigation (R-025): not reproduced; cause unverified. Needs a real-browser `next start` check
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
- **One development folder (25 Oct 2026):** work and preview only in `C:UsersusyvDownloadsLockInConsulting` on local branch `dev` (see `docs/LOCAL-PREVIEW.md`; `npm run dev:local`). `dev` = `main` + the approved commit of `feat/google-login-derek-autoreply`, plus the uncommitted public-repo hygiene changes. Not integrated: `feat/homepage-chat` (uncommitted, never approved; overlaps `components/support/student-chat.tsx` and `tests/support.test.ts`, so merge it by hand when approved). Already in `main`, safe to remove: worktree `.claude/worktrees/derek-auto-mode` and branches `feat/derek-auto-mode`, `feat/derek-gemini-flash-lite`, `chore/next-16.4.2`, `fix/public-directory-verification`.
- **Migration order:** apply `0004_derek_handoff.sql`, `0005_auto_reply_default.sql` and `0006_staff_presence.sql` in that order (`npm run db:migrate`; 0006 only adds the `staff_presence` table; rollback `DROP TABLE staff_presence` together with the code), run `npm run db:preflight` and confirm no pending migrations, and only then deploy the code. Both are in `REQUIRED_MIGRATIONS`, so `/admin` and `/support` fail closed as "unavailable" until applied. 0005 changes only the `support_settings.auto_reply_enabled` default and the one untouched row (no lock risk). To undo its effect, untick automatic replies in `/admin/settings` (logged), or run `ALTER TABLE support_settings ALTER COLUMN auto_reply_enabled SET DEFAULT FALSE; UPDATE support_settings SET auto_reply_enabled = FALSE WHERE id = 1 AND updated_by IS NULL;`.
- **Google OAuth (students):** create a Google Cloud OAuth client (Web application), consent screen in Testing mode with synthetic test users, authorised redirect URI `http://localhost:3000/api/auth/callback/google`; set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` server-side; test sign-in with an existing Google-created student and the closed sign-up message. Add the production redirect URI only when the domain is final. Real Google sign-in has not been tested yet (only an offline end-to-end test with a stubbed token endpoint).
- **Gemini go-live (D-041):** run `npm run test:gemini-live` with the real key (synthetic data); confirm billing is active on the key's Google Cloud project and set a budget alert; then set the production variables in docs/ENVIRONMENT.md → "Production settings for real students". Real Gemini has not been called from this codebase yet.
- **Launch blockers:** `STUDENT_SELF_SIGNUP_ENABLED` stays off until a legally reviewed privacy notice exists (R-026; the onboarding text is a placeholder). Gemini stays blocked for real students until its terms are reviewed for this consumer-facing, student service and `DEREK_PROVIDER_APPROVED=gemini` is recorded (R-027); an adult-only audience does not settle the "not for consumer use" restriction. No real AI provider is cleared for automatic replies.
- **Supabase:** not used (D-039). If it is ever chosen as the application database, that is a separate MySQL → PostgreSQL migration project (triggers with `SIGNAL`, `FOR UPDATE` locking, `INSERT IGNORE`/`ON DUPLICATE KEY`, `UTC_TIMESTAMP`, AUTO_INCREMENT ids, Better Auth adapter) with its own plan, tests, backups and rollback.
- (Superseded by the migration-order item above.) Apply `db/migrations/0004_derek_handoff.sql` (`npm run db:migrate`) wherever this branch is deployed: `/admin` and `/support` report the database as unavailable until it is applied. Additive only; MariaDB 10.5 compatibility not yet run (R-013).
- Before enabling Derek Auto Mode: an approved provider (none is: Gemini drafts only, the mock is refused in production), the 18+ decision (R-026), a currency spending cap from that provider's verified pricing (the token budget is not one), and a review of held/sent replies to extend the keyword lists (R-034).
- Review and commit the R-029 fix (public directory reads only `public_*` views again) and R-030 restorations; decide on one package manager and the Windows build script (R-030)
- Before `STUDENT_ACCOUNTS_ENABLED=true`: R-026 legal/privacy review, age and guardian-consent flow, privacy notice, retention period
- Derek can only cite university-specific facts that are entered, reviewed and published in `/admin`. None are yet, so every fee, deadline or requirement question is answered as "not verified yet". The schema has no scholarship, living-cost or visa records, so those topics can never be sourced from the directory (D-036)
- Before Gemini serves real students: an 18+ verification flow that sets `age_confirmed_at` (R-026), a paid Gemini project with a budget alert and `GEMINI_PAID_TIER=true`, a written review of the consumer-use clause (R-027), and a stale-job sweeper (R-032)
- Confirm the Hostinger plan and its exact MySQL/MariaDB version; run `DB_TEST_URL=... pnpm test:db` against that engine (R-005, R-013, R-014)
- Owner decision on FX provider strategy (R-016). IMF needs written permission from copyright@imf.org first (commercial reuse + automated download, R-024; evidence in `db/intake/2026-10-17-imf-terms-review.md`)
- Manual browser check of the 3 listed links that block automated checks, plus the unresolved ones (`db/intake/2026-10-17-link-check.md`, R-015)
- Check the reduced-motion fallback with the OS setting enabled in a real browser
- Measure globe FPS and LCP on a mid-range Android phone
- Verify the enforcing CSP on staging in Chrome, Safari and Firefox; check `/admin` sign-in and server actions under it (R-023)
- Set `NEXT_PUBLIC_SITE_URL` once a domain exists, then rebuild
- In a real Chrome, Safari and Firefox, run `pnpm build && pnpm start`, open `/destinations/finland#data-status`, and repeat the R-025 interactions (anchor, back/forward, reload, fresh tab). Record whether the router error appears outside v0
- Indian privacy/legal review before enabling student accounts, uploads or the inbox
- **Production launch blocker (R-033):** sign-in floods. Code limits password hashing to a shared budget, but until Hostinger's client-IP header is verified (After purchase, step 4) an attacker can still crowd out sign-ins from new browsers. Do not launch until that step passes.

## After purchase (do not buy or deploy without approval)
1. Record the plan, Node versions offered, database engine and **exact** version, and whether the DB user can `CREATE TRIGGER`/`CREATE VIEW` with binary logging on.
2. `pnpm db:preflight --probe` against an empty staging DB; then `DB_TEST_URL=… pnpm test:db` (all three suites, including `support.db.test.ts`). MySQL 8.4 results do not prove the hosting engine works.
3. `pnpm db:migrate` (applies `0003_support_chat.sql`); confirm `/admin` is not `unavailable`.
4. **Client IP and request limits (R-033, launch blocker).** (a) Ask Hostinger in writing which header its proxy *overwrites* (not appends) with the client IP, whether the Node app can be reached without the proxy, how many Node processes run the app, and what request-rate limits or WAF rules the plan offers. (b) On staging, temporarily log only the candidate header's value from a test route or the server log, then from two networks send requests with forged `X-Forwarded-For`, `X-Real-IP` and `Forwarded` headers; pass only if the header shows each real public IP and never a forged value, including over IPv6. (c) Set `AUTH_CLIENT_IP_HEADER` to that header, redeploy, and confirm from one network that a 6th rapid sign-in attempt gets 429 while a second network still gets 401, and that requests sent straight to the app (bypassing the proxy), if possible at all, are refused. (d) Enable any Hostinger rate limit available for `/api/auth/*`. Record the evidence in R-033; until (b) and (c) pass, R-033 stays a launch blocker. Staging environment variables: as in `docs/ENVIRONMENT.md`. Leave `STUDENT_ACCOUNTS_ENABLED`, `DEREK_AI_ENABLED`, `DEREK_PROVIDER`, `DEREK_AUTO_REPLY_CLEARED` **unset**.
5. Confirm Hostinger's start command. `npm run build` completes the standalone bundle; start with `npm run start:standalone` (`node .next/standalone/server.js`) or `npm start`. Check that static chunks and `/textures/*` return 200 and that `HOSTNAME`/`PORT` are what the platform expects.
6. Keep staging and production closed to students until R-026, R-027 and R-031 are cleared in writing.

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
