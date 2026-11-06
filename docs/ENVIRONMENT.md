# Environment Variables & Configuration

LockIn Consulting is architected to run safely in development without requiring any production environment variables or a live database.

A template file is available at `docs/env.example`.

---

## Variable Reference

### Public Site

| Variable | Description | Default / Missing Behavior |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL for sitemap generation and Open Graph tags. | When unset, `robots.txt` sets `disallow: /` and sitemap returns `[]`, preventing crawlers from indexing an unlaunched or preview site. |
| `CSP_MODE` | Optional. `report-only` sends the Content-Security-Policy as report-only (for debugging a policy change). | Unset or any other value: the policy is enforced (`lib/security/csp.ts`). |

### Database Access

| Variable | Description | Default / Missing Behavior |
| :--- | :--- | :--- |
| `DATABASE_URL` | Main MySQL 8.4+ / MariaDB 10.5+ connection string for public directory reads. | When unset, destination pages render their static guides, official embassy and government links, and an honest "pending verification" listing state (`{ state: 'not_configured' }`). No fake data is generated. |
| `ADMIN_DATABASE_URL` | Optional connection string for administrative database operations requiring elevated privileges. | Falls back to `DATABASE_URL` if not set. |

> **Note on `AUTH_DATABASE_URL`**: Previously listed in legacy drafts, `AUTH_DATABASE_URL` was confirmed unused by all application code, tests, and scripts (`lib/db/pool.ts` uses `ADMIN_DATABASE_URL || DATABASE_URL` for auth) and has been removed from templates.

#### Local database and the private research import

Locally, `DATABASE_URL` comes only from the sandbox, never from production:

- `pnpm dev:local` starts a throwaway MySQL 8.4, applies every migration and writes `.env.sandbox.local` (git-ignored). The database is deleted when the preview stops.
- `pnpm dev:local:persist` does the same with a **persistent** local MySQL 8.4 (`scripts/local-mysql.mjs`): data in `~/.lockin-consulting/local-db` (or `LOCKIN_LOCAL_DB_DIR`), listening on `127.0.0.1:33307` (or `LOCKIN_LOCAL_DB_PORT`), outside this repository. The synthetic sign-ins and auth secret are kept beside the data and reused. Ctrl-C shuts MySQL down cleanly and keeps the data. Delete that folder to start again.

To load the private research (kept outside this repository) into that sandbox for review, run in a second terminal while the preview is running:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env.sandbox.local | cut -d= -f2-)"
pnpm research:import -- --dir "<research-folder>" --apply --check-websites
```

`--enrich` also reads `<research folder>/enrichment/*.json` (format `lockin-enrichment-v1`): programme-level courses, intakes, fees and requirements for universities **already in the database**. Every fact needs its own verbatim quote, a specific official page and a check date; each fee, intake or requirement belongs to one programme only. Existing rows are never overwritten (empty requirement fields of unverified courses are filled), re-runs create nothing twice, and everything new waits for review. "No tuition" cannot be stored (amount must be positive), so it is never written as 0.

`--check-websites` fetches each new university's official website once (normal page request, honest user agent; never QS or any ranking site). Universities whose site answers over https on the same domain with a title naming them are listed provisionally ("Not yet verified": name, website and, if the page states it, city; D-043). Institutions not named as universities, and sites that block or fail the check, are imported for review but not listed, with the reason in their notes; a reviewer can list them after checking by hand.

Without `--apply` it only reports what it would import. With it, it backs up the directory tables to `<research folder>/import-backups/`, then creates each university, campus, course, intake and fee as draft → in review, unverified and unpublished, with both steps in the audit log. It never verifies, publishes or writes rankings (D-014). A fact is imported only when the research quotes a specific official page; everything else is listed as missing evidence. Existing universities (same destination and slug) are never changed, so re-running is safe. It refuses any database that is not on this machine unless `--allow-remote` is given, which needs a backup and the owner's approval first.

### Staff Administration & Better Auth

The admin dashboard (`/admin`) and auth endpoints (`/api/auth/*`) are strictly **fail-closed**. If any of the following variables are missing or invalid, admin pages redirect to `/admin/unavailable` and auth API endpoints return HTTP 503.

| Variable | Description | Default / Missing Behavior |
| :--- | :--- | :--- |
| `BETTER_AUTH_SECRET` | Secret key (minimum 32 characters) used to sign and encrypt session cookies. | When missing or < 32 characters, Better Auth refuses to initialize and the admin dashboard remains disabled. |
| `BETTER_AUTH_URL` | Canonical base URL for Better Auth authentication callbacks and trusted origins. | Required when admin is active. Must use `https://` in production (allows `localhost` in development). |
| `AUTH_CLIENT_IP_HEADER` | Optional. The **one** header your hosting proxy overwrites with the real client IP on every request (for example `x-real-ip`). Set it only after confirming the proxy overwrites, not appends, that header and that the app cannot be reached except through the proxy. When set, each client IP also gets a sign-in budget (5 attempts, then 1 a minute) checked before the shared one; requests without the header share one bucket. Verification steps: `TODO.md`, After purchase, step 4. **On Hostinger: leave it unset for now.** Hostinger CDN (always on for `*.hostingersite.com`) sets `X-Real-IP` to the address that connected to it and only appends to `X-Forwarded-For`, whose earlier entries come from the client; it strips `CF-Connecting-IP` (Hostinger support, "Hostinger CDN: Visitor IP addresses in logs and analytics", checked 3 Nov 2026). So `x-real-ip` is the right header **only for requests that come through the CDN**, and never `x-forwarded-for` (the app trusts the header's whole value). But a read-only test on 3 Nov 2026 showed the origin server also answers HTTPS sent straight to its IP (no SNI, staging hostname in `Host`), reaching the app without the CDN and carrying whatever `X-Real-IP` the sender chose. Until that path is closed (ask Hostinger to accept only CDN connections) or the app can tell CDN requests apart, setting it would let anyone choose their own client IP: bypassing per-client limits, or spending another person's sign-in budget. Do not put Cloudflare in front of Hostinger CDN without revisiting this. | Unset (default): no client IP is trusted. `X-Forwarded-For` is ignored, per-IP sign-in limits are off (attempts from unrecognised browsers share one budget of 10, then 4 a second, before any password is hashed; during a flood new browsers may get 429, R-033 launch blocker), and per-account throttling still applies: 5 free failures, then a delay that grows from 15 s to at most 3 minutes per attempt (never a hard lockout), with browsers that previously signed in to the account throttled separately via an HttpOnly device cookie. |
| `ADMIN_DISABLED` | Emergency kill switch (`true` / `false`). | If set to `true`, instantly disables the admin dashboard regardless of credentials. |

### Student support and Derek (Stage 7)

All of these default to **off**. Leave them unset on staging and production until the blockers in `RISKS.md` are cleared.

| Variable | Description | Default / Missing Behavior |
| :--- | :--- | :--- |
| `STUDENT_ACCOUNTS_ENABLED` | `true` opens `/support` and `/api/student/*` to students who already have a profile. No sign-up unless `STUDENT_SELF_SIGNUP_ENABLED` is also `true`. | Unset: the student page explains accounts aren't open; student APIs return 503. Blocked by R-026. |
| `DEREK_AI_ENABLED` | Global live-AI flag. | Unset: no drafts are generated; the inbox shows "Live AI is switched off". |
| `HINDI_UI_ENABLED` | `true` shows the English/Hindi switch in the header and honours the `lockin-lang` cookie. Set only after every line in `docs/HINDI-REVIEW.md` is approved by a fluent reviewer. | Unset (anything but `true`): no switch; every page renders in English, even for a browser that still has a Hindi cookie. The local sandbox sets it so the draft can be reviewed. |
| `DEREK_PROVIDER` | `mock` (default; offline, development/tests only, refused when `NODE_ENV=production`) or `gemini` (Google Gemini API, model `gemini-3.5-flash-lite`). | Unset: `mock`. Unknown value: Derek reports "blocked". |
| `DEREK_PROVIDER=vertex` + `VERTEX_API_KEY`, `VERTEX_PROJECT_ID`, `VERTEX_LOCATION` | The same model on Vertex AI under the Google Cloud terms (recommended over the Developer API; see `docs/DEREK-PROVIDER-TERMS.md`). The key is **secret** and server-side only; location defaults to `global`. Production also needs `DEREK_PROVIDER_APPROVED=vertex`; `GEMINI_PAID_TIER` does not apply. | Missing key or an invalid project/location: Derek reports "blocked". |
| `GEMINI_API_KEY` | **Secret.** Gemini API key, required when `DEREK_PROVIDER=gemini`. Server-side only: set it in the hosting panel or your shell, never in a committed file, a `NEXT_PUBLIC_` variable or `.env.sandbox.local`. Sent only in the `x-goog-api-key` header; never logged or stored. | Missing, blank, or containing a line break or other character that cannot be sent in an HTTP header: Derek reports "blocked" and makes no request. The key is otherwise treated as opaque (legacy `AIza…` and newer `AQ.…` keys both work; surrounding whitespace is trimmed); Google decides whether it is valid. |
| `DEREK_PROVIDER_APPROVED` | The provider id (e.g. `gemini`) whose **own terms** were reviewed and permit this student-facing service, with the data-handling review done. Required in production before that provider may draft for real students. Not the same as `DEREK_AUTO_REPLY_CLEARED`. | Unset: Gemini is blocked in production (synthetic local testing only elsewhere). Keep unset (R-027). |
| `DEREK_GEMINI_MODEL` | Optional. Only `gemini-3.5-flash-lite` is accepted. `gemini-3.5-flash` is a deprecated ID Google routes to `gemini-3.6-flash`; it is refused with that explanation. | Any other value blocks Gemini (no silent model substitution). |
| `GEMINI_PAID_TIER` | `true` attests that the key belongs to a **paid** (billing-enabled) Gemini API project, whose prompts are not used to improve Google's products. | Required for Gemini when `NODE_ENV=production`. Outside production, Gemini on the unpaid tier is for **synthetic data only**. |
| `DEREK_GEMINI_DAILY_DRAFT_LIMIT` | Cost cap: Gemini drafts per rolling 24 hours (1–2000). | Default `100`. When reached, questions stay with the team. |
| `DEREK_MAX_ATTEMPTS` | Provider attempts per draft: `1` or `2`. | Default `2` (one retry on 429, 5xx, timeout or malformed reply). `1` guarantees at most one request per draft, as in the smoke test. |
| `DEREK_AUTO_REPLY_CLEARED` | The **provider id** (for example `mock`) whose provider-terms, privacy and age-eligibility review for unreviewed automatic replies is complete. Clears only that provider; `true` or another id clears nothing. The provider adapter must also declare that it permits automatic replies, and the owner must still choose offline mode and enable automatic replies in `/admin/settings`. With Gemini it also needs `DEREK_PROVIDER_APPROVED=gemini` and `GEMINI_PAID_TIER=true` in production (D-041). | Unset: automatic replies cannot be enabled and are never sent. |
| `DEREK_DAILY_TOKEN_LIMIT` | Spend cap for every provider: input + output tokens per rolling 24 hours (1–5,000,000). | Default `500000`. When reached, no new drafts start; questions stay with the team. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Both set: "Continue with Google" for **students** (never staff). Redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google` (locally `http://localhost:3000/api/auth/callback/google`). Server-side only. | Google button shown as unavailable. |
| `STUDENT_SELF_SIGNUP_ENABLED` | `true` (with `STUDENT_ACCOUNTS_ENABLED`): Google may create new student accounts; each must confirm 18+ and the privacy notice before any access. | No new accounts; Google only signs in existing Google-created students. Blocked by R-026 (privacy notice). |
| `STUDENT_PRIVACY_NOTICE_URL` | The published student privacy notice, linked from the 18+ and privacy steps. **In production new student accounts open only when this is exactly `/privacy` AND that notice is complete**: `LEGAL_REVIEWED = true` and every business detail filled in, both in `lib/legal/notice.ts` (a code change after legal review, never invented). An external URL cannot be checked and never opens production sign-up. | Production: no new student accounts. Development: sign-up follows the two flags; the step shows no link. |
| `STUDENT_TEST_EMAILS` | Pre-launch tester mode: comma-separated addresses, matched case-insensitively. With `STUDENT_ACCOUNTS_ENABLED=true` and the privacy notice not yet ready (`lib/legal/notice.ts`), ONLY these addresses can get a code, create an account (18+ step and verified email still required), set a password, sign in and use the chat; works with `STUDENT_SELF_SIGNUP_ENABLED=false`. Everyone else gets the same answers as today, no code, no session, and sees "Student accounts aren’t open yet". Testers start at the unlinked `/auth?tester=1`. Staff are never let in, even if listed. Admin › Settings shows only the count. Switches itself off once the notice is ready. | Unset: no tester mode. |
| Session lifetime (code, `lib/auth-options.mjs`) | Students: 30 days, extended at most once a day while in use. Staff: 8 hours from sign-in, absolute (`STAFF_SESSION_SECONDS`, enforced in `lib/admin/access.ts`). Cookies are HttpOnly and SameSite=Lax, and Secure whenever `BETTER_AUTH_URL` is https. A password change or reset signs out every other session. | n/a |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Both set (with `STUDENT_ACCOUNTS_ENABLED`): "Continue with Microsoft" for students, personal and work or school accounts (`common` tenant). Callback `<BETTER_AUTH_URL>/api/auth/callback/microsoft`. Setup: `docs/AUTH-PROVIDERS.md`. | Microsoft shown as unavailable. |
| `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` | Both set: "Continue with Apple". The ID is the Services ID; the secret is the signed client-secret JWT (valid at most 6 months). Needs the paid Apple Developer Program. Callback `<BETTER_AUTH_URL>/api/auth/callback/apple`. | Apple shown as unavailable. |
| `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET` | Both set: "Continue with Yahoo" (OpenID Connect). Callback `<BETTER_AUTH_URL>/api/auth/callback/yahoo`. | Yahoo shown as unavailable. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | All set (with `STUDENT_ACCOUNTS_ENABLED`): students can sign in, sign up (after /age-confirm) and reset a password with a 6-digit emailed code (`lib/auth-otp.ts`). Port 465 = implicit TLS, any other port must offer STARTTLS. Any SMTP relay works; options and prices: `docs/EMAIL-DELIVERY.md`. Secret: set only in the hosting panel. | No emailed codes; the sign-in page offers only providers and passwords. |
| `MAIL_TRANSPORT` | `log` (development only, ignored in production): codes are printed to the server console instead of being emailed. | SMTP. |
| `MICROSOFT_CLIENT_ID`/`_SECRET`, `YAHOO_CLIENT_ID`/`_SECRET` | Reserved. Presence is only reported as "credentials supplied, untested"; not wired in. | Reported as "not configured". Apple is deferred (cost). |

Gemini additionally drafts **only for students whose profile records an 18+ confirmation** (`student_profiles.age_confirmed_at`), because the Gemini API terms forbid clients directed towards or likely to be accessed by under-18s. The Google sign-up step and the provisioning CLI set it; the sandbox's synthetic student is marked as an adult for testing.

Derek's knowledge comes only from the published `public_*` views (`lib/derek/evidence.ts`): universities, courses, intakes and deadlines, tuition with the website's INR estimate (only from an FX provider with approved terms and a rate no older than 7 days, quoted with its rate date and source, never computed by the model), course and admissions links, and comparisons of up to three universities or two destinations. Every evidence line carries its source URL, publisher and checked date, and a draft that states a directory fact without its source is held for a person. Missing, unavailable or out-of-date figures are stated as such. Rankings reach the model only when the provider's licence sets `allow_ai_use` (QS is conditional: never).

Derek may also use the directory's **draft** records (imported but not yet checked; draft or in review, never withdrawn, each with its own source and any per-field source). Every such fact reaches the model prefixed `UNVERIFIED, not yet checked by LockIn`, and Derek may state it only under the line `Not yet checked by LockIn (unverified):` with its source URL, publisher and accessed date. A draft fact shown anywhere else, or a claim that LockIn verified something when only drafts support it, is high risk and goes to a person. Drafts give no rankings and no INR estimate, and the public directory pages still hide them.

If the Gemini project's prepaid credit runs out, Google answers HTTP 402: Derek records `quota_exhausted`, does not retry, and the question stays with the team.

### Live Gemini smoke test (synthetic data, run by the owner)

`pnpm test:gemini-live` runs the real Derek pipeline against the real Gemini API with a throwaway database and synthetic accounts only. At most **5** requests reach Google (`DEREK_MAX_ATTEMPTS=1`, except the comparison, which may add one shortening rewrite); at paid-tier prices that is well under USD 0.01. The key is never printed or written to disk.

It checks:
- "hi" gets LockIn's greeting without calling Gemini;
- a statement-of-purpose question gets a relevant answer, auto-sent and attributed, with a student notification and an audit entry naming `gemini` (a quality hold is also a safe pass);
- a Germany/Italy comparison sends no invented figures;
- a visa question is escalated (high risk, nothing sent);
- a taken-over conversation gets no call and no reply;
- after Dev goes offline the handoff sends at most once.

Timeouts, 429/5xx retries, safety blocks and malformed responses are covered offline in `tests/gemini.test.ts`.

**Windows PowerShell** (the key lives only in this process; nothing is saved to history, a file or your user environment):

```powershell
Set-Location <project-folder>
$secure = Read-Host -Prompt 'Paste GEMINI_API_KEY (input hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:GEMINI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); Remove-Variable secure, bstr }
pnpm test:gemini-live
Remove-Item Env:GEMINI_API_KEY
```

Expected: 6 tests pass and `[live] requests sent to Gemini: 5` (or fewer).

To run one test alone, pass its tag: `pnpm test:gemini-live -- -t comparison` (1 request, or 2 if the first answer is over 900 characters and gets one rewrite). Tags: `config`, `greeting`, `ordinary`, `comparison`, `visa`, `handoff`. A filter that matches no test is refused before anything starts, so it can never report "skipped" as a pass.

### Production settings for real students (owner, in the hosting panel only)

Set only after the live smoke test passes:

| Variable | Value |
|---|---|
| `DEREK_AI_ENABLED` | `true` |
| `DEREK_PROVIDER` | `gemini` |
| `GEMINI_API_KEY` | Secret, from the **billing-enabled** Google Cloud project. A Google AI Pro subscription does not pay for API calls. |
| `GEMINI_PAID_TIER` | `true`. Attests the key's project has active billing. |
| `DEREK_PROVIDER_APPROVED` | `gemini` (D-041: Google confirmed the use, subject to its conditions) |
| `DEREK_AUTO_REPLY_CLEARED` | `gemini`. Turns on unreviewed replies for low-risk questions while the team is offline. |
| `DEREK_GEMINI_DAILY_DRAFT_LIMIT` | Optional. Default 100 Gemini calls per rolling 24 h. |
| `DEREK_DAILY_TOKEN_LIMIT` | Optional. Default 500,000 tokens per rolling 24 h. |

Gemini model check (5 and 6 Nov 2026, Google's docs now at aistudio.google.com/docs): `gemini-3.5-flash-lite` is listed as Stable with no shutdown date announced; paid tier USD 0.30 input / 2.50 output per 1M tokens; the paid tier needs a linked billing account and a prepaid minimum of USD 5. Terms effective 23 Mar 2026: users must be 18+, use is "for professional or business purposes, not for consumer use", and only paid services keep prompts out of product improvement.

Also set a budget with alerts on the Google Cloud project (Billing → Budgets & alerts), e.g. USD 10/month with alerts at 50/90/100 %. App-level caps stay on regardless: 10 automatic replies per student per day, 60 per hour and 300 per day overall. The owner's kill switch is in `/admin/settings`; untick it to stop every automatic reply at once. Student sign-up (`STUDENT_SELF_SIGNUP_ENABLED`) stays off until the privacy notice is published (R-026).

### Google sign-in setup (students only; done by the owner)

Google sign-in uses Better Auth's built-in Google provider (`lib/auth.ts`). It reads exactly three settings at runtime: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `BETTER_AUTH_URL`. It asks Google for **`openid`, `email` and `profile` only**: no Gmail, Drive or other access, no offline (refresh-token) access, and the auth route refuses any request that tries to add scopes. Staff never sign in with Google.

**Callback URIs.** Better Auth sends Google `<BETTER_AUTH_URL>/api/auth/callback/google`. Google only accepts a redirect URI that is listed on the OAuth client **character for character**: scheme, host, port and path, with no trailing slash. Keep each environment separate:

| Environment | `BETTER_AUTH_URL` | Authorized redirect URI to register |
| --- | --- | --- |
| Local (`pnpm dev:local:oauth`) | `http://localhost:3000` (set by the script) | `http://localhost:3000/api/auth/callback/google` |
| Staging | `https://<your staging domain>` | `https://<your staging domain>/api/auth/callback/google` |
| Production | `https://<your real domain>` | `https://<your real domain>/api/auth/callback/google` |

Use the real domains, not these placeholders. A different port (for example `DEV_PORT=3100`) needs its own matching local URI. Prefer **one OAuth client per environment** (or at least a separate one for production), so local or staging credentials can never sign anyone into production.

**Steps in Google Cloud Console** (console.cloud.google.com):

1. Create or select a project for LockIn (it can be the same billing project as Gemini, or a separate one).
2. **Google Auth Platform → Branding** (the OAuth consent screen): app name "LockIn Consulting", a support email, the app's home page, its privacy policy URL (the published student notice, also used for `STUDENT_PRIVACY_NOTICE_URL`) and, under authorised domains, your real domain.
3. **Audience:** choose **External** (students use their own Google accounts). While the app is in **Testing**, only the Google accounts listed under **Test users** can sign in: add the owner's account and any staging testers there. A Testing app shows Google's "unverified app" warning and is not for the public.
4. **Data Access:** add only `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. These are non-sensitive scopes.
5. **Clients → Create client → Web application.** Name it per environment (for example "LockIn local", "LockIn staging", "LockIn production"). Under **Authorized redirect URIs**, add the URI from the table above. Authorized JavaScript origins are not needed (the code exchange happens on the server).
6. Copy the client ID and client secret **once**, straight into the place below. Never paste them into chat, tickets, commits or screenshots.
7. Before real students use it: switch Audience to **In production** and complete whatever brand verification Google asks for. Creating a client does **not** make the app published, verified or production-ready.

**Where the credentials go.**

- *Local:* create `.env.oauth.local` in the project folder (git-ignored by `.env*.local`; `git check-ignore -v .env.oauth.local` confirms it) with:

  ```
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  # optional, local only: also let NEW students sign up (after /age-confirm)
  # STUDENT_SELF_SIGNUP_ENABLED=true
  ```

  Then run `pnpm dev:local:oauth`. It uses the persistent local database, reads only those three keys, never prints their values, never writes `.env`, `.env.sandbox.local` or `.env.oauth.local`, and prints the redirect URI to register. Plain `pnpm dev:local` / `dev:local:persist` keep stripping Google credentials and the sign-up flag, as before.
- *Staging / production:* the hosting panel's environment variables only, with `BETTER_AUTH_URL` set to that environment's own `https://` origin.

**Switches stay separate.** With credentials set, `STUDENT_ACCOUNTS_ENABLED=true` lets existing students sign in with Google. New accounts also need `STUDENT_SELF_SIGNUP_ENABLED=true` and, in production, `STUDENT_PRIVACY_NOTICE_URL`, and every new account still passes `/age-confirm` (D-045). Leave self sign-up off in production until the privacy notice is published and reviewed (R-026), the live staging tests below pass, client-IP rate limiting is configured (`AUTH_CLIENT_IP_HEADER`, R-033), and migrations up to 0010 are applied after a verified backup.

**Live tests to run once credentials exist** (locally with `dev:local:oauth`, then on staging): start Google sign-in and return; cancel on Google's screen (back on `/auth` with "cancelled", and no usable age confirmation left); sign in as an existing Google student; try a new Google account with self sign-up off ("no student account" message, nothing created); with self sign-up on (staging or local only), Create account → `/age-confirm` → Google → privacy step → `/chat`; a Google account whose email matches a staff account (refused, "already has a LockIn account"); reload `/chat` (session kept), sign out, and check that the student cannot open `/admin`. Record each result; mocked tests (`tests/db/google-auth.db.test.ts`) are not a substitute.

## Development vs. Staging vs. Production

1. **Development Preview (Local / Cloud Workspaces)**:
   - **Required variables**: None.
   - The public homepage (`/`), the destinations directory (`/destinations`), and all 11 individual destination pages (`/destinations/[slug]`) render cleanly without a database.
   - The admin area fails closed to `/admin/unavailable`.

2. **Staging & Production**:
   - Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and optionally `NEXT_PUBLIC_SITE_URL`.
   - Run migrations via `pnpm db:migrate` from a trusted operator shell.
   - Provision staff users using `pnpm admin:user` CLI.
