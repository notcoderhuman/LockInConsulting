# Privacy and legal drafts (Workstream E)

Status (5 Nov 2026): **drafts pending legal review.** Nothing here is legal advice, and no page claims compliance.
`STUDENT_PRIVACY_NOTICE_URL` stays **unset** in production until a lawyer has reviewed `/privacy` and the Owner has
filled every placeholder. Only then set it to `/privacy` (production sign-up remains closed without it; R-026, P-1).

| Page | File | Version shown |
|---|---|---|
| Student privacy notice, including retention and deletion | `app/privacy/page.tsx` | `PRIVACY_NOTICE_VERSION` (`student-2026-11-draft`) |
| Terms of use | `app/terms/page.tsx` | `terms-2026-11-draft` |
| AI disclosure (Derek) | `app/ai/page.tsx` | `ai-2026-11-draft` |

Each page renders a "Draft pending legal review" banner (`components/legal/legal-page.tsx`), is `noindex`, and shows every
missing fact as a highlighted "[To be completed by the Owner: …]". `tests/legal-pages.test.ts` fails if a page claims
compliance or contains an invented registration number, phone number or named grievance officer.

## Official sources read

Read 5 Nov 2026 in the browser from the official PDFs:

- **DPDP Act, 2023** (No. 22 of 2023), Gazette of India, 11 Aug 2023: `https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf`
- **DPDP Rules, 2025**, G.S.R. 846(E), Gazette dated 13 Nov 2025: `https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf`
- PIB release "Government notifies DPDP Rules to empower citizens and protect privacy", 14 Nov 2025 (Release ID 2190014).

Not read: the **Consumer Protection (E-Commerce) Rules, 2020**. consumeraffairs.nic.in was unreachable from this environment. See "E-commerce" below.

### Commencement (Rules r.1)

Rules 1, 2 and 17–21 applied on publication. Rule 4 (Consent Managers) applies one year later. **Rules 3, 5–16, 22 and 23
apply 18 months after publication (around 13 May 2027).** The drafts follow the Rules now, so nothing has to change later.

### Where each requirement is handled

| Requirement | Source | In the drafts and code |
|---|---|---|
| Notice before or with the consent request; itemised data; purpose; how to withdraw, exercise rights, complain to the Board | Act s.5(1); Rules r.3 | `/privacy` sections "What we collect and why", "Consent…", "Your rights"; linked from the 18+ page and the privacy step |
| Consent free, specific, informed, unambiguous, with a clear affirmative action | Act s.6(1) | Unticked checkbox at the privacy step (`components/support/student-onboarding.tsx`), worded with the data, purpose and AI use |
| Consent request in English or an Eighth Schedule language, with a contact | Act s.6(3) | English only; Hindi version and contact left as placeholders |
| Withdrawal as easy as giving consent | Act s.6(4)–(6); r.3(c)(i) | "Delete your account" on `/chat`: two steps (type DELETE, press the button), much like the one-tick consent |
| Erase on withdrawal or when the purpose ends, and make processors erase too | Act s.8(7) | Self-service and Owner erasure (below). Processor erasure is not automated: placeholder for processor contracts |
| Security safeguards; logs kept 1 year | Rules r.6(1)(e) | Existing controls are described. **Open:** the 1-year log rule against immediate erasure (below) |
| Breach notice to each affected person and to the Board (72 h detailed report) | Act s.8(6); Rules r.7 | Promise in `/privacy`. **Open:** an internal breach runbook (not written) |
| Contact who answers data questions, published prominently and in every rights reply | Act s.8(9); Rules r.9 | Placeholder in `/privacy` and `/terms` |
| Grievance redressal, reply within 90 days | Act s.8(10), s.13; Rules r.14(3) | `/privacy#rights`; the contact is a placeholder |
| How to make rights requests, and which identifier | Rules r.14(1) | `/privacy#rights`: email from the account address |
| Children (under 18): verifiable parental consent, no tracking | Act s.2(f), s.9; Rules r.10 | Not offered: 18+ self-attestation (D-045); under-18s are discarded at the privacy step |
| Data Principal duties | Act s.15 | `/privacy#rights`, `/terms` |
| Inactivity erasure with 48-hour warning | Rules r.8(1)–(2), Third Schedule | **Not applicable**: covers only e-commerce or social media with at least 2 crore users and online gaming with at least 50 lakh |

## Consent capture

When a student accepts the privacy step, the profile records `privacy_notice_version` (the version shown on `/privacy`) and
`age_confirmed_at`, and `created_at` gives the time. `/age-confirm` keeps the 18+ confirmation time and policy version.
Change `PRIVACY_NOTICE_VERSION` whenever `/privacy` changes in substance. Existing students must be asked again when the law
requires it. **Open:** a re-consent prompt for students on an older version is not built.

## Account deletion workflow

- **Student:** `/chat` → "Delete your account" → type `DELETE` → `POST /api/student/account`. The route uses the session's student
  only (`requireStudentApi`, same-origin plus JSON) and calls `eraseOwnAccount` in `lib/support/conversations.ts`.
- **Owner:** `/admin/students/<id>` → "Erase student data" (type `ERASE`, with a reason), as before.
- Both use one transaction (`eraseProfile`). It deletes conversations (messages, Derek drafts and events cascade), the person's
  notifications and read marks, and the auth user (sessions and sign-in methods cascade). It leaves a tombstone (`Erased student`,
  no user link). The 18+ record loses its user link (`ON DELETE SET NULL`). It appends one `student_erase` entry to the hash-chained
  change log, with counts only: actor role `student` or the Owner's role.
- Tested in `tests/db/support.db.test.ts` ("lets a student delete their own account…").

## Retention schedule (draft; the Owner decides the gaps)

| Data | Now | Decision needed |
|---|---|---|
| Account, profile, conversations | Until deleted by the student or the Owner | Whether inactive accounts are deleted, and after how long |
| Unfinished sign-up (no profile) | Deleted on "cancel" or "under 18" | Automatic period for abandoned ones (cron, readiness S-5) |
| 18+ confirmation with typed name | Unused: 15 min, purged on the next confirmation; name cleared when the profile is created | none |
| Email codes / attempt counters | 10 min / about 1 h idle | none |
| Sessions | 8 h | none |
| Change log (no content; pseudonymous IDs) | Kept: append-only, hash-chained | A retention period, consistent with r.8(3) |
| Database backups | `prod-backup.mjs` copies, kept off-site by the Owner | How long; deleted data persists in backups until they expire |
| Hostinger server logs | Hostinger's own | Confirm what is logged and for how long |

**Open (legal review): DPDP Rules r.8(3) and r.6(1)(e)**, applying from about May 2027, require personal data, traffic data and
processing logs to be kept for **at least one year from processing**, "even if X deletes her account" (the official
illustration). Today's erasure is immediate and complete. Before May 2027 a lawyer should decide what must be kept, how
(for example a restricted, encrypted archive purged after one year), and how `/privacy` describes it.

## E-commerce

LockIn does not sell goods or services online today: the chat is free and there is no payment flow. The Consumer Protection
(E-Commerce) Rules, 2020 apply to goods and services bought or sold over a digital network. They become relevant if paid
consulting is ever sold through the site; their obligations include seller details and a grievance officer. The rule text was
**not verified** from the official site in this pass. Recheck before any paid service goes online.

## Placeholders the Owner must fill (none were invented)

1. Registered legal name and form of the business, and its address.
2. The person who answers data questions (r.9): name or role, email and phone; the privacy-request email address.
3. Email delivery provider (`docs/EMAIL-DELIVERY.md`), processor locations and contracts (s.8(2)), and Hostinger's log retention.
4. Retention decisions in the table above.
5. Link to the Data Protection Board's complaint portal.
6. A Hindi version (s.6(3)), after review.
7. Terms: paid services and refunds, limitation of liability, courts with jurisdiction.
8. AI page: confirm Google's current paid-tier Gemini terms, data location and abuse-monitoring retention.

## Before going live

Legal review → Owner fills placeholders → remove the draft banner and `noindex`, bump the versions → set
`STUDENT_PRIVACY_NOTICE_URL=/privacy` in the hosting panel → new build. None of this is done.
