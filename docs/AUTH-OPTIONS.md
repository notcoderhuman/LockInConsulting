# Student authentication: Supabase Auth or the existing Better Auth

Decision (5 Nov 2026): **keep Better Auth 1.7.8 on Hostinger with MariaDB.** No second identity database.

| | Better Auth 1.7.8 (current) | Supabase Auth |
|---|---|---|
| Where identities live | The site's own MariaDB (`auth_user`, `auth_account`, `auth_session`), next to `student_profiles`, `admin_members` and the append-only audit triggers | A separate Supabase Postgres project. Student data (profiles, conversations, erasure) stays in MariaDB, so every request would join two databases and erasure would have to delete in both |
| Extra processor of student personal data | None | Supabase becomes a processor (DPDP Act s.8(2) contract needed); data region must be chosen (an India region exists) |
| Cost | Nothing beyond current hosting | Free plan: 50,000 MAU, but projects pause when idle; Pro USD 25/month with 100,000 MAU (third-party summaries, checked 5 Nov 2026; confirm on supabase.com/pricing) |
| Email codes | `emailOTP` plugin, wired with our own per-email limits (`lib/auth-otp.ts`) | Built in, with Supabase's own limits; custom SMTP needed for real volume either way |
| Google / Microsoft / Apple | Built in | Built in |
| Yahoo | Generic OpenID Connect plugin | Not built in; would need a custom OIDC provider |
| Controls we already rely on | 18+ attestation consumed inside account creation (D-045), staff/student separation, staff never via OAuth or codes, device-cookie password throttle, no trusted IP header (R-033) | Each would have to be rebuilt with Supabase hooks or edge functions, and staff auth would stay on Better Auth anyway (two systems) |
| Migration work | None | Rewrite sign-in, session checks and every student route; move or dual-run existing accounts |
| Lock-in | Open-source library, data in our schema | Open-source, but hosted; self-hosting adds another server |

**Why Better Auth stays:** it already holds staff and student identities in the same database as the data they protect, the
safety rules (18+, staff separation, erasure) are enforced in one transaction-capable place, and every feature this
workstream needs (email codes, Microsoft personal and work accounts, Apple, Yahoo through OIDC, verified-only linking,
session revocation) is available in the installed version. Supabase Auth would add a processor, a second database and a
migration without removing any of the remaining blockers (mail credentials, provider apps, legal review).

Revisit only if the site moves off MariaDB to Postgres, or needs features Better Auth lacks (none identified).
