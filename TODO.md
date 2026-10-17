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
- [ ] **Phase 13**: legal drafts, privacy controls, CSP enforcement, rate limits
- [ ] **Phase 14**: E2E, a11y and performance audit
- [~] **Phase 15**: Hostinger staging & production deployment and launch checklist
  - [x] Stage 4 local readiness: 90 unit tests and 46 DB tests (MySQL 8.4.9 **and** MariaDB 10.5.29), typecheck, build, production-server smoke test without configuration
  - [x] Migration safety: capability probe, migration lock, never recording partial failures, `/admin` schema gate, `pnpm db:preflight`
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
- Owner decision on FX provider strategy (e.g., approve `ecb` for 7 currencies + `imf` for `SAR`/`AED`, or `imf` for all 9) in `/admin/settings` (R-016)
- Manual browser check of the 7 WAF/timeout links in `UNRESOLVED_OFFICIAL_LINKS` if additional portals are desired beyond the 30 verified links (R-015)
- Check the reduced-motion fallback with the OS setting enabled in a real browser
- Measure globe FPS and LCP on a mid-range Android phone
- Switch CSP from report-only to enforcing after staging verification
