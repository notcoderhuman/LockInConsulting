# Release readiness — first consolidated release (candidate 3)

Prepared 3 November 2026 on branch `dev`. **Nothing is committed, pushed or deployed.** Staging still runs the Stage 2 release, plus the 431-university import (data only). This file names no hosting account, server, staging address, IP address, backup file or local path, so it is safe in the public repository.

## Verdict

The release candidate is ready for review. Every check passes. Three owner decisions remain:

1. **Git:** approve the history cleanup and commit plan below (drops one unpublished commit, untracks the build cache).
2. **Public history:** decide what to do about research files that are **already public** on GitHub (see "Already public").
3. **Client IP:** keep `AUTH_CLIENT_IP_HEADER` **unset**. The origin answers direct HTTPS, so `X-Real-IP` cannot be trusted yet.

## Changes in candidate 3

- **Redactions:** placeholders replace the hosting account ID, database names, database server, staging address and Windows paths in `docs/STAGE-2-PLAN.md`, `docs/PRODUCTION-READINESS.md`, `docs/FEATURE-UPGRADE-PLAN.md`, `docs/ENVIRONMENT.md` and `docs/LOCAL-PREVIEW.md` (`<hosting-account>`, `<account>_lockin_app`, `<db-server>`, `<staging-host>`, `<research-folder>`, `<project-folder>`). A rescan of every committable file finds none left.
- **Client-IP guidance corrected** in `docs/ENVIRONMENT.md`: leave the header unset (see below).
- Unchanged since candidate 2: Google sign-in closed while student accounts are closed; Hindi hidden by default; `brag-output/` and `*.tsbuildinfo` ignored; university data untouched (157 pending stay unpublished; 45 bot-page source titles kept for manual review).

## Client IP: trust boundary not yet established

Read-only tests on 3 Nov 2026:

| Path | Result |
|---|---|
| Staging address | A CNAME to Hostinger CDN; responses carry `server: hcdn` and `x-hcdn-*` headers |
| Origin server, HTTP | LiteSpeed only redirects (301) to the HTTPS address. The app is not reached. |
| Origin server, HTTPS with the staging name in SNI | Refused (TLS internal-error alert) |
| Origin server, HTTPS **without SNI**, staging name in `Host` | **Reaches the app** (health 200, no CDN headers) carrying a sender-chosen `X-Real-IP` |

Hostinger's documentation confirms that `X-Real-IP` is set by the CDN and that requests sent straight to the server "can carry any header value". If `AUTH_CLIENT_IP_HEADER=x-real-ip` were set today, anyone could choose their own client IP, either avoiding per-client limits or using up another person's sign-in budget.

**Keep it unset.** Today no IP is trusted, the site-wide limits apply, and per-account sign-in throttling works.

**To establish the boundary**, choose one:
- **(a)** Ask Hostinger whether the origin can accept only CDN connections for this site, or whether LiteSpeed overwrites `X-Real-IP` on direct connections.
- **(b)** Deploy a temporary, Owner-only diagnostic that reports whether `X-Real-IP` and the last `X-Forwarded-For` entry differ between a CDN request and a direct one, then design a check the app can enforce.

Retest with the probe above before setting the header.

## Already public (GitHub history)

The repository `notcoderhuman/LockInConsulting` is **public**. All five published branches contain:

| Published content | Assessment |
|---|---|
| `db/intake/`: 2 research batches, a research report, 11 destination files (about 600 KB) | Older research with `evidence` quotes, source URLs, check dates and **unverified** fees, courses and durations. No credentials, private paths or student data; the only email is a public publisher address. Removed from the tree by local commit `c8c8447`, but **still in public history** |
| `db/intake/` notes still in the tree (`imf-terms-review`, `link-check`, `pdf-audit`, `PDF-AUDIT.md`, `RESEARCH-CHECKLIST.md`) | Process notes; still tracked |
| `.aistudio/` and `public/assets/aistudio/` (3 copies of one image) | A screenshot of the site's own public Germany page. Harmless. Removed going forward |
| Founder photo | Public by design. Removed going forward; nothing references it |
| `docs/ENVIRONMENT.md` with a Windows project path | Low sensitivity. Removed from the current file |

The 431-university identity snapshot, held notes and evidence of the current import were **never committed**.

**Options for the public research:**
- **(1) Accept.** The values are quotations of public university pages, and the site never presents them as verified. Lowest risk.
- **(2) Purge.** Rewrite all published branches without `db/intake/`, force-push, and ask GitHub Support to clear cached views. Copies already fetched, cached or forked cannot be recalled. It needs a separate plan and approval.

## Local history and cleanup plan

**What a push would publish:**
- Two local commits sit on top of public `0b2943b`: `ba870e2`, which is clean, and `c8c8447`, which contains the private research-folder path in `docs/ENVIRONMENT.md`. Only `dev` contains `c8c8447`.
- There are no stashes or tags.

**Plan**, for approval. It changes only unpublished history, so no force-push is needed:

```bash
git branch backup/dev-before-release c8c8447   # keeps the original history locally; never push this branch
git reset --soft ba870e2                       # drops c8c8447 as a commit; its changes and today's stay in the working tree
git rm --cached tsconfig.tsbuildinfo           # untrack the build cache; the local file stays
git add -A                                     # .gitignore keeps .env*, brag-output/, caches and worktrees out
git diff --cached --stat                       # review
git log -p ba870e2..HEAD | grep -E "<identifier patterns>"   # must print nothing
git commit                                     # author notcoderhuman, co-author line
```

**Push**, only after approval: `git push origin dev` (never `--all`, which would publish the backup branch).

## What will be published

A push of `dev` after the plan publishes `ba870e2` (46 files, already reviewed) and **one release commit with 209 paths** relative to `ba870e2`: 97 added, 91 modified, 21 deleted.

| Area | Paths | Includes |
|---|---|---|
| `lib/` | 44 | i18n, search, rate limits, policy, auth, database session and boot migration |
| `tests/` | 37 | 16 new test files plus updates |
| `components/` | 36 | Search, saved lists, profile actions, FAQ, language switch, text size, shortcuts |
| `app/` | 32 | `/universities`, `/faq`, profile route, `/age-confirm`, health, search and lookup APIs, admin |
| `db/` | 22 | Migrations 0009–0012; deletion of `db/intake/` research files |
| `docs/` | 10 | Including `HINDI-REVIEW.md` and this file; all redacted |
| `scripts/` | 9 | Importer, migrator, dev scripts |
| Root files | 14 | `package.json`, `pnpm-lock.yaml`, `next.config.mjs`, `instrumentation.ts`, `.gitignore`, `.claude/launch.json`, docs; deletions of `package-lock.json` and `tsconfig.tsbuildinfo` |
| `public/`, `.aistudio/` | 4 | Deletions only (founder photo, duplicate screenshot) |

**Never published (ignored):** all `.env*` files, `brag-output/`, `.impeccable/`, `.claude/worktrees/`, `node_modules/`, `.next/`.

**Scan of the release diff's added lines:** 0 hosting identifiers, private paths or server IPs; 0 credentials.

## Verification (canonical project folder, candidate 3)

| Check | Result |
|---|---|
| `pnpm typecheck` | Pass |
| `pnpm test` | **353 passed**, 14 skipped, 0 failed |
| `pnpm test:db` | **242 passed**, 6 skipped, 0 failed (includes "Google cannot be started while student accounts are closed") |
| `pnpm build` (Webpack) + `prepare-standalone` | Pass; git status unchanged by the run |
| Built production server: 13 public pages and APIs | All 200 with local data; no internal fields, notes, hosting identifiers or paths |
| Security | Enforced CSP without `unsafe-eval`; `SAMEORIGIN`; `nosniff`; referrer policy; no `X-Powered-By`. Hindi hidden even with a Hindi cookie. Google sign-in start, email sign-up, student and anonymous admin APIs refused. Hostile search input → empty results; oversize and malformed input → 400. Forged IP headers are ignored while the header is unset |

## Deployment checklist

**Before (local, owner approvals):**
1. Approve this candidate and decide on the public research (accept or purge).
2. Run the cleanup plan and commit; scan; push `dev` only.
3. Build once in a quiet folder (one session at a time): `pnpm build`. Package the standalone output with its SHA-256.

**Hosting panel environment:**
4. Keep `STUDENT_ACCOUNTS_ENABLED`, `STUDENT_SELF_SIGNUP_ENABLED`, `DEREK_AI_ENABLED`, `HINDI_UI_ENABLED` and `AUTH_CLIENT_IP_HEADER` unset or false.

**Deploy:**
5. Back up the staging database and prove the restore on MariaDB 11.8.9.
6. Deploy the package. No migration is needed.

**After deploying:**
7. Health 200; 12 migrations unchanged; staff sign-in title; Overview at 375 px; a checked and a pending profile (both `noindex`); `/universities`; `/faq`; no Hindi switch; Google shown as unavailable on `/auth`; student accounts and Derek off; anonymous admin API 401; 0 remote database rules; public leak scan clean.

## Unresolved risks

| Risk | Handling |
|---|---|
| Direct-origin HTTPS bypasses the CDN | Keep `AUTH_CLIENT_IP_HEADER` unset; establish the boundary (a) or (b) above |
| Older research already in public history | Owner decision: accept or purge |
| Hindi strings unreviewed | Hidden by default; release after `docs/HINDI-REVIEW.md` sign-off |
| 45 bot-page source titles | Correct during review, before verifying those universities |
| No real screen-reader test | NVDA or TalkBack before a public launch |
| Shared working folder | One session builds at a time |
