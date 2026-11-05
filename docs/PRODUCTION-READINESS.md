# Production readiness report

Audit date: 30 October 2026, updated 2 November 2026 with the first staging deployment. The main domain is not connected.
Evidence comes from this machine (Windows, Node 24.19.0, MySQL 8.4.9) unless a source is linked.

## Recommendation

| Target | Decision |
| --- | --- |
| **Closed staging** (sign-up off, synthetic data only, not indexed) | **Deployed. Regression tests still to run** |
| **Public production / real students** | **NO-GO** until every Critical item is closed |

Current staging site: `https://<staging-host>`. The temporary hostname has no DNS change and no effect on `lockinconsulting.com`.

Remaining on staging: a synthetic staff account and the full regression. The deployment used a sanitized package, so the working tree is still uncommitted and needs review.

## Hostinger account facts (read 1 November 2026)

Read through the Hostinger API with read-only calls. Nothing was created or changed.

| Item | Value |
| --- | --- |
| Domain | `lockinconsulting.com`, active |
| Hosting plan | Unlimited Web Hosting (`hostinger_unlimited_v6`), active |
| Node.js tier | Business/Unlimited: 5 Node.js websites, 120 NPROC, 60 entry processes, 120-second request limit |
| Websites | Staging application running on the temporary hostname, SSL active |
| Databases | `<account>_lockin_app` for staging; `<account>_lockin_test` and `<account>_lockin_rst`, disposable test evidence. MariaDB 11.8.9 on `<db-server>` |
| Also on the account | Ecommerce Growth trial, auto-renewing 1 February 2027. This app does not use it. |

Google callbacks: `https://lockinconsulting.com/api/auth/callback/google` for production and `https://<staging-host>/api/auth/callback/google` for staging, which is registered. A staging site uses one of the 5 Node.js slots and shares the plan's process limit with production.

On Hostinger the deployed app must reach its database at `127.0.0.1:3306`, not `localhost` (which can resolve to IPv6) and not the external `srvNNNN.hstgr.io` host.

## Hostinger MariaDB 11.8.9 results (1 November 2026)

Run from this machine over verified TLS with a temporary single-IP rule, removed afterwards and confirmed gone. Disposable databases and synthetic data only.

| Gate | Result |
| --- | --- |
| Engine | MariaDB 11.8.9-MariaDB-log |
| TLS | TLS 1.3, Let's Encrypt `*.hstgr.io`, certificate and hostname verified |
| Preflight probe | Passed |
| Integration suite | 222 passed, 6 skipped (live Gemini), 0 failed, in 18 minutes |
| Migrations 0001–0012 | All applied in a strict session |
| Audit triggers | All 14 present, and each fired and refused a real update or delete |
| Audit chain | Intact |
| Backup and restore | `mysqldump` restored into a second database, 43 objects |
| Restored definitions | 14 triggers and 10 views identical to the source apart from the owner, which was rewritten in the temporary dump only |
| After restore | 14 triggers fired, audit chain intact, tamper attempts refused |

Measured server settings: `wait_timeout` 20 s, `max_user_connections` 75, 500 connections per hour, 120 s per statement, default `sql_mode` not strict, 46 ms round trip from this machine.

Not proven: Hostinger's own backup system, a restore under the original user, and the live connection count.

## First staging deployment (2 November 2026)

Deployed to the temporary hostname from the sanitized package, SHA-256 `0361c753aff6d84d5b53939c40be6dea7db2df348ae0a1e8479bfccedfedca3f`. The main domain and DNS were not touched.

| Check | Result |
| --- | --- |
| Build | Passed with Webpack on Node 24 and pnpm 11.20.0 |
| Boot migration | 12 applied once, before serving |
| Triggers and owner | 14 present, owned by `<account>_lockin_app@127.0.0.1` |
| `MIGRATE_ON_BOOT` | Removed straight after success; the restart ran no migration |
| `/api/health` | 200 over HTTPS |
| Live checks | 29 passed: HTTPS redirect, robots, sitemap, no-store, fresh nonce per request, headers, sign-up refused, nothing exposed |
| Upload privacy | `.htaccess` honoured (403), and the archive folder was gone after the build |

Confirmed by this deployment: Hostinger runs `instrumentation.ts`, the migration files load from disk, `127.0.0.1` login works, objects get a local owner, and the CDN does not cache pages.

Runtime findings: the logs hold no errors. Each restart produced two or three Next.js starts within seconds (three on 1 November, two on 2 November), with no crash line, which is consistent with the process manager adding workers, though Hostinger does not document this. Health stayed at 200 throughout. The API's `levels` log filter returns 500 every time, so logs must be filtered locally. One 503 on the cron list did not recur in 10 tries.

Still unverified: whether the marker file survives a restart on Hostinger, because no migration has failed there; how the process manager treats a server that never reports ready; and the real start command, which was never shown.

Not done: `lockin_app` holds no directory data yet, no staff account exists, and the full staging regression has not run. Student accounts, sign-up and Derek are off.

## Issues by priority

| ID | Priority | Issue | Evidence | Action |
| --- | --- | --- | --- | --- |
| P-1 | **Critical** | No reviewed student privacy notice, retention periods, grievance contact or Indian legal review (R-026). `STUDENT_PRIVACY_NOTICE_URL` is unset. | Drafts exist at `/privacy`, `/terms` and `/ai`, marked "pending legal review", with placeholders the Owner must fill (`docs/LEGAL-DRAFTS.md`). | Owner/legal review, then set the URL. New accounts stay closed in production until set (enforced in code). |
| P-2 | **Critical** | Real Google sign-in is not fully tested. | Passed live: redirect, refusal from Sign in, Create account → `/chat`. **Never reached the server:** sign-out, returning sign-in, cancellation. Not run: the full-name field with a real account, a staff-email conflict. | Re-run locally, then on staging with its own OAuth client. |
| P-3 | **Critical** | Gemini has never been tested live from this build. | `GEMINI_API_KEY` is not set; only the mock provider and stubbed tests ran. R-027 conditions remain. | Run `pnpm test:gemini-live` with the paid-tier key before Derek touches real students. |
| D-1 | **Closed** | Target database engine verified. | MariaDB 11.8.9: migrations and the full suite passed (see results above). | None. |
| D-2 | **Closed** | `CREATE TRIGGER` works for the account's database users. | All 14 triggers created and fired on Hostinger. | None. |
| D-3 | **High** | Restoring onto a different database user fails on `DEFINER` (ERROR 1227). | Reproduced locally. Passed on Hostinger with the owner rewritten in the temporary dump and every definition compared. | Restoring under the original user is untested. Run a restore drill before launch. |
| S-2 | **High** | Client-IP rate limiting is unconfigured (R-033, already a launch blocker). Per-account throttling works: 429 after 5 wrong passwords on the production server. | `AUTH_CLIENT_IP_HEADER` unset; the correct header on Hostinger's proxy is unknown. | Confirm which header the proxy overwrites, set it, test on staging. |
| H-5 | **Medium** | Hostinger appears to run more than one process. The per-account lockout is in the database and is shared, but request-rate buckets are in process memory (`lib/auth-throttle.ts`), so those limits apply per process. A second process during a future migration boot would stay closed until a restart. | Runtime logs. | Treat request limits as approximate. Restart after any migration boot. |
| S-3 | **High** | Google access and ID tokens are stored unencrypted in `auth_account`. The app never uses them. | Local row has both. No `encryptOAuthTokens` setting. | Enable Better Auth's token encryption before real students, and test it. |
| A-1 | **High** | No self-service password reset or any outbound email. Staff and provisioned students recover only through the CLI. | Paths return 404 by design. | Accept as the support process for launch, or add an email service. |
| H-1 | **Medium** | Three pools of 5 mean up to 15 connections per process, and `domain.tld` and `www.domain.tld` each run a process ([limits](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/)). Hostinger allows 75 connections per user and 500 per hour, and closes idle connections at 20 s. | Measured. Pools now retire idle connections at 15 s, so more connections are opened over time. | Serve one hostname and redirect the other. Watch the hourly limit on staging. |
| H-2 | **Medium** | Tested only on Node 24. Hostinger recommends an LTS version; docs list 18, 20, 22 and 24 and require 20+ for Next.js. `package.json` has no `engines`. | Local Node 24.19.0. | Pick 22 or 24 in hPanel and run the staging checks on that version. |
| H-3 | **Closed** | Migrations run from the app (D-048): one attempt per deployment, over `127.0.0.1`. | Worked on Hostinger on 2 November 2026; objects are owned by a local user. | None. |
| H-4 | **Closed** | Hostinger installs development dependencies and honours `pnpm@11.20.0` on Node 24. Its server lacks glibc 2.29, so Turbopack cannot run and production builds use Webpack (D-049). | First staging build log. | None. |
| S-4 | **Medium** | `/api/student/age-confirmation` has no rate limit of its own. Unauthenticated, it can add rows while sign-up is open. Closed today (503). | Route code. | Add a per-IP limit with S-2, before sign-up opens. |
| S-5 | **Medium** | No scheduled clean-up: expired sessions, verification rows, rate-limit rows and abandoned age confirmations (with a typed name) stay until next touched. | One expired session and three verification rows locally. | Add a Hostinger cron job; [supported](https://www.hostinger.com/support/how-to-run-cron-jobs-for-node-js-websites-at-hostinger/). Retention period needs P-1. |
| S-6 | **Closed** | Staging stays out of search engines: with `NEXT_PUBLIC_SITE_URL` unset, `robots.txt` disallows everything. | Local production server. Stage 2 re-checks it live. | Keep the variable unset on staging. |
| O-1 | **Medium** | Health endpoint added at `/api/health`, but no error tracking or alerting. | 200 only when every migration is recorded. | Use hPanel runtime logs plus an external uptime check on `/api/health`. |
| O-2 | **Medium** | No backup is scheduled or proven on the host. | Hostinger backup frequency not verified. | Nightly `mysqldump` off the host, plus one real restore drill. |
| U-1 | **Medium** | `/admin/universities` and `/admin/review` load every record (864 KB and 1.1 MB of HTML, no paging). | Measured at 431 records. | Add paging before the review work starts. |
| U-2 | **Low** | Admin dashboard cards overflow slightly at 375px and the layout measures wider than the phone, though the page does not scroll sideways. Staff-only. | Browser. | Tidy when next in the admin shell. |
| R-2 | **Low** | Generated files are tracked: `tsconfig.tsbuildinfo` (rewritten by every typecheck) and `next-env.d.ts` (flips between dev and build). | Git. | Untrack the first; restore the second before committing. |
| D-4 | **Low** | 157 candidates still await a person to confirm their website, and none of the 431 is verified. | Database. | Normal review work, no release impact. |

## 1. Completed

- **Public site on the real production server:** home, destinations, all 11 country pages, `/auth`, `/age-confirm`, robots, sitemap and the 404 page all respond correctly, with no console errors under the nonce-based CSP.
- **Layouts:** phone (375px) and desktop (1280px), with no sideways scroll on public pages and 44px controls on the sign-up page.
- **Security headers:** CSP without `unsafe-eval` or inline scripts, HSTS, nosniff, frame, referrer and permissions policies; `X-Powered-By` removed.
- **Access boundaries:** every student and admin API refuses signed-out requests (401) and cross-site writes (403). Students are refused by the admin API; editors by the student API and the owner-only audit API. All 11 admin pages opened for the owner.
- **Authentication:** email sign-up and reset are off (404); sign-up stays closed (503 from the age endpoint); Google sign-in is identity-only with no refresh token; a new account needs a single-use 18+ confirmation; an unverified Google email leaves no account.
- **Database:** fresh build from empty passes the whole test suite. An upgrade from 0008 with data kept every row and the audit chain, and re-running did nothing. All 12 migrations are applied locally.
- **Backup and restore:** after the fix below, `mysqldump` restored into a new database with every table's row count, all views and all 14 triggers matching. The audit chain verified and the triggers still refused tampering.
- **Secret scan:** 266 current files, 550 Git blobs, 25 commits, all branches. No real credentials. The single hit is a labelled fake key in `tests/gemini.test.ts`. `.env*` files are ignored and `.env.example` only ever held `ADMIN_DISABLED`.
- **Directory:** 431 records, 431 distinct, reconciled below. 0 verified, 0 published; 0 public courses, fees, rankings or acceptance rates; QS `not_confirmed` with ordering and AI use off.

**Found and fixed in this audit:** a plain `mysqldump` of this database **could not be restored**. 12 of 14 append-only triggers stored a trailing semicolon, producing a syntax error, and forcing past it would have silently dropped the tamper protection. Migration `0012_dump_safe_triggers.sql` recreates all 14 with identical behaviour, and a permanent test now guards it. Also added `STUDENT_PRIVACY_NOTICE_URL` to `docs/env.example`.

**Standardised on pnpm:** `package-lock.json` removed, `pnpm install --frozen-lockfile` succeeded with `pnpm-lock.yaml` unchanged, `packageManager` set in `package.json`, and docs and script messages updated. React moved from 19.3.1 to 19.2.4. Every check was repeated on this install, and the production server was re-tested against the local database: 11 destinations, 431 total, static files, CSP, sign-in and access boundaries.

**Dependency audit cleared:** `shadcn` moved to `devDependencies` and updated from 4.19.0 to 4.23.0, and flagged packages refreshed in the lockfile (`postcss`'s development range moved to `^8.5.32`). No application dependency changed. `pnpm audit --prod` went from 79 advisories (1 Critical) to **0**; the full audit including development tools shows 1 low (`deepmerge`, used by the `shadcn` CLI, never in the production bundle). `shadcn` is still needed at build time for `shadcn/tailwind.css`, so the host must install development dependencies (H-4).

Note: the brief said 0001–0010, but the repository now has 0001–0012 (0011 for the full name, 0012 above).

### Directory totals

| | US | GB | CA | DE | IT | PL | AU | SA | AE | FI | NZ | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public entries | 50 | 50 | 50 | 50 | 50 | 50 | 41 | 41 | 26 | 13 | 10 | **431** |
| Website checked | 36 | 40 | 44 | 44 | 24 | 19 | 23 | 14 | 14 | 11 | 5 | **274** |
| Check pending | 14 | 10 | 6 | 6 | 26 | 31 | 18 | 27 | 12 | 2 | 5 | **157** |
| Universities | 50 | 50 | 50 | 50 | 50 | 50 | 41 | 41 | 25 | 13 | 8 | **428** |
| Other type | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 2 | **3** |

The two middle rows and the two lower rows are separate splits of the same 431 entries; never add them together.

### Test results

| Check | Result |
| --- | --- |
| Typecheck | Passed |
| Unit tests | 312 passed, 14 skipped |
| MySQL tests (MySQL 8.4.9) | 222 passed, 6 skipped |
| Production build (pnpm, Webpack) | Passed; standalone bundle 62 MB |
| `pnpm audit --prod` | **0 advisories** |

## 2. Incomplete features

Live OAuth checks (P-2); live Gemini (P-3); privacy notice and legal pages (P-1); password reset and email (A-1); Microsoft, Yahoo and Apple sign-in (not implemented; not needed for launch); university verification (no record verified, so no public courses or fees yet); admin paging (U-1).

## 3. Critical security and privacy blockers

P-1 blocks real students. S-2 and S-3 are High but should be closed in the same pass, because both protect real accounts. There is no leaked credential to rotate.

## 4. Database compatibility risks

- **Tested:** MariaDB 11.8.9 on Hostinger and MySQL 8.4.9 locally, on all 12 migrations.
- **Required:** MySQL 8.0.19+ or MariaDB 10.5+, InnoDB, utf8mb4, `CHECK` enforcement, triggers, views. The event scheduler is [not available on shared plans](https://www.hostinger.com/support/mysql-databases/), and this app does not use it.
- **Unknowns:** whether a restore works under the original user, and the live connection count. MariaDB's server default `sql_mode` is not strict, so every connection sets strict mode itself (D-047).

## 5. Hostinger compatibility

Checked against Hostinger's docs on 30 October 2026; confirm against your actual plan in hPanel.

| Requirement | This app | Fit |
| --- | --- | --- |
| Node version | Next.js 16 needs 20+. Hostinger lists 18, 20, 22, 24 | Fits (H-2) |
| Next.js mode | `output: 'standalone'`, plain object config, as Hostinger requires | Fits |
| Build | 82 s locally from a clean cache, against a 15-minute limit for each of install and build | Fits |
| Request timeout | 120 s. Longest request is the chat API; Derek runs after the response | Fits |
| WebSockets | Not supported inbound. The app polls (2–30 s) | Fits |
| Background workers | Not supported. Derek uses `after()` within the process, so **a restart can abandon a draft in progress** | Acceptable; staff still see the message |
| Cron | None required; recommended for S-5 | Fits |
| Uploads | The app has no file uploads; JSON messages only | Fits |
| Disk | One small marker file during a migration boot; all other state is in the database | Fits, unverified (see above) |
| Process limit | About 10–11 threads per Next.js app; Business allows 120 NPROC and 60 entry processes | Fits at low traffic; polling counts toward entry processes |
| Custom ports, Docker, Redis | Not used | Fits |

Sources: [Node.js limits](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/), [Next.js on Hostinger](https://docs.hostinger.com/node.js/overview-1/next), [build settings](https://docs.hostinger.com/node.js/build-settings), [Node.js overview](https://docs.hostinger.com/node.js/overview), [databases](https://www.hostinger.com/support/mysql-databases/).

## 6. Required environment variables

Set in hPanel only, separately per environment. Never commit values. Full reference: `docs/ENVIRONMENT.md`.

| Variable | Staging | Production |
| --- | --- | --- |
| `DATABASE_URL` | Required | Required (read-focused user) |
| `ADMIN_DATABASE_URL` | Leave unset: falls back to `DATABASE_URL` | Required (write user) |
| `BETTER_AUTH_SECRET` | Required, 32+ characters, unique | Required, different from staging |
| `BETTER_AUTH_URL` | `https://<staging-host>` | `https://lockinconsulting.com` |
| `NEXT_PUBLIC_SITE_URL` | **Unset**, which keeps staging out of search engines | Real origin (set before the build) |
| `AUTH_CLIENT_IP_HEADER` | Unset until confirmed | Required |
| `STUDENT_ACCOUNTS_ENABLED` | `false` | Leave unset until launch |
| `STUDENT_SELF_SIGNUP_ENABLED` | `false` | **Unset** until P-1 closes |
| `STUDENT_PRIVACY_NOTICE_URL` | Unset | Published, reviewed notice |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Existing client with the staging callback | Production client |
| `DEREK_AI_ENABLED` and the other Derek variables | `DEREK_AI_ENABLED=false`, the rest unset | Only after P-3 and R-027 |
| `MIGRATE_ON_BOOT` | `1` for the first start only, then removed | Same, deliberately |

OAuth callbacks: `https://<staging-host>/api/auth/callback/google` and `https://lockinconsulting.com/api/auth/callback/google`. Each must match its `BETTER_AUTH_URL` exactly.

**Commands.** hPanel: application type `next`, build script `build`, entry file ignored. Local equivalent: `pnpm build`, then `pnpm start:standalone`. The start command Hostinger really uses is unverified until the first deployment.

**Backup and monitoring.** Back up with `mysqldump --single-transaction --routines --triggers --no-tablespaces --hex-blob`. Keep copies off the host, encrypted, because they hold personal data. Run one restore drill before launch and run `admin:user verify-audit` afterwards. Monitor with hPanel runtime logs and an external uptime check.

## 7. Recommended deployment architecture

One Hostinger Node.js site (Business or Cloud; verify limits for your plan) running the standalone Next.js server, with a Hostinger MySQL/MariaDB database on the same account over localhost. One canonical hostname, with the other redirected, so only one process runs. Staging is a separate site with its own database, secrets and OAuth client. No Redis, workers or separate services. Migrations run from the application on a deliberate boot (D-048), so triggers and views are owned by a local user. Operator commands (`admin:user`, research import) run from a trusted machine over temporary Remote MySQL access. Consider a VPS later only if connection or process limits bite.

## 8. Steps before the first staging deployment

The sequence is in `docs/STAGE-2-PLAN.md`. Still open for the owner: P-2's three local checks, and review and commit of the working tree.

## Release checklist

- [x] One lockfile (`pnpm-lock.yaml`); `package-lock.json` removed
- [ ] pnpm selected in hPanel and confirmed in the first build log
- [ ] Working tree reviewed; `next-env.d.ts` and `tsconfig.tsbuildinfo` not part of the commit
- [ ] Migrations 0001–0012 present and applied in order, after a verified backup
- [ ] `db:preflight --probe` clean on the target engine; DB suite passes there
- [ ] Separate secrets and OAuth clients per environment
- [ ] `STUDENT_SELF_SIGNUP_ENABLED` unset in production
- [ ] Privacy notice published and reviewed; `STUDENT_PRIVACY_NOTICE_URL` set
- [ ] OAuth token encryption enabled and tested
- [ ] Client-IP rate limiting proven on the host
- [ ] Live Google and Gemini tests recorded
- [ ] Off-host nightly backup running; restore drill done
- [ ] Uptime check and log review in place
