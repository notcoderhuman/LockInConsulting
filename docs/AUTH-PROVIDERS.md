# Student sign-in providers: setup for the Owner

Code: `lib/auth.ts` (providers, linking, staff guards), `lib/identity/policy.ts` (switches), `lib/auth-otp.ts` (email codes).
Every provider is **off** until both of its variables are set **and** `STUDENT_ACCOUNTS_ENABLED=true`. New accounts also
need `STUDENT_SELF_SIGNUP_ENABLED=true` and `STUDENT_PRIVACY_NOTICE_URL`, and every new account passes `/age-confirm`
(18+). None of these switches is set in production. Secrets go only into the hosting panel's environment variables,
never into the repository; a build is needed after changing them.

Callback (redirect) URL for every provider, exactly:

```
https://lockinconsulting.com/api/auth/callback/<provider>
```

with `<provider>` = `google`, `microsoft`, `apple` or `yahoo`. For local testing add `http://localhost:3000/api/auth/callback/<provider>`
where the provider allows http on localhost (Apple does not).

What every provider gets: identity scopes only (`openid`, `email`, `profile`, or Apple's `name`, `email`), no offline
access, server-side code exchange with state and PKCE. The provider must say the email is **verified**, or no account is
created and nothing is linked.

## Account linking (all providers)

A student can add another provider from **Your account** (`/account`), or by signing in with a provider whose email matches
their account. It links only when the provider reports the email as verified **and** the existing account's email is
verified, never to a different email, and no provider is trusted by name (Better Auth `accountLinking` with
`trustedProviders: []`, `requireLocalEmailVerified: true`). Team accounts never gain a provider or an email code
(`databaseHooks.account` and `session` in `lib/auth.ts`, tested in `tests/db/email-otp.db.test.ts`).

## Google (exists)

Steps in `docs/ENVIRONMENT.md`, "Google sign-in setup". Variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## Microsoft (personal and work or school accounts)

1. Microsoft Entra admin center (entra.microsoft.com) with any Microsoft account → **App registrations → New registration**.
2. Name "LockIn Consulting". Supported account types: **Accounts in any organizational directory and personal Microsoft
   accounts**. Redirect URI: platform **Web**, `https://lockinconsulting.com/api/auth/callback/microsoft`.
3. **Certificates & secrets → New client secret.** Copy the *Value* (shown once) into `MICROSOFT_CLIENT_SECRET`; note its expiry
   (at most 24 months) in the Owner's calendar. **Overview → Application (client) ID** goes into `MICROSOFT_CLIENT_ID`.
4. **API permissions:** keep only Microsoft Graph delegated `openid`, `email`, `profile` (remove `User.Read` if present; the
   app does not read the profile photo).
5. **Token configuration → Add optional claim → ID:** `email`, `verified_primary_email`, `verified_secondary_email`. Better
   Auth treats a Microsoft email as verified only from `email_verified` or these claims. Without them every Microsoft sign-up
   is refused (safe, but unusable).
6. **Branding & properties:** home page, privacy URL (`/privacy`), terms URL (`/terms`). Work accounts in many organisations can
   consent only to apps from a **verified publisher** (free; needs a Microsoft AI Cloud Partner Program ID and a domain-matching
   publisher domain). Personal accounts do not need it.
7. Test on a local build first, with a personal and a work account. Known risk: personal Microsoft accounts may not carry a
   verified-email claim; if so they are refused with "email not verified" and only work or school accounts can use Microsoft.

Tenant: the code uses `common` (both kinds of account). The email claim of a work account is set by that organisation; that
is why verified-only linking matters (no "nOAuth"-style takeover through an unverified email claim).

## Apple (needs the paid Apple Developer Program: implemented, not enrolled)

Enrolment costs USD 99 a year (local price shown at enrolment) and needs the Owner's approval. Then:

1. developer.apple.com → **Certificates, Identifiers & Profiles → Identifiers → App IDs**: register one with **Sign in with Apple**.
2. **Identifiers → Services IDs**: create e.g. `com.lockinconsulting.web` (this is `APPLE_CLIENT_ID`). Enable Sign in with Apple →
   Configure: primary App ID from step 1, domain `lockinconsulting.com`, return URL
   `https://lockinconsulting.com/api/auth/callback/apple`.
3. **Keys**: create a key with Sign in with Apple, download the `.p8` (once), note the Key ID and the Team ID.
4. Generate the client secret: a JWT signed ES256 with the `.p8`, header `kid` = Key ID, claims `iss` = Team ID,
   `sub` = Services ID, `aud` = `https://appleid.apple.com`, `iat` = now, `exp` at most 6 months later. Put it in
   `APPLE_CLIENT_SECRET`. **It expires; regenerate before then** (calendar reminder). Keep the `.p8` offline, never in the repo.
5. **Sign in with Apple for Email Communication**: register the domain that sends LockIn's mail and its SPF, or emails to
   students who chose "Hide My Email" (`…@privaterelay.appleid.com`) will be dropped.
6. Apple returns to the callback with a cross-site form POST; `https://appleid.apple.com` is added to trusted origins
   automatically when Apple is configured. Apple sends the name only on the first sign-in.

## Yahoo

1. developer.yahoo.com → **My Apps → Create an App**.
2. Redirect URI `https://lockinconsulting.com/api/auth/callback/yahoo`. API permissions: **OpenID Connect Permissions → Email** and
   **Profile** only.
3. Copy the Client ID and Client Secret into `YAHOO_CLIENT_ID` and `YAHOO_CLIENT_SECRET`.
4. The app uses Yahoo's OpenID Connect discovery document (`https://api.login.yahoo.com/.well-known/openid-configuration`) through
   Better Auth's generic OAuth plugin, with PKCE.

## Email codes

`SMTP_*` and `MAIL_FROM` (see `docs/EMAIL-DELIVERY.md`). 6-digit code, 10 minutes, single use, 3 wrong tries per code, stored as
an HMAC keyed by `BETTER_AUTH_SECRET`; per email: one send a minute, 5 an hour, 10 guesses an hour; process-wide send budget;
staff emails never receive a code (same answer, nothing sent). Per-IP limits apply only with a verified
`AUTH_CLIENT_IP_HEADER`, which stays **unset** on Hostinger (R-033: the origin answers direct-to-IP requests that bypass the CDN).

## Go-live checklist (Owner)

- [ ] Legal review of `/privacy` and `/terms` done; `STUDENT_PRIVACY_NOTICE_URL=/privacy`.
- [ ] Mail credentials set and delivery, SPF, DKIM and DMARC tested (`docs/EMAIL-DELIVERY.md`).
- [ ] Each provider tested on a local build with real test accounts before its variables go to production.
- [ ] Backup taken; release deployed with a new build; switches turned on one at a time.
