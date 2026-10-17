# LockIn Consulting

Study-abroad guidance site for Indian students. Next.js 16.4 · three.js / React Three Fiber · Tailwind v4 · MySQL / MariaDB · Better Auth (planned host: Hostinger).

**Current stage: 5 (local product completion). Staging is blocked until the Hostinger plan is bought.** Stage 5 added an enforcing nonce-based CSP, a branded 404, `robots`/`sitemap` (no indexing until `NEXT_PUBLIC_SITE_URL` is set), a private research file for an initial 11-university batch (`db/intake/2026-10-17-initial-batch.json`, **nothing entered or published**), a dated link-check report and IMF terms evidence (still `not_reviewed`). Public homepage, 3D globe, all 11 destination pages, university-directory schema (`0001` & `0002`), Better Auth staff authentication, Owner/Reviewer/Editor role-based `/admin` dashboard, publication/licensing gates, and a SHA-256 hash-chained + trigger-protected audit log are implemented and tested against real MySQL 8.4. No production database is connected yet, and there is no student chat or AI integration (Derek remains disabled per `D-002`). University listings show "pending verification" until real, verified data is published. See `TODO.md` and `RISKS.md`.

## Scripts

```bash
pnpm dev          # local dev server
pnpm test         # Vitest unit tests (routing, validation, publication rules, RBAC, audit hash chain, UI states)
pnpm test:db      # migrations + constraints + views + admin workflow + auth against MySQL 8.4 (mysql-memory-server or $DB_TEST_URL)
pnpm typecheck    # tsc --noEmit
pnpm build        # Next.js production build
pnpm db:preflight # read-only engine/grants report for $PREFLIGHT_DATABASE_URL; add --probe to test DDL features
pnpm db:migrate   # probe, lock, then apply db/migrations to $DATABASE_URL (back up first; DDL auto-commits)
pnpm admin:user   # provision/manage admin accounts (create, grant, revoke, set-password, list, verify-audit)
```

`pnpm test:db` passes on MySQL 8.4.9 (default) and MariaDB 10.5.29 (`DB_TEST_URL=mysql://user:pass@host:port/empty_db`). Run operator commands from a trusted machine; Hostinger Business/Cloud can't run npm over SSH. See the staging checklist in `TODO.md`.

Append `?ist=15:30` to preview the globe's lighting at that India time.

## Routes
- `/` — homepage with the interactive 3D globe
- `/destinations` — the 11 destinations by region
- `/destinations/{usa|uk|canada|italy|germany|australia|new-zealand|saudi-arabia|uae|finland|poland}` — Dubai sits under `uae`
- `/admin` — staff dashboard (`overview`, `review`, `universities`, `records/[entity]/*`, `sources`, `changes`, `settings`) plus `/admin/sign-in`, `/admin/forbidden`, `/admin/unavailable`

## Data & security rules (short version)
- Every figure needs an `https://` source, a check date, a verifier and a review-due date before it can be published. Both application validation and database `CHECK` constraints enforce this.
- Expired figures (`review_due_at < CURRENT_DATE` or `valid_to < CURRENT_DATE`) disappear from public views automatically.
- Rankings stay hidden until the provider's reuse rights are `licensed` and unexpired. QS is seeded as `not_confirmed`.
- INR conversions appear only when the exchange-rate provider's terms are `approved` and the rate is ≤ 7 days old, rendered with the rate, date, source link and provider `attribution_text`. All 4 candidate FX providers (`ecb`, `frankfurter`, `fbil`, `imf`) are seeded as `not_reviewed`.
- `sources`, `fx_rates`, and `data_change_log` are append-only (enforced by database `BEFORE UPDATE`/`BEFORE DELETE` triggers and verified by the `audit_chain_head` SHA-256 hash chain).
- An **enforcing** Content-Security-Policy is set per request in `proxy.ts` (`lib/security/csp.ts`): per-request nonce + `'strict-dynamic'`, no third-party origins, no `unsafe-eval` in production. Every page is dynamically rendered so Next can stamp the nonce. `CSP_MODE=report-only` is a temporary diagnostic switch only.
- New universities are researched with `db/intake/RESEARCH-CHECKLIST.md` and entered through `/admin`. Intake files are never read by the site.
- Admin accounts can only be created or granted roles via `pnpm admin:user` on a trusted shell; public sign-up is disabled and `/admin` fails closed if auth or DB environment variables are missing.

## Docs
- `ARCHITECTURE.md` — stack, code layout, data model, RBAC and admin workflow
- `DECISIONS.md` — decision log
- `RISKS.md` — risk register, blockers, and FX source review
- `TODO.md` — phased roadmap

## Asset credits and licences
- Earth textures: NASA Earth Observatory, *Blue Marble: Next Generation* and *Black Marble 2016*. Public domain.
- Fonts: Cormorant Garamond and Manrope, SIL Open Font License, via `next/font`.
- Logo and founder photograph: supplied by LockIn Consulting.
- Icons: lucide-react (ISC).
