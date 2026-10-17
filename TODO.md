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
  - [ ] Connect Hostinger MySQL / MariaDB (blocked by R-005, R-013)
  - [ ] Owner approval of FX provider(s) in `/admin/settings` (R-016)
  - [ ] Real university data, entered and verified by a human reviewer
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
- [ ] **Phase 15**: Hostinger staging & production deployment and launch checklist

## Open items
- Confirm the Hostinger plan and its exact MySQL/MariaDB version; run `DB_TEST_URL=... pnpm test:db` against that engine (R-005, R-013, R-014)
- Owner decision on FX provider strategy (e.g., approve `ecb` for 7 currencies + `imf` for `SAR`/`AED`, or `imf` for all 9) in `/admin/settings` (R-016)
- Manual browser check of the 7 WAF/timeout links in `UNRESOLVED_OFFICIAL_LINKS` if additional portals are desired beyond the 30 verified links (R-015)
- Check the reduced-motion fallback with the OS setting enabled in a real browser
- Measure globe FPS and LCP on a mid-range Android phone
- Switch CSP from report-only to enforcing after staging verification
