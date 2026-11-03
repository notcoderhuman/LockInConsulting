# LockIn Consulting — Architecture

Status: **Stage 7 (support chat, local only).** Stage 7 added persistent student conversations (`0003_support_chat.sql`), the Live Inbox, Students, Our Team and Notifications admin areas, and Derek's provider-independent draft/review workflow with an offline mock provider. Student accounts stay **closed** (`STUDENT_ACCOUNTS_ENABLED` unset) and live AI stays **off** (`DEREK_AI_ENABLED` unset; the Gemini adapter added later is drafts-only and needs explicit configuration, D-035, R-027). Verified on MySQL 8.4.9 only (R-031). Stage 5: Stage 5 added an enforcing nonce CSP (`proxy.ts`), so every route now renders per request. It also added a 404 page, `robots`/`sitemap` gated on `NEXT_PUBLIC_SITE_URL`, and private intake/evidence files for the first university batch and the IMF terms (nothing published). Stage 4: local checks are complete, and the integration suite also passes on MariaDB 10.5.29. Staging is blocked on the Hostinger plan and staging credentials. Stage 3 summary: The public homepage, 11 destination pages, university-directory schema (`0001_university_directory.sql` + `0002_admin_auth.sql`), Better Auth administrator sign-in, Owner/Reviewer/Editor role-based access control, `/admin` dashboard, publication/licensing workflow, and SHA-256 hash-chained + trigger-protected audit log are implemented and verified against real MySQL 8.4 (`pnpm test:db`). There is still **no live production database connection, no student chat, and no AI provider** (Derek remains disabled per D-002).

## Stack

| Concern | Choice | Status |
|---|---|---|
| Framework | Next.js 16.4.0 App Router, Node server mode | Implemented |
| Hosting | Hostinger Node.js Web App. Owner's intended plan: **Unlimited** (not bought) | **Node.js support and DB version unconfirmed (D-001, R-005, R-021)** |
| Database | Hostinger MySQL / MariaDB, accessed with `mysql2` and plain SQL migrations (no ORM, D-011). **Supabase is not the application database** (D-039): the connected Supabase account has no projects, and nothing in the code talks to PostgreSQL | Migrations `0001` & `0002` implemented and tested on MySQL 8.4.9; **not connected to production** |
| Validation | `zod` schemas (`lib/data/validation.ts`) + column whitelist (`lib/admin/forms.ts`) | Implemented across all admin write paths |
| Auth | Better Auth 1.7.8 (`lib/auth.ts`, `lib/auth-options.mjs`) — staff: email/password only, CLI-only provisioning (`scripts/admin-user.mjs`); students: email/password or Google OAuth (D-040); public email sign-up disabled, DB-backed rate limiting | Implemented and integration-tested; fails closed without config |
| Authorisation | Server-side RBAC (`lib/admin/access.ts`, `lib/admin/roles.ts`) — `editor` < `reviewer` < `owner` | Enforced on every page, route handler and server action |
| AI (Derek) | Provider-independent interface (`lib/derek`); offline mock (default) and a Gemini API adapter for `gemini-3.5-flash-lite` (drafts, and automatic replies once cleared, D-041) | **Off by default.** Gemini needs explicit configuration, runs only for students with a recorded 18+ confirmation (none yet), and has not made a live request (D-035, R-027). |
| Support | Persistent chat (`/support`, `/api/student/*`) + Live Inbox (`/admin/inbox`) with human replies and reviewed Derek drafts | Implemented and DB-tested; **closed to students** until R-026 is cleared |
| 3D | three.js + `@react-three/fiber` 9.8.1 | Implemented; shared between homepage and destination pages |

## Code layout

```
app/
  page.tsx                                    homepage
  destinations/page.tsx                       index of 11 destinations, grouped by region
  destinations/[slug]/page.tsx                dynamic per request (CSP nonce), dynamicParams = false
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
    admin/notifications/route.ts              unread counts for the nav badges (data.read; counts only)
    student/conversations/…                   student chat API: list/create, messages (GET page, POST), read marker
    student/notifications/route.ts            the student's own notifications
  support/page.tsx                            student chat (fails closed unless STUDENT_ACCOUNTS_ENABLED=true)
  admin/support-actions.ts                    inbox / Derek review / notifications / team / erasure server actions
  admin/(dashboard)/inbox, students, team, notifications   Stage 7 admin areas
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
  identity/policy.ts                          administrator / team member / student policies, OAuth provider status
  student/access.ts, student/http.ts          student session resolution, same-origin + JSON checks, safe errors
  support/                                    state machine, validation, conversations, notifications, settings, attribution
  derek/                                      provider interface, runtime (timeout/retry), config gate, safeguards,
                                              evidence (public_* views only), drafts worker + review, mock & Gemini API adapter
  admin/team.ts                               Our Team: list, revoke, editor support delegation (owner only)
db/migrations/
  0001_university_directory.sql               core directory tables, CHECK constraints, public_* views
  0002_admin_auth.sql                         Better Auth tables, admin_members, fx_providers, public_fx_rates,
                                              hash-chained data_change_log, audit_chain_head, immutability triggers
scripts/
  migrate.mjs                                 ordered, SHA-256 checksummed, probed and locked migration runner
  db-capabilities.mjs                         engine classification, DDL capability probe, grant redaction
  db-preflight.mjs                            read-only staging compatibility report (`pnpm db:preflight`)
  admin-user.mjs                              CLI-only admin provisioning (create, grant, revoke, set-password, list, verify-audit)
  dev-sandbox.mjs                             local-only disposable MySQL + synthetic accounts for trying the chat
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

## Student support, Live Inbox and Derek (Stage 7)

### Identity
| Account | Provisioning | Gate |
|---|---|---|
| Administrator (owner) | `pnpm admin:user create --role owner` only | active `admin_members` row, no student profile |
| Team member (editor/reviewer) | CLI only; owner may revoke or delegate support to an editor in `/admin/team` | same |
| Student | Email sign-up disabled. Google sign-in may create an account only with `STUDENT_SELF_SIGNUP_ENABLED=true` (off; blocked by R-026) | `STUDENT_ACCOUNTS_ENABLED=true` + active `student_profiles` row + no admin membership |

**Google sign-in (students only, D-040).** Wired into Better Auth only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set (server-side env). Callback: `<BETTER_AUTH_URL>/api/auth/callback/google`; locally `http://localhost:3000/api/auth/callback/google`. The production callback is registered only once the real domain exists.
- Security: Better Auth's server-side code exchange with PKCE and server-stored state; browser-sent ID tokens are disabled; Google must report the email verified; account linking is off, so Google can never enter an existing password account ("account_not_linked").
- No implicit sign-up: the button asks for it, and only while `STUDENT_SELF_SIGNUP_ENABLED` (with `STUDENT_ACCOUNTS_ENABLED`) is on. A new account has no student profile, and reaches nothing, until the person confirms 18+ and accepts the privacy text (`lib/student/onboarding.ts`, `POST /api/student/profile`). "I'm under 18" deletes the unfinished sign-in.
- Staff separation: `admin-user grant` refuses accounts without a password or with a Google login; `lib/admin/access.ts` refuses any staff session for an account that has a non-password login, even if a role row exists. Google never grants a role.
- Errors: cancellation, expired/tampered state, closed sign-up, unverified email, linked-account refusal and an unavailable database each land on `/support?error=…` with a readable message (`lib/identity/oauth-errors.ts`). Microsoft and Yahoo are *not configured*; Apple is *deferred* (cost).

### Student routes
- **Homepage:** a "Chat Now" section above How It Works (`components/home/chat-cta.tsx`, kept at `#derek`); no sign-in form and no chat on the homepage. The header's "Chat" link goes the same way.
- **`/auth`:** two tabs, Sign in (email/password or Google) and Create account (Google, only while `STUDENT_SELF_SIGNUP_ENABLED` is on; otherwise a plain "not open yet" message). A signed-in student is sent straight to `next`, which `lib/student/next-path.ts` only allows to be `/chat` or `/chat?c=<id>` (no open redirects). No self-service password reset (email flows are disabled). Team members use `/admin`, which is unchanged.
- **`/chat`:** the authenticated chat (conversation list, history, the destination/course step, retry, Enter to send) plus the team presence indicator. Signed out → `/auth?next=/chat…`; a team account sees a "use the admin panel" card; a new Google account first sees the 18+/privacy step.
- **`/support`:** now only redirects (`?c=` → `/chat?c=`, `?error=` → `/auth?error=`), so old links and notifications keep working. OAuth errors land on `/auth`.

### Team presence and the human-to-Derek handoff (`0006_staff_presence.sql`, `lib/support/presence.ts`)
- **Presence.** The admin panel posts a heartbeat every 30 s (also from a background tab, and at once on wake or reconnect) to `POST /api/admin/presence`, accepted only from a signed-in team member with `support.reply`. `staff_presence` keeps one `last_seen_at` per person, written at most every 20 s. Online = seen within the 2-minute lease; reconnecting = lease expired less than a minute ago; offline = 3 minutes or more. Revoked members and editors without support access never count. Students read `GET /api/student/presence` (state, a first name, and whether Derek can really answer) and cannot write anything.
- **While the team is online (or reconnecting)** Derek still drafts, but every automatic reply is held with the reason "the LockIn team is online, so a person will answer". This check runs last, inside the conversation lock at send time.
- **Handoff.** When the student's chat checks in and the team is offline, `handOffToDerek` locks the conversation and sends a held draft only if all of these hold:
  - it was held for that reason alone, and is low-risk and unedited;
  - nothing newer than small talk has been said since, and no other question is waiting for a person;
  - nobody has taken the conversation over;
  - every Auto Mode gate still passes (provider cleared, kill switch, caps).

  It needs no background job, is idempotent (draft status plus a UNIQUE `messages.draft_id`), and a human reply in the same instant wins.
- **Notice.** Derek's first automatic answer after a person (or nobody) last replied starts with a notice: "<Name> has disconnected, so Derek is taking over for now…", or "The LockIn team is offline right now…". The answer is labelled "Replied by Derek · AI assistant · automatic reply…". When Dev is back, the status turns green and every new question waits for a person again; "Take over from Derek" stops Derek immediately. With no cleared provider (production today), nothing is handed over and the student is told the team will follow up.

### Schema (`0003_support_chat.sql`)
`student_profiles`, `support_settings` (owner singleton: automatic-reply kill switch, ON by default since `0005_auto_reply_default.sql`; the online/offline mode no longer gates anything), `conversations` (status, last student message, staff/student read markers, idempotency key), `messages` (author_kind student/staff/derek; CHECK ties Derek to a draft and humans to a user id; UNIQUE idempotency key and UNIQUE draft_id), `conversation_events` (state history), `ai_drafts` (one per student message; status, risk, usage, error code), `ai_draft_revisions`, `draft_reviews`, `notifications`, `notification_reads`; `admin_members.support_enabled`; new audit entity types/actions. Messages, events, revisions and reviews have `SIGNAL` triggers against UPDATE/DELETE; erasing a conversation removes them through FK cascades (which do not fire triggers).

### Conversation state machine (`lib/support/state.ts`)
`open` → (Derek draft or flag) `awaiting_human_review` → (human or approved reply) `awaiting_student_reply` → (student writes) `open`; staff may set `open`, `awaiting_human_review`, `resolved`, `failed`; a provider failure sets `failed` (needs intervention). Students see only "Waiting for the LockIn team", "The team has replied" or "Resolved".

### Concurrency and duplicates
Every write locks the conversation row `FOR UPDATE` (lock order conversation → draft). Student and staff sends carry a client idempotency key (UNIQUE). Derek claims a question by inserting its draft (UNIQUE `trigger_message_id`), calls the provider with no lock held, then re-locks and gives up if a human answered meanwhile; a human reply marks open drafts `superseded`. `messages.draft_id` is UNIQUE, so a draft is delivered at most once.

**Unanswered questions are never dropped by small talk (regression fixed).** Previously a "thanks" or "hi" sent before Derek answered superseded the pending draft and its fixed reply marked the conversation answered, so the question vanished from the queue. Now: a greeting or thanks never supersedes a pending draft (`sendStudentMessage`); small talk with an earlier unanswered message gets no reply of its own (`deferred`); a newer *real* question is answered together with every unanswered one; and no automatic reply is sent while the conversation is awaiting human review or failed. The student acknowledgement follows the real pending question. Covered by `tests/db/support.db.test.ts` → "small talk never drops an unanswered question".

### Derek workflow
1. Disabled unless `DEREK_AI_ENABLED=true`. `DEREK_PROVIDER` defaults to `mock` (refused in production; its replies are labelled "test reply from the offline mock, not a real AI answer" and prove nothing about a real provider). `gemini` needs `GEMINI_API_KEY` (server-side only), accepts only `gemini-3.5-flash-lite`, and in production also `GEMINI_PAID_TIER=true` **and** `DEREK_PROVIDER_APPROVED=gemini`, which records that Gemini's own terms ("not for consumer use", under-18 rule) were reviewed and permit this student-facing service. Without it Gemini drafts nothing for real students. Neither `DEREK_AUTO_REPLY_CLEARED` nor a student's 18+ checkbox counts as that approval (`lib/derek/config.ts`). Model IDs (checked 25 Oct 2026 on ai.google.dev): `gemini-3.5-flash` is a deprecated ID that Google routes automatically to `gemini-3.6-flash`; it is refused here with that explanation. Moving to `gemini-3.6-flash` needs a decision, output-token/thinking tuning and a supervised smoke test.
2. Evidence: matched universities from `public_*` views only, fees for past academic years dropped (`lib/derek/evidence.ts`).
3. Contact details are redacted before the provider sees the question. Provider calls: 20 s timeout per attempt, 2 attempts, retry only on retryable errors, errors reduced to a code (`lib/derek/runtime.ts`).
4. Safeguards (`lib/derek/safeguards.ts`): visa/immigration, distress, legal and payment questions → `high`; admission-probability, guarantees, or a factual topic without evidence → `uncertain`; any figure not present in the evidence, guarantees, outcome predictions or INR conversions in the draft → `high`.
5. Review: edit (new revision), approve exact revision + SHA-256, send; or reject with a reason; or write a human reply. Automatic replies (Auto Mode): only `low` risk, only when the owner's kill switch is on (default since 0005; untick it in `/admin/settings` to stop every automatic reply at once) + `DEREK_AUTO_REPLY_CLEARED=<that provider id>` + an adapter that declares `autoReply.permitted` (Gemini never does) + a ready provider, all re-checked at send time inside the conversation lock. LockIn's own fixed replies (greeting, thanks, scope refusal) need only Derek enabled and the switch. Nothing is sent while the conversation is awaiting human review or failed. `lib/derek/auto-reply.ts` then holds the reply for a person, with the reason recorded, if the conversation was resolved, the student is not active, the reply is over 900 characters, contains a link that is not from verified evidence, reads like a refusal, or the per-student (10/day) or global (60/hour, 300/day) automatic-reply caps are reached. New drafts also stop at the daily token budget (`DEREK_DAILY_TOKEN_LIMIT`).
   Scope guard (`lib/derek/scope.ts`), before any provider call: clearly unrelated requests (coding, games, entertainment, politics…) and attempts to change Derek’s role get LockIn’s fixed refusal; greetings in English, Hinglish and Hindi get a short greeting; thanks gets a short acknowledgement; a greeting in front of a question is removed and the question answered. These fixed texts are recorded as provider `derek-rules` and send no data anywhere. Hindi, Hinglish, unclear, injection and high-risk (visa, legal, distress, payment, safety, in English, Hindi and Hinglish) messages are drafted for a person and never sent automatically. Style findings (`lib/derek/style.ts`, based on Wikipedia’s “Signs of AI writing” advice page) are shown to reviewers and also hold automatic replies.
   Human takeover (`0004_derek_handoff.sql`): a team member with `support.reply` can take a conversation over from Derek, which discards a draft still being written and pauses new drafts and automatic sending for it; only `support.review_ai` can return it. Held automatic replies keep their reason on the draft (`ai_drafts.hold_reason`) and appear in the Live Inbox views Held, Escalated and Taken over. Students see “Derek is writing a reply…” while an automatic answer is possible, “Derek couldn’t generate an answer this time, so a member of the LockIn team will follow up.” after a provider failure, and otherwise “Your question has been received. A member of the LockIn team will follow up.” Team notifications are in-site only, so held questions wait until someone signs in.
6. Usage metadata (model, tokens, latency, attempts, error code) is stored per draft. For Gemini, output tokens include thinking tokens (both are billed).
8. Answer quality (`lib/derek/guidance.ts`, `lib/derek/style.ts`): each question is classified as `general` (concepts, processes), `broad_destination` ("Tell me about UK universities": what to compare, no figures) or `specific_fact` (fees, rankings, deadlines, requirements, scholarships, acceptance rates). The provider receives a per-question task note, and at most one follow-up question when goals are unclear (study level, subject, or which university and course for a missing fact). Rules: simple English for Indian students, usually 80 to 150 words, no greetings or filler, plain text, general guidance never contains figures, sourced facts only on a `From the LockIn directory:` line. Broad destination questions receive that destination's published listings (name, city, official website) as evidence. Drafts are tidied (greetings, sign-offs, markdown removed) before checks. Extra safeguards: invented dates, any number beside a visa or work-rights rule, and claims of LockIn verification without evidence are all high-risk.
7. Gemini adapter (`lib/derek/providers/gemini.ts`): REST `models.generateContent`, key only in the `x-goog-api-key` header, rules + verified evidence as the system instruction, `maxOutputTokens` 512, temperature 0.2, thought parts discarded, `[UNCERTAIN]` marker and any non-`STOP` finish → uncertain, safety/recitation/PII finishes → `safety_blocked`, HTTP 429/5xx retried once, 400/401/403/404 not retried. Before any call the worker checks the provider policy: the student must have `age_confirmed_at` (else `ineligible`), and the rolling 24 h draft count must be under `DEREK_GEMINI_DAILY_DRAFT_LIMIT` (else `quota`); either way the question stays in the Live Inbox. Automatic replies are never permitted with Gemini.

### Security notes
Student POSTs require same-origin `Origin` and `application/json`; bodies are capped at 16 KB and messages at 4,000 characters (invisible/bidi control characters stripped); text is rendered as text. Rate limits: 20 student messages per 10 minutes, 10 new conversations per day, 20 unresolved conversations. Staff server actions re-authorise before reading input. Errors never echo SQL or provider messages. Owner-only erasure deletes the account, sessions, conversations, drafts and notifications, keeping a scrubbed tombstone and a content-free audit entry. Limits of the audit chain: R-028.

## Destination pages & globe behaviour

- `/destinations/[slug]` serves the 11 slugs (`dynamicParams = false`) and renders per request, because the root layout awaits `connection()` so Next can apply the CSP nonce. Unknown slugs (including `dubai`) return the branded 404.

## Security headers & CSP

- Static headers live in `next.config.mjs`: `nosniff`, `Referrer-Policy`, HSTS, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- The `Content-Security-Policy` is built by `lib/security/csp.ts` and set per request in `proxy.ts`. It is enforcing by default (`CSP_MODE=report-only` is a diagnostic switch only). Policy: `default-src 'self'`, `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'`, `style-src-attr 'unsafe-inline'`, `img-src 'self' data: blob:`, `connect-src 'self'`, `worker-src 'self' blob:`, `object-src 'none'`, `frame-src 'none'`, `frame-ancestors 'self'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests`. Development adds `'unsafe-eval'` and `ws:`/`wss:` for HMR.
- The proxy skips `/api`, `/_next/static`, `/textures`, `/images` and static files. Those responses carry no HTML, so they need no CSP.
- Without `DATABASE_URL`, the directory shows "pending verification". On a DB failure it shows "temporarily unavailable". It never shows sample data.
- Globe: server-rendered static poster, WebGL check and lazy R3F chunk, reduced-motion static mode, context-loss recovery, off-screen pause, IST lighting (`?ist=HH:MM`).

## Deployment shape (pending plan confirmation)

GitHub → Hostinger Node.js web app (Node 22.x/24.x) → server process restarted from hPanel. `pnpm build` runs `next build` and then `scripts/prepare-standalone.mjs`, which copies `public/` and `.next/static/` into `.next/standalone/`. Start with `pnpm start:standalone` (`node .next/standalone/server.js`, honours `PORT`/`HOSTNAME`) or `npm start` (`next start`; Next warns about standalone but serves correctly). Both verified locally on Windows only; which one Hostinger runs is unconfirmed (R-030). Secrets live only in Hostinger environment variables. Changing them requires a restart, or a redeploy for build-time values.

Database operations run from a trusted machine over Remote MySQL (R-018), never from a web route:
0. **Back up first** (DDL auto-commits, so a failed migration cannot roll itself back): take an hPanel database backup, and keep a local dump, e.g. `mysqldump --single-transaction --routines --triggers --no-tablespaces -h <host> -u <user> -p <db> > lockin-<date>.sql` (the password is prompted, never on the command line). Confirm the file is non-empty before continuing.
1. `pnpm db:preflight --probe` prints version, `sql_mode`, time zone, binlog/trigger settings and redacted grants. It creates and drops a throwaway `_lockin_probe_*` table, view and trigger.
2. `pnpm db:migrate` (`scripts/migrate.mjs`) takes `GET_LOCK('lockin_schema_migrate')`, re-runs the probe and applies nothing if a feature is refused. A migration that fails partway is **not** recorded and the error says to restore the backup.
3. `lib/admin/access.ts` checks that every name in `lib/db/schema-version.ts` is recorded in `schema_migrations`. Otherwise every admin page, API route and server action fails closed (`/admin/unavailable`, `503`). The public site reads only `public_*` views, so a half-applied schema can never expose unpublished data.

Tested engines: MySQL 8.4.9 and MariaDB 10.5.29 (`scripts/db-capabilities.mjs → TESTED_ENGINES`).

**Release order for 0012** (`0012_dump_safe_triggers.sql`): schema only, no data touched, and the previous code is unaffected, so apply it with 0010 and 0011 before deploying. It recreates the 14 append-only triggers in a `BEGIN … END` form because a single-statement trigger kept its final semicolon in the stored definition and `mysqldump` then wrote SQL that the server refuses on restore. Each trigger is absent for an instant between its DROP and CREATE, so run it at a quiet time. Full report: `docs/PRODUCTION-READINESS.md`.

**Release order for 0011** (`0011_age_attestation_name.sql`, D-046): additive (one nullable column the previous code never reads), so migrate first with 0010, then deploy. Tested on MySQL 8.4; not yet run on MariaDB 10.5 (R-032).

**Release order for 0010** (`0010_age_attestations.sql`, D-045): additive (one new table the previous code never reads), so **migrate first, then deploy the code**: back up → `db:preflight --probe` → `db:migrate` → deploy → `db:preflight`. The new code refuses `/admin` and student features until 0010 is recorded. Nothing changes for students until sign-up is opened (`STUDENT_SELF_SIGNUP_ENABLED`, Google credentials and, in production, `STUDENT_PRIVACY_NOTICE_URL`). Tested on MySQL 8.4 (DB suite); not yet run on MariaDB 10.5 (R-032). Rollback: `DROP TABLE student_age_attestations`, together with the previous code.

**Release order for 0009** (`0009_candidate_listings.sql`, D-044): **deploy the code first, then migrate**, close together. It adds `listing_hidden` and `institution_category` to `universities` and redefines `public_provisional_universities` and `public_directory_listings`: every candidate in review is listed, those without a current website check by name only. Why this order: the new code against the old views shows only website-checked entries, by name only, and keeps `/admin` and student features closed until 0009 is recorded (fails closed); the old code against the new views would render a name-only entry with an empty website link. Sequence: back up the database → `db:preflight --probe` → deploy the code → `db:migrate` (also applies 0007/0008 if that environment does not have them yet; until 0008 exists the directory shows its error state, never unverified data) → `db:preflight` and confirm no pending migrations → open one destination page: name-only entries show "Identity/source check pending" and no link, and `/admin` opens. MySQL DDL is not transactional: if 0009 stops after dropping the views, the directory shows its error state and `schema_migrations` does not record 0009; restore the backup (or re-create the views from the file) before retrying. Rollback: re-create the two views from 0008, then drop the two columns, together with the previous code. Tested on MySQL 8.4 (DB suite); not yet run on MariaDB 10.5 (R-032).

**Release order for 0008** (`0008_provisional_listings.sql`, D-043): the same steps as below. It adds four columns to `universities` (nothing is listed until a website check sets `provisional_listing`), one audit action and two views; the previous code ignores all of them, so it is safe to apply before deploying. After deploying, provisional entries appear only for records imported with `--check-websites` or listed by a reviewer in `/admin`.

**Release order for 0007** (`0007_ranking_licence_uses.sql`, D-042): the same steps as below. It only adds three columns to `ranking_providers` (both permissions default to off) and re-creates `public_university_rankings` with the same rows, so it is safe to apply before deploying the code. After deploying, the owner records the QS licence in `/admin/settings`.

**Release order for 0004–0006:** back up → `db:preflight --probe` → `db:migrate` (applies `0004_derek_handoff.sql`, `0005_auto_reply_default.sql`, `0006_staff_presence.sql` in order) → `db:preflight` again and confirm no pending migrations → deploy the code → set or confirm environment variables in hPanel and restart → open `/admin` (must not show "unavailable") and `/admin/settings` (automatic replies and provider state as expected). All three are additive, and the previous code runs unchanged on the new schema, so migrating before deploying is safe. Rollback: restore the backup together with the previous code. Do not drop single tables while newer code is running.
