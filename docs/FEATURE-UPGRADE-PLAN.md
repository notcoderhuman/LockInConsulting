# Website experience upgrade: audit and roadmap

Prepared 2 November 2026. Audit only: nothing here has been implemented. Phase A waits for the owner's approval.

## What the audit found

**Working tree.** Branch `dev`, 76 uncommitted changes (modified, deleted `package-lock.json`, untracked migrations 0009–0012, health route, age-confirm, boot-migrate and their tests). Nothing was changed, staged or reset.

**Live staging** (`<staging-host>`, read-only HTTP checks):

| Check | Result |
| --- | --- |
| `/api/health` | `{"status":"ok","database":"ok","migrations":"complete"}` |
| 11 destination pages | All 200, all show the empty "No verified … listings yet" state |
| `GET /api/destinations/US/universities` | `{"entries":[],"total":0}`: the database answers, the public views are empty |
| `/auth`, `/chat` | "Student accounts aren't open yet"; `POST /api/student/age-confirmation` → 503 |
| CSP, HSTS | Present |
| `/manifest.webmanifest`, `/sw.js` | 404 (no PWA) |

**University import status.** On **staging, 0 public entries** in every destination: the 431-candidate import has **not** been run there (consistent with `docs/STAGE-3-PLAN.md`, "Nothing here has been run on Hostinger"). The 431 exist only in the **local** database (`docs/PRODUCTION-READINESS.md`): 274 website-checked, 157 pending, **0 verified, 0 published, 0 courses, fees, rankings or acceptance rates**, QS `not_confirmed` with ordering off. The staging app database could not be queried directly (its credentials are not on this machine, by design), so this rests on the public views, which only show what is listable.

**Structural facts that shape every discovery feature**

1. **There are no university pages.** A university is a card inside `/destinations/[slug]` (`university-card.tsx`, `provisional-card.tsx`), loaded 5 at a time up to 50 (`DIRECTORY_PAGE_SIZE`, `DIRECTORY_MAX`). An anchor link to card 37 cannot work because card 37 is not in the page until the reader clicks "See more" seven times. Share, recently viewed, copy-info and bookmarks all need a stable, linkable university URL first.
2. **The data available to search, filter, sort and compare is identity-only today**: name, slug, official website (checked entries), city (when the website states it), identity status, category. No verified courses, fees, intakes or rankings exist anywhere, and QS ordering is not licensed. Filters on fees or rankings would have nothing to filter and must not be faked.
3. **No long-form content exists**: no guides, FAQs or articles. The public pages are home, `/destinations`, the 11 destination pages, `/auth`, `/chat`, `/age-confirm` and 404.
4. **No i18n**: `lang="en-IN"` hard-coded, no dictionaries, no `hreflang`.

## The 20 features against the codebase

Status: **Exists** · **Partial** · **Missing** · **Blocked** (needs a separate approval or data that does not exist).

| # | Feature | Status | Evidence / where it would go | Migration | Notes and risks |
| --- | --- | --- | --- | --- | --- |
| 1 | Back-to-top button | Missing | New client component in `SiteFooter` or layout | No | Must respect `prefers-reduced-motion`, be a real `<a href="#main">`/button with a label, 44px target |
| 2 | Reading progress | Missing; **no long pages** | Would only apply to guides | No | Skip until long content exists; on a destination page it measures nothing useful |
| 3 | Recently viewed universities | Missing | Needs the university route (P1); `localStorage` of slugs only | No | Device-only, no PII; clearable. Not synced to accounts (none open) |
| 4 | Save / bookmark universities | Missing | Account-backed version needs a `saved_universities` table + student session | **Yes (later)** | **Blocked** for accounts: students are disabled. Offer a device-only list now (slugs in `localStorage`, clearly labelled "saved on this device") or wait |
| 5 | Smart university search | Missing | New read-only `GET /api/universities/search` over `public_directory_listings` | No | Must read only `public_*` views; escape `%`/`_` in `LIKE`; length cap; no internal fields. Spans all 11 destinations and beyond the 50-card cap |
| 6 | Advanced filters | Missing | Same endpoint: destination, verified vs provisional, website-checked vs pending, city, institution type | No | Only fields that exist. Fee/ranking/intake filters appear only once verified data does |
| 7 | Sorting | Partial | Fixed order in `directory-queries.ts` (QS when licensed, then name) | No | Add name A–Z/Z–A, verified first. **No ranking sort** while QS `allow_ordering` is off (D-042) |
| 8 | Share university pages | Missing | Needs the university route; Web Share API + copy-link fallback | No | Permissions-Policy does not block `web-share`; no tracking params |
| 9 | Copy university information | Missing | Button on the university page | No | Copies only what is displayed, **with its label** ("Not yet verified"), source and check date; QS attribution text if a rank is ever copied |
| 10 | Comparison tables | Missing | Client-side, 2–3 universities, from the university route's data | No | Today every row except name/website/city would read "Not verified". **Recommend deferring until verified records are published** |
| 11 | Text-size controls | Missing | Root `font-size` scale (Tailwind is rem-based) | No | Setting in `localStorage`; pre-paint script needs the CSP nonce (`x-nonce` header, already set by `proxy.ts`) to avoid a flash |
| 12 | Searchable FAQs | Missing; **no FAQ content** | Would be a new `/faq` | No | Needs owner-approved copy; cannot be written by us without inventing policy |
| 13 | Reading-time estimates | Missing; no content | Guides only | No | Skip until guides exist |
| 14 | Table of contents | Missing; no long guides | Guides only | No | Skip until guides exist |
| 15 | Keyboard navigation and shortcuts | Partial | Skip link, Escape closes menu, focus moves to new cards (`university-list.tsx`) | No | Add `/` to focus search (ignored inside inputs, WCAG 2.1.4), visible focus audit. No single-letter shortcuts |
| 16 | English/Hindi switch | Missing | Dictionaries for UI chrome only, cookie-based, no new dependency | No | Legal, privacy and all university data stay English with a visible note. Needs **human-approved** Hindi strings; never machine-translated |
| 17 | Form autosave | Missing | Admin forms already save server-side drafts; student forms disabled | No | **Recommend not doing it**: admin entries are private research and must not sit in browser storage on a shared device. Offer an "unsaved changes" warning instead |
| 18 | Password visibility toggle | Missing | `components/admin/sign-in-form.tsx`, `components/support/student-sign-in.tsx` | No | Toggle input `type` only; never stored; `aria-pressed`, label changes |
| 19 | Clear validation / accessible errors | Partial | Admin `Field` has `aria-invalid` + `role="alert"` per field; sign-in forms use `noValidate` with only a form-level message | No | Add field-level messages + `aria-describedby` to the two sign-in forms; keep the generic "not accepted" wording (no account enumeration) |
| 20 | Success notifications | Partial | Admin actions return `ActionState`; no consistent announcement | No | A small `role="status"` region in admin forms; no toast library |
| — | PWA / offline | Missing | `manifest-src 'self'` already in CSP | No | Separate milestone (Phase E) |

**Duplicates to avoid:** focus management after "See more" already exists (do not add a second); `DataStatusBadge`/`StatusLegend` already define the verified/provisional/pending vocabulary (reuse it in search, compare and copy); admin `Field`/`controlClass` already handle errors (extend, do not add a form library).

## Prioritised roadmap

### Phase A — Foundations (implemented locally 2 Nov 2026, not committed or deployed; verified profiles are not yet added to the sitemap)
1. **University route** `/destinations/[slug]/universities/[uni]`, rendered from the `public_*` views by slug, reusing `UniversityCard`/`ProvisionalCard`. Not-listed slug → 404. Provisional pages `noindex` (thin content); verified pages in the sitemap. "See more" cards link to it.
2. **Share + copy link + copy information** on that page (features 8, 9).
3. **Back-to-top** (1).
4. **Password visibility toggle** and field-level sign-in errors (18, 19).
5. Tests: route returns 404 for unpublished/unknown slugs and never renders internal fields (DB test against `public_*`); copy text includes the status label and source; unit tests for the toggle.

### Phase B — Discovery (implemented locally 2 Nov 2026 at `/universities`, not committed or deployed; the `/` search shortcut moves to Phase C)
6. **Search endpoint + search UI** with filters (destination, verified/provisional, website checked, city, type) and sorting (name, verified first) — features 5, 6, 7. `/` shortcut (15).
7. **Recently viewed** (3) and **device-only saved list** (4, if approved in that form).
8. Tests: injection/escaping, length limits, only public fields in the JSON, provisional entries never carry course/fee/ranking keys.

### Phase C — Accessibility and content (implemented locally 2 Nov 2026, not committed or deployed: text size, `/` and `?` shortcuts with an off switch, collapsible mobile filters, `/faq` with no entries until owner-approved content exists, shared DB-backed limits on `/api/universities/*` in `auth_rate_limit`; per-client limits need `AUTH_CLIENT_IP_HEADER`, R-033)
9. **Text-size control** (11), keyboard/focus audit (15).
10. **FAQ** (12) only once the owner supplies approved answers; reading time/TOC/progress (2, 13, 14) only with long guides.

### Phase D — Language (implemented locally 3 Nov 2026, not committed or deployed. Hindi strings in `lib/i18n/hi.ts` are a DRAFT awaiting review by a fluent Hindi reviewer before release; English fallback per key; preference in the first-party `lockin-lang` cookie. Interface shell, search, saved/recent, profile chrome, candidate cards, FAQ interface, 404 and student sign-in are translated; home, destination pages, auth/chat/age pages, verified university cards, admin, legal text, QS wording and copied records stay English and are marked `lang="en"`)
11. **Hindi UI chrome** (16): navigation, buttons, labels, empty states. University data, legal, privacy and disclaimers stay English with a note in Hindi saying so.

### Phase E — Offline (separate milestone)
12. Manifest + a service worker that caches **only** `/_next/static`, fonts, `/images`, `/textures` and one offline page. Never caches HTML of directory pages (rankings/status could go stale), `/admin`, `/api`, `/auth`, `/chat`, `/age-confirm`, or anything with a cookie. Network-only for everything else.

### Deferred until verified data exists
- **Comparison tables** (10), fee/intake/ranking filters, ranking sort (needs QS licence + `allow_ordering`).

### Deferred until student accounts are approved
- **Account-backed bookmarks**: migration `0013_saved_universities` (`user_id` FK, `university_id` FK, unique pair, `created_at`), every query scoped by the session user id on the server, no audit-trigger changes; cleared with account erasure.

## Security and data rules applied throughout
- New public reads go through `public_*` views only, like `lib/data/directory.ts`; base tables (review notes, evidence) are never read by public code.
- No new dependencies planned. No changes to Better Auth, triggers, audit chain, migrations 0001–0012, verification workflow, DNS or domains.
- Browser storage holds only public slugs and display preferences — never auth data, form contents or research.
- Student registration and Derek stay disabled.

## Owner decisions (2 Nov 2026)
1. Phase A approved; Phase B waits for the Phase A report.
2. Bookmarks: **device-only** in `localStorage` for now. No migration, no account sync.
3. The staging import of the 431 candidates is planned as a separate approved operation, after the MariaDB backup-restore issue is resolved. Development and tests use the local database.
