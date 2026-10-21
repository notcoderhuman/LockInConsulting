# Environment Variables & Configuration

LockIn Consulting is architected to run safely in development without requiring any production environment variables or a live database.

A template file is available at `docs/env.example`.

---

## Variable Reference

### Public Site

| Variable | Description | Default / Missing Behavior |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL for sitemap generation and Open Graph tags. | When unset, `robots.txt` sets `disallow: /` and sitemap returns `[]`, preventing crawlers from indexing an unlaunched or preview site. |

### Database Access

| Variable | Description | Default / Missing Behavior |
| :--- | :--- | :--- |
| `DATABASE_URL` | Main MySQL 8.4+ / MariaDB 10.5+ connection string for public directory reads. | When unset, destination pages render their static guides, official embassy and government links, and an honest "pending verification" listing state (`{ state: 'not_configured' }`). No fake data is generated. |
| `ADMIN_DATABASE_URL` | Optional connection string for administrative database operations requiring elevated privileges. | Falls back to `DATABASE_URL` if not set. |

> **Note on `AUTH_DATABASE_URL`**: Previously listed in legacy drafts, `AUTH_DATABASE_URL` was confirmed unused by all application code, tests, and scripts (`lib/db/pool.ts` uses `ADMIN_DATABASE_URL || DATABASE_URL` for auth) and has been removed from templates.

### Staff Administration & Better Auth

The admin dashboard (`/admin`) and auth endpoints (`/api/auth/*`) are strictly **fail-closed**. If any of the following variables are missing or invalid, admin pages redirect to `/admin/unavailable` and auth API endpoints return HTTP 503.

| Variable | Description | Default / Missing Behavior |
| :--- | :--- | :--- |
| `BETTER_AUTH_SECRET` | Secret key (minimum 32 characters) used to sign and encrypt session cookies. | When missing or < 32 characters, Better Auth refuses to initialize and the admin dashboard remains disabled. |
| `BETTER_AUTH_URL` | Canonical base URL for Better Auth authentication callbacks and trusted origins. | Required when admin is active. Must use `https://` in production (allows `localhost` in development). |
| `ADMIN_DISABLED` | Emergency kill switch (`true` / `false`). | If set to `true`, instantly disables the admin dashboard regardless of credentials. |

### Student support and Derek (Stage 7)

All of these default to **off**. Leave them unset on staging and production until the blockers in `RISKS.md` are cleared.

| Variable | Description | Default / Missing Behavior |
| :--- | :--- | :--- |
| `STUDENT_ACCOUNTS_ENABLED` | `true` opens `/support` and `/api/student/*` to students who already have a profile. There is still **no sign-up**. | Unset: the student page explains accounts aren't open; student APIs return 503. Blocked by R-026. |
| `DEREK_AI_ENABLED` | Global live-AI flag. | Unset: no drafts are generated; the inbox shows "Live AI is switched off". |
| `DEREK_PROVIDER` | `mock` (default; offline, development/tests only, refused when `NODE_ENV=production`) or `gemini` (Google Gemini API, model `gemini-3.5-flash-lite`). | Unset: `mock`. Unknown value: Derek reports "blocked". |
| `GEMINI_API_KEY` | **Secret.** Gemini API key, required when `DEREK_PROVIDER=gemini`. Server-side only: set it in the hosting panel or your shell, never in a committed file, a `NEXT_PUBLIC_` variable or `.env.sandbox.local`. Sent only in the `x-goog-api-key` header; never logged or stored. | Missing, blank, or containing a line break or other character that cannot be sent in an HTTP header: Derek reports "blocked" and makes no request. The key is otherwise treated as opaque (legacy `AIza…` and newer `AQ.…` keys both work; surrounding whitespace is trimmed); Google decides whether it is valid. |
| `DEREK_GEMINI_MODEL` | Optional. Only `gemini-3.5-flash-lite` is accepted. | Any other value blocks Gemini (no silent model substitution). |
| `GEMINI_PAID_TIER` | `true` attests that the key belongs to a **paid** (billing-enabled) Gemini API project, whose prompts are not used to improve Google's products. | Required for Gemini when `NODE_ENV=production`. Outside production, Gemini on the unpaid tier is for **synthetic data only**. |
| `DEREK_GEMINI_DAILY_DRAFT_LIMIT` | Cost cap: Gemini drafts per rolling 24 hours (1–2000). | Default `100`. When reached, questions stay with the team. |
| `DEREK_MAX_ATTEMPTS` | Provider attempts per draft: `1` or `2`. | Default `2` (one retry on 429, 5xx, timeout or malformed reply). `1` guarantees at most one request per draft, as in the smoke test. |
| `DEREK_AUTO_REPLY_CLEARED` | `true` records that the provider terms, privacy and age-eligibility review for unreviewed automatic replies is complete. The owner must still choose offline mode and enable automatic replies in `/admin/settings`. **Has no effect with Gemini**, which is drafts-only until separately approved. | Unset: automatic replies cannot be enabled and are never sent. |
| `GOOGLE_CLIENT_ID`/`_SECRET`, `MICROSOFT_CLIENT_ID`/`_SECRET`, `YAHOO_CLIENT_ID`/`_SECRET` | Reserved. Presence is only reported as "credentials supplied, untested"; no provider is wired in. | Reported as "not configured". Apple is deferred (cost). |

Gemini additionally drafts **only for students whose profile records an 18+ confirmation** (`student_profiles.age_confirmed_at`), because the Gemini API terms forbid clients directed towards or likely to be accessed by under-18s. No flow sets that field yet, so Gemini cannot run for any real student; the sandbox's synthetic student is marked as an adult for testing.

### Controlled Gemini smoke test (not yet run; needs the owner's approval)

One question, one HTTP request, synthetic data, local only. `DEREK_GEMINI_DAILY_DRAFT_LIMIT=1` allows one Gemini draft in the fresh sandbox database and `DEREK_MAX_ATTEMPTS=1` disables the retry, so at most **one** request can reach Google. The sandbox's synthetic student (`student@sandbox.test`) is created with an 18+ confirmation, so it passes the age gate; automatic replies stay off (Gemini never auto-sends).

**Tier and cost.** The tier is decided by the Google Cloud project behind the key, not by this app: a project **without** billing is the unpaid tier (no charge; Google may have humans review the synthetic prompt and use it to improve products), a project **with** billing is the paid tier (about USD 0.0005: ≈1,000 input and ≈150 output tokens at USD 0.30 / 2.50 per 1M; well under USD 0.01 even at the 512-token output cap). Check the project's plan in Google AI Studio before starting. Leave `GEMINI_PAID_TIER` unset for this test.

**Windows PowerShell — terminal 1 (sandbox database):**

```powershell
Set-Location C:\Users\busyv\Downloads\LockInConsulting
node scripts/dev-sandbox.mjs
```

Wait for "Sandbox database ready" and leave it running.

**Windows PowerShell — terminal 2 (Next.js), settings for this process only:**

```powershell
Set-Location C:\Users\busyv\Downloads\LockInConsulting
Get-Content .env.sandbox.local | Where-Object { $_ -match '^[A-Z_][A-Z0-9_]*=' } | ForEach-Object { $name, $value = $_ -split '=', 2; Set-Item -Path "Env:$name" -Value $value }
$env:DEREK_AI_ENABLED = 'true'; $env:DEREK_PROVIDER = 'gemini'; $env:DEREK_GEMINI_DAILY_DRAFT_LIMIT = '1'; $env:DEREK_MAX_ATTEMPTS = '1'
Remove-Item Env:GEMINI_PAID_TIER, Env:DEREK_AUTO_REPLY_CLEARED, Env:NODE_ENV -ErrorAction SilentlyContinue
$secure = Read-Host -Prompt 'Paste GEMINI_API_KEY (input hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:GEMINI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); Remove-Variable secure, bstr }
npx next dev -p 3000
```

`$env:` variables exist only in this PowerShell process and the processes it starts; nothing is written to a file, the registry or your user environment, and `Read-Host -AsSecureString` input is not saved in PowerShell history. Never paste the key on a command line.

**In the browser** (use a separate InPrivate window for the admin so the two sign-ins don't replace each other). Sign-in passwords: `Select-String '^# .*@sandbox.test' .env.sandbox.local`.

1. `http://localhost:3000/support`: sign in as `student@sandbox.test`; send exactly one question, e.g. "What is a conditional offer?". Type nothing personal.
2. `http://localhost:3000/admin`: sign in as `reviewer@sandbox.test`; open the conversation in Live Inbox. Expected: one Derek draft "Awaiting review" from `gemini · gemini-3.5-flash-lite` with token counts and a risk level, the conversation "Awaiting human review", and no Derek message visible to the student. Approve or reject it.
3. Optional: Settings shows "Automatic replies are not approved for Gemini".

**Afterwards:** press Ctrl-C in both terminals (the sandbox database is deleted), then close terminal 2 (or `Remove-Item Env:GEMINI_API_KEY`). Rotate or delete the key in AI Studio if it was ever displayed.

Bash equivalent (macOS/Linux): `set -a; . ./.env.sandbox.local; set +a; export DEREK_PROVIDER=gemini DEREK_GEMINI_DAILY_DRAFT_LIMIT=1 DEREK_MAX_ATTEMPTS=1; read -rs GEMINI_API_KEY; export GEMINI_API_KEY; npx next dev`

Local end-to-end trial with synthetic data: `node scripts/dev-sandbox.mjs` (disposable MySQL, synthetic accounts, writes the git-ignored `.env.sandbox.local`), then `set -a; . ./.env.sandbox.local; set +a; npx next dev`.

---

## Development vs. Staging vs. Production

1. **Development Preview (Local / Cloud Workspaces)**:
   - **Required variables**: None.
   - The public homepage (`/`), the destinations directory (`/destinations`), and all 11 individual destination pages (`/destinations/[slug]`) render cleanly without a database.
   - The admin area fails closed to `/admin/unavailable`.

2. **Staging & Production**:
   - Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and optionally `NEXT_PUBLIC_SITE_URL`.
   - Run migrations via `pnpm db:migrate` from a trusted operator shell.
   - Provision staff users using `pnpm admin:user` CLI.
