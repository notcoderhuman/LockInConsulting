# Stage 2: application database and staging deployment

Prepared 1 November 2026. Planning only: nothing here has been run on Hostinger.

Target: `https://<staging-host>`, account `<hosting-account>`, server `<db-server>`, MariaDB 11.8.9, Node 24.

## Server-side migrations

Hostinger shared hosting has no shell and no SSH API. A cron job can run on the server, but its command holds the database password and can be read back. Migrating remotely leaves triggers and views owned by a user tied to one IP address.

So migrations run inside the application (D-048). Next.js calls `instrumentation.ts` once per server start and waits for it before serving. With `MIGRATE_ON_BOOT=1`, `lib/db/boot-migrate.mjs` connects over `127.0.0.1` as the site's database user.

| Requirement | How it is met |
| --- | --- |
| Privileges | Rights are checked before any change: the runner probes CREATE TABLE, VIEW and TRIGGER and stops if one is refused. The API shows Create, Create view, Trigger, Alter, Drop and Index granted to these accounts. |
| Ownership | Objects are owned by the local user. The run stops if there are not 14 triggers or an owner is tied to a remote host. |
| Exactly once | `schema_migrations` with checksums, `GET_LOCK`, and a re-read after taking the lock. |
| Failure | A failed or interrupted run is never recorded. The process stays alive but never serves, and only a new deployment can try again. |
| Restarts | One attempt per deployment. `.migrate-attempt` is written first and removed only on success, so restarts open no database connection and cannot loop. |
| Recovery | DDL cannot be rolled back. `lockin_app` starts empty, so recovery means clearing and re-running it, with approval. |

## Application

| Item | Value |
| --- | --- |
| Start | Hostinger's Next.js app type. The standalone entry is `node .next/standalone/server.js`, which reads `PORT` and `HOSTNAME`. **Unverified:** Hostinger does not document its real start command. |
| Build | `pnpm build`, which is `next build --webpack && node scripts/prepare-standalone.mjs`. Turbopack cannot run on Hostinger: the server lacks glibc 2.29, so the native compiler fails to load. |
| Node | 24 |
| Package manager | pnpm 11.20.0 declared. Hostinger's pnpm version cannot be chosen: read it in the first build log. |
| Dev dependencies | Needed to build (Tailwind, PostCSS, TypeScript). `NODE_ENV` must not be set on Hostinger, or the install could skip them. `server.js` sets production itself. |
| Runtime | Standalone output, about 62 MB with Webpack. Needs no `node_modules` from the project root. |
| Database | `mysql://<user>:<password>@127.0.0.1:3306/<database>`. Never `localhost` or the `srv981` host. **Unverified:** the local login has not been tested, because all tests so far used a remote IP rule. |
| Health check | `GET /api/health`: 200 only with every migration recorded, otherwise 503. No details, `no-store`. |
| Logs | `hosting_nodejs_runtime-logs`. Boot migration lines are JSON with timestamp, level and message. |
| Caching | The CDN cannot be turned off for this domain. Every page sends `private, no-store`. Verify on the live site. |

## Environment variables

Secret values stay in the git-ignored `.env.stage2.local` and go to Hostinger only through a local script.

| Variable | Value | Secret |
| --- | --- | --- |
| `DATABASE_URL` | `lockin_app` over `127.0.0.1` | Yes |
| `BETTER_AUTH_URL` | `https://<staging-host>` | No |
| `BETTER_AUTH_SECRET` | Fresh random value, never reused | Yes |
| `GOOGLE_CLIENT_ID` | Existing client, staging callback registered | No |
| `GOOGLE_CLIENT_SECRET` | Existing client | Yes |
| `STUDENT_ACCOUNTS_ENABLED` | `false` | No |
| `STUDENT_SELF_SIGNUP_ENABLED` | `false` | No |
| `DEREK_AI_ENABLED` | `false` | No |
| `MIGRATE_ON_BOOT` | `1` for the first start only, then removed | No |

Leave unset: `NODE_ENV`, `NEXT_PUBLIC_SITE_URL` (keeps staging out of search engines), `STUDENT_PRIVACY_NOTICE_URL`, `GEMINI_API_KEY`, `DEREK_PROVIDER`, `DEREK_PROVIDER_APPROVED`, `GEMINI_PAID_TIER`, `DEREK_AUTO_REPLY_CLEARED`, `ADMIN_DATABASE_URL`, `AUTH_CLIENT_IP_HEADER`, `CSP_MODE`.

`STUDENT_SELF_SIGNUP_ENABLED` must never be copied from `.env.oauth.local`, where it is on for local testing. Only the two Google values are read from that file.

## Database

`<account>_lockin_app`, user `<account>_lockin_app`, generated password, `website_domain` set to the staging site. No remote rule during migration. `lockin_test` and `lockin_rst` stay as test evidence.

## Sequence

Migrations follow the build because they run when the application starts.

1. Generate the password and auth secret into `.env.stage2.local`.
2. Create `lockin_app` and confirm it is on the staging site.
3. Set the environment variables, with `MIGRATE_ON_BOOT=1`.
4. Upload the sanitized package with `hosting_deploy` (Node 24, `next`, `pnpm`, script `build`). This replaces the placeholder `default.php`.
5. Hostinger installs dependencies. Check the log for the pnpm version and that development dependencies installed.
6. Hostinger builds. Stop on failure.
7. Application starts and migrates. Read the logs: 12 applied, 14 triggers, local owner.
8. Verify `/api/health` returns 200 over HTTPS.
9. Remove `MIGRATE_ON_BOOT`, which restarts the app, and confirm health again.
10. Check HTTPS, redirect, headers, CSP and caching.
11. Create a synthetic staff account through a temporary single-IP rule, then remove the rule.
12. Run the staging regression.

## Result

Stage 2 finished on 2 November 2026. `docs/PRODUCTION-READINESS.md` holds the results. The next steps are a synthetic staff account and the staging regression.

## Unverified at planning time

The start command, working directory, local database login, trigger owner, marker persistence, pnpm version, process manager behaviour and CDN behaviour are assumptions until the first deployment. `docs/PRODUCTION-READINESS.md` lists what happens if each is wrong. A killed migration can also finish its current file on the server, because the server completes a batch it has already received. That file is not recorded, so the app stays closed.

## Stop conditions

Any failed step stops the sequence with no retry. The root domain, DNS, `lockin_test` and `lockin_rst` are never touched.

## First attempt and redeploy

The first run on 1 November 2026 created `lockin_app`, set the environment and uploaded the package, then failed at the build because Hostinger's server lacks glibc 2.29. No app started and no migration ran. That run confirmed Node 24, pnpm 11.20.0, the lockfile and development dependencies. It also left the archive publicly downloadable in `public_html`, because uploads can only go there and the API cannot delete files. The script now prevents this: the archive goes into a random folder with a deny-all `.htaccess`, a probe file must be publicly refused before the archive is sent, and the archive is overwritten with one byte on every outcome.

The redeploy reuses `lockin_app` and the existing credentials. It confirms the database is empty through a temporary single-IP rule, and removes that rule before any upload.

## Execution

The sequence is scripted in `stage2-run.mjs`, outside the repository. It defaults to a dry run. `--redeploy` needs `--i-approve-redeploy`. Recovery: `--remove-migrate-flag` removes the flag, and `--clear-env` removes every variable. Steps 11 and 12 are separate.
