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
