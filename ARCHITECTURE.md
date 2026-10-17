# LockIn Consulting — Architecture

Status: **Stage 4 (staging readiness).** Local checks are complete, and the integration suite also passes on MariaDB 10.5.29. Staging is blocked on the Hostinger plan and staging credentials. Stage 3 summary: The public homepage, 11 destination pages, university-directory schema (`0001_university_directory.sql` + `0002_admin_auth.sql`), Better Auth administrator sign-in, Owner/Reviewer/Editor role-based access control, `/admin` dashboard, publication/licensing workflow, and SHA-256 hash-chained + trigger-protected audit log are implemented and verified against real MySQL 8.4 (`pnpm test:db`). There is still **no live production database connection, no student chat, and no AI provider** (Derek remains disabled per D-002).

## Stack

| Concern | Choice | Status |
|---|---|---|
| Framework | Next.js 16.4.0 App Router, Node server mode | Implemented |
| Hosting | Hostinger Business or Cloud (Node.js Web App) | **Plan unconfirmed (D-001, R-005)** |
| Database | Hostinger MySQL / MariaDB, accessed with `mysql2` and plain SQL migrations (no ORM, D-011) | Migrations `0001` & `0002` implemented and tested on MySQL 8.4.9; **not connected to production** |
| Validation | `zod` schemas (`lib/data/validation.ts`) + column whitelist (`lib/admin/forms.ts`) | Implemented across all admin write paths |
| Auth | Better Auth 1.7.8 (`lib/auth.ts`, `lib/auth-options.mjs`) — email/password, public sign-up disabled, DB-backed rate limiting, CLI-only provisioning (`scripts/admin-user.mjs`) | Implemented and integration-tested; fails closed without config |
| Authorisation | Server-side RBAC (`lib/admin/access.ts`, `lib/admin/roles.ts`) — `editor` < `reviewer` < `owner` | Enforced on every page, route handler and server action |
| AI (Derek) | Provider-agnostic interface | **Disabled. No provider connected (D-002, R-001, R-002).** |
| Support | Human-reviewed replies via the future admin inbox | Planned (Phase 7). No simulated chat. |
| 3D | three.js + `@react-three/fiber` 9.8.1 | Implemented; shared between homepage and destination pages |

## Code layout

```
app/
  page.tsx                                    homepage
  destinations/page.tsx                       index of 11 destinations, grouped by region
  destinations/[slug]/page.tsx                SSG for 11 slugs, dynamicParams = false, revalidate 3600
  admin/
    layout.tsx                                noindex/nofollow root wrapper
    actions.ts                                server actions (re-authorise before reading input)
    sign-in/page.tsx                          staff sign-in gate
    forbidden/page.tsx                        authenticated non-member / insufficient-role gate
    unavailable/page.tsx                      fail-closed configuration/DB gate
    (dashboard)/
      layout.tsx                              authenticated admin shell
      page.tsx                                overview: status counts, review summary, chain integrity
      review/page.tsx                         overdue, awaiting-review, and due-soon queue
      universities/page.tsx                   searchable/filterable university list
      records/[entity]/new/page.tsx           draft capture form
      records/[entity]/[id]/page.tsx          record detail, workflow panel, citations, history
      records/[entity]/[id]/edit/page.tsx     edit form (blocked while published)
      sources/page.tsx                        official sources list & search
      sources/new/page.tsx                    record official source
      sources/[id]/page.tsx                   source detail & citing records
      changes/page.tsx                        paginated hash-chained audit log + integrity status
      settings/page.tsx                       ranking reuse rights, FX provider terms, FX rates, members
  api/
    auth/[...all]/route.ts                    Better Auth handler (503 fail-closed when unconfigured)
    admin/review-queue/route.ts               JSON review queue (requires data.read, Cache-Control: no-store)
    admin/audit/route.ts                      JSON chain verification (requires members.read, no-store)
components/
  site/                                       header, footer, skip link
  home/                                       homepage sections
  globe/                                      globe stage, R3F canvas, static fallback
  destination/                                hero, globe wrapper, directory, university card, fee cell,
                                              official resources, rankings notice, status legend, pager
  admin/                                      shell, nav, entity/source/settings forms, workflow panel,
                                              status badges, history list
lib/
  destinations.ts                             single source of truth: ISO codes, slug, currency, marker, Dubai under UAE
  auth.ts / auth-client.ts / auth-options.mjs Better Auth server/client + shared models, password policy, rate limits
  content/official-resources.ts               verified official links per destination + unresolved WAF/timeout log
  content/team.ts                             team seed (no unapproved bio — D-010)
  data/types.ts                               enums mirrored from SQL + public read model
  data/publication.ts                         display state + publish/ranking gates (mirrors SQL rules)
  data/validation.ts                          zod input schemas for all entities, verifications, rights, FX
  data/money.ts                               decimal display, INR conversion + provider attribution
  data/directory.ts                           loader: not_configured | ready | error
  db/pool.ts                                  UTC mysql2 pools (getPool, getAdminPool, getAuthPool)
  db/directory-queries.ts                     reads ONLY public_* views, parameterised
  admin/
    config.ts                                 fail-closed env validation + kill switch (ADMIN_DISABLED)
    roles.ts                                  editor / reviewer / owner permission matrix
    access.ts                                 requireAdminPage, requireAdminAction, requireAdminApi
    entities.ts                               entity metadata and whitelisted column definitions
    forms.ts                                  FormData -> whitelisted column map + zod validation
    workflow.ts                               transactional mutations + FOR UPDATE locks + audit logging
    queries.ts                                admin read queries (parameterised, escaped LIKE)
    audit.ts / audit-core.mjs                 canonical JSON + SHA-256 hash chain append & verification
db/migrations/
  0001_university_directory.sql               core directory tables, CHECK constraints, public_* views
  0002_admin_auth.sql                         Better Auth tables, admin_members, fx_providers, public_fx_rates,
                                              hash-chained data_change_log, audit_chain_head, immutability triggers
scripts/
  migrate.mjs                                 ordered, SHA-256 checksummed, probed and locked migration runner
  db-capabilities.mjs                         engine classification, DDL capability probe, grant redaction
  db-preflight.mjs                            read-only staging compatibility report (`pnpm db:preflight`)
  admin-user.mjs                              CLI-only admin provisioning (create, grant, revoke, set-password, list, verify-audit)
tests/                                        Vitest unit tests (pnpm test)
tests/db/                                     real-MySQL 8.4 integration tests (pnpm test:db)
```

## University directory & governance data model

All money is `DECIMAL` in the original currency. All facts are linked to a `sources` row.

| Table | Purpose | Key rules |
|---|---|---|
| `destinations` | The 11 ISO codes and slugs (FK target) | Seeded; a test asserts it matches `lib/destinations.ts` |
| `sources` | Every cited URL, publisher, retrieval date, and author | `https://` only; unique by SHA-256 of the URL; append-only (`tr_sources_no_update`, `tr_sources_no_delete`) |
| `universities` | Name, official website, city, sub-region (e.g. Dubai), type | Unique slug per destination; published needs an `https://` website |
| `campuses` | Additional campuses | Must belong to the same university when linked from a course |
| `courses` | Qualification, UG/PG, duration, mode, language, entry and language requirements | Qualification must match the level; duration 1–120 months |
| `course_intakes` | Month, year, application deadline | Past deadlines drop out of `public_course_intakes` |
| `tuition_fees` | Amount, ISO currency, billing period, academic year, validity, category | Amount > 0; unverified drafts may omit amount; `unavailable` must have `amount IS NULL`; `verified` must have `amount IS NOT NULL` and an academic year or `valid_to` |
| `fx_providers` | Exchange-rate providers (`ecb`, `frankfurter`, `fbil`, `imf`) and terms status (`not_reviewed`, `approved`, `rejected`) | Seeded as `not_reviewed`; `approved` requires `currencies_covered`, `attribution_text`, `update_frequency`, `terms_checked_at`, and `terms_reviewed_by` |
| `fx_rates` | Rate to INR, rate date, `source_id`, `provider_id`, `entered_by` | Append-only (`tr_fx_rates_no_update`, `tr_fx_rates_no_delete`); exposed only through `public_fx_rates` when provider is `approved` and rate is ≤ 7 days old |
| `acceptance_rates` | Rate, written definition (≥ 10 chars), scope, cohort | 0–100; unverified drafts may omit rate; `unavailable` requires `NULL`; `verified` requires non-null; `programme` scope requires `course_id` |
| `ranking_providers` | Provider and **rights status** (`not_confirmed`, `requested`, `licensed`, `denied`, `not_required`) | `licensed` needs reference, scope and date. QS seeded as `not_confirmed`. |
| `university_rankings` | Provider, year, subject, position **or** band | Exactly one of position or band |
| `auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_rate_limit` | Better Auth 1.7.8 tables | Public sign-up disabled; DB rate limit (5 attempts / 5 min on `/sign-in/email`) |
| `admin_members` | Role (`editor`, `reviewer`, `owner`) and status (`active`, `revoked`) | Required on every request in addition to a valid `auth_session` |
| `data_change_log` & `audit_chain_head` | Append-only audit trail with `prev_hash` and `row_hash` (SHA-256) | Serialised via `SELECT ... FOR UPDATE` on `audit_chain_head`; protected by `tr_change_log_no_update` and `tr_change_log_no_delete` |

**Enforced by the public views** (`public_universities`, `public_courses`, `public_course_intakes`, `public_tuition_fees`, `public_acceptance_rates`, `public_university_rankings`, `public_fx_rates`, `public_sources`). The public site reads only these:
- A row is hidden once its `review_due_at` passes (expired), or a fee's `valid_to` passes.
- A row is hidden when its parent university or course isn't public.
- A ranking appears only if the provider is `licensed` (and unexpired) or `not_required`. While QS is `not_confirmed`, no QS ranking can appear, even if a row is verified and published.
- An exchange rate appears in `public_fx_rates` only if its `fx_providers.terms_status = 'approved'`. When displayed, the provider's `attribution_text` and source link are rendered alongside the INR estimate.

## Authentication, authorisation and administration workflow

1. **Provisioning (`scripts/admin-user.mjs`).** Accounts and role assignments are created only from the CLI (`pnpm admin:user create|grant|revoke|set-password|list|verify-audit`). Passwords are read from the TTY with echo disabled or `--password-stdin`, never CLI flags, and must be 12–128 characters. Revoking access or resetting a password immediately deletes all active sessions for that user and writes a hash-chained `admin_member` audit entry.
2. **Fail-closed configuration (`lib/admin/config.ts`).** If `ADMIN_DISABLED=true`, `BETTER_AUTH_SECRET` (< 32 chars), `DATABASE_URL` / `ADMIN_DATABASE_URL`, or `BETTER_AUTH_URL` (HTTPS required in production except localhost) is missing or invalid, `getAuth()` returns `null`, `/api/auth/*` and `/api/admin/*` return `503`, and `/admin/*` redirects to `/admin/unavailable`.
3. **Role boundaries (`lib/admin/roles.ts`, `lib/admin/access.ts`).**
   - `editor`: `data.read`, `data.capture` — can record official sources, create/edit draft or unpublished records, and submit records for review. Cannot verify, publish, unpublish, return to draft, enter FX rates, or change rights/terms.
   - `reviewer`: adds `data.review` — can verify records against sources, mark fees/acceptance rates as `unavailable`, return records to draft with a reason, publish, re-verify, unpublish with a reason, and enter FX rates for approved providers. Cannot approve ranking licences or FX provider terms, or view the member list / `/api/admin/audit`.
   - `owner`: adds `rights.manage` and `members.read` — can update ranking provider reuse rights, approve/reject FX provider terms, view admin members, and call `/api/admin/audit`.
4. **Transactional mutations & audit chain (`lib/admin/workflow.ts`, `lib/admin/audit-core.mjs`).** Every write locks the target row (`FOR UPDATE`), validates input via `zod`, applies the change, locks `audit_chain_head` (`FOR UPDATE`), computes `SHA-256(prevHash + "|" + canonicalJson(entry))`, inserts into `data_change_log`, and updates `audit_chain_head` in a single database transaction. Published records cannot be edited in place; any edit to an unverified/in-review/unpublished record resets `verification_status` to `'unverified'`.

## Destination pages & globe behaviour

- `/destinations/[slug]` is statically generated for the 11 slugs (`dynamicParams = false`, `revalidate = 3600`). Unknown slugs (including `dubai`) return 404.
- Without `DATABASE_URL`, the directory shows "pending verification". On a DB failure it shows "temporarily unavailable". It never shows sample data.
- Globe: server-rendered static poster, WebGL check and lazy R3F chunk, reduced-motion static mode, context-loss recovery, off-screen pause, IST lighting (`?ist=HH:MM`).

## Deployment shape (pending plan confirmation)

GitHub → Hostinger Node.js web app (Business or Cloud; Node 22.x/24.x; Hostinger applies `output: "standalone"` itself) → server process restarted from hPanel. Secrets live only in Hostinger environment variables. Changing them requires a restart, or a redeploy for build-time values.

Database operations run from a trusted machine over Remote MySQL (R-018), never from a web route:
1. `pnpm db:preflight --probe` prints version, `sql_mode`, time zone, binlog/trigger settings and redacted grants. It creates and drops a throwaway `_lockin_probe_*` table, view and trigger.
2. `pnpm db:migrate` (`scripts/migrate.mjs`) takes `GET_LOCK('lockin_schema_migrate')`, re-runs the probe and applies nothing if a feature is refused. A migration that fails partway is **not** recorded and the error says to restore the backup.
3. `lib/admin/access.ts` checks that every name in `lib/db/schema-version.ts` is recorded in `schema_migrations`. Otherwise every admin page, API route and server action fails closed (`/admin/unavailable`, `503`). The public site reads only `public_*` views, so a half-applied schema can never expose unpublished data.

Tested engines: MySQL 8.4.9 and MariaDB 10.5.29 (`scripts/db-capabilities.mjs → TESTED_ENGINES`).
