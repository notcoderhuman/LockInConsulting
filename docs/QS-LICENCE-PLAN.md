# QS licence: what to ask for and how to record it

Status, 26 Oct 2026: **the owner reports that QS has granted permission (D-042).** Gaps G1 and G2
below are now built (migration 0007). The licence details are not recorded yet, so QS stays
`not_confirmed` in every database until the owner fills in section 4. Do not scrape QS.

## 1. What the site would do with QS data

Setting QS to `licensed` turns on U2 (display) only. U3 and U4 (ordering) and U5 (Derek) each need their
own tick in Ranking reuse rights ("Sort and select…", "Let Derek mention ranks…"). Tick them only if
the licence covers that use. U1 and U6 are how data gets in; U7 is a separate request.

| # | Use | Where in the code |
|---|-----|-------------------|
| U1 | **Store** the overall QS World University Rankings position or band for each listed university: up to 50 per destination, 11 destinations, so at most about 550 rows per edition. | `university_rankings` |
| U2 | **Display** it on each university card ("#45" or "501–510", "QS Quacquarelli Symonds 2027", plus a link to the QS page and the date it was checked). | `components/destination/university-card.tsx` |
| U3 | **Order** each destination's list by QS rank or band, 5 per page, up to 50. | `lib/db/directory-queries.ts` (`QS_RANK`) |
| U4 | **Select** which universities are listed: "QS top 1,000, latest edition". This is the eligibility claim the directory is built on. | Editorial rule; no code yet |
| U5 | **AI assistant:** Derek may quote a university's QS rank when answering a student. The text is sent to Google Gemini (paid API tier) to draft the reply. | `lib/derek/evidence.ts` |
| U6 | **Data entry:** a person types each value from the public QS page into `/admin`; it is checked by a second person before publication. No scraping, no bulk download, unless QS supplies a file or API. | `/admin` workflow |
| U7 | **Optional, ask separately:** QS subject rankings for Computer Science & Information Systems. | `university_rankings.subject` |

Not needed: the QS logo, the full ranking table, scores or indicator data, or redistributing data to
anyone else.

## 2. Questions QS must answer in writing

1. **Permission** for U1–U6 (and U7 if wanted) on a commercial website run by an education consultancy.
   The website is free to students; say plainly how the business earns money, because QS will ask.
2. **Licensee:** which legal entity signs. *Blocker: R-012, the legal entity isn't decided yet.*
3. **Fee, term and renewal:** start date, expiry date, notice period, what happens at expiry.
4. **After expiry:** how quickly the data must be removed. The site hides it automatically on the expiry date, so this is easy to agree to.
5. **Attribution:** the exact wording required, where it must appear, and whether a link to
   topuniversities.com is required or allowed. Is the name "QS World University Rankings" allowed without the logo?
6. **Format:** must positions be shown exactly as QS publishes them, including ties ("=45") and open bands ("1201+")? See gap G3.
7. **Derived claims:** may we say a university is "in the QS top 1,000", and use the rank to order and filter our list (U3, U4)?
8. **AI use (U5):** may ranks be passed to an AI model to compose an answer for an individual student? Is there any restriction on AI training? Gemini paid-tier terms say prompts are not used for training.
9. **Data source:** is manual entry from the public site acceptable, or will QS supply a file or API? Is there a limit on the number of universities?
10. **Edition updates:** must we update to each new edition within a set time, or may we keep showing a dated edition with its year?
11. **Territory and audience:** worldwide website, mainly students in India.

## 3. Draft email

> **Subject:** Licence request: displaying QS World University Rankings positions on a university directory
>
> Dear QS licensing team,
>
> We are [LEGAL ENTITY NAME], an education consultancy based in India that helps students apply to
> universities abroad. Our website, [DOMAIN], lists universities in 11 destinations (United States,
> United Kingdom, Canada, Italy, Germany, Australia, New Zealand, Saudi Arabia, United Arab Emirates,
> Finland and Poland). Each listing shows courses, tuition and entry requirements, every figure linked
> to its official source. The website is free for students; [HOW THE BUSINESS EARNS MONEY].
>
> We would like a licence to use the QS World University Rankings as follows:
>
> 1. Store and display each listed university's overall position or band from the latest edition, with
>    the edition year, your attribution, and a link to the university's page on topuniversities.com.
>    At most 50 universities per destination (about 550 in total).
> 2. Use those positions to order our listings and to select universities ranked in the top 1,000.
> 3. Allow our assistant, which drafts replies to individual student questions with the help of an
>    AI model, to mention a university's QS position. The rankings would not be used to train any model.
> 4. [Optional] The same for the Computer Science & Information Systems subject ranking.
>
> Values would be entered by hand from your public website and checked by a second person; we will not
> scrape your site. We do not need your logo, scores or indicator data, and we would not
> redistribute the data.
>
> Could you tell us the terms, fees, required attribution, licence term, and what we must do when an
> edition is replaced or the licence ends?
>
> Kind regards,
> [NAME], [ROLE], [LEGAL ENTITY NAME]
> [EMAIL] · [PHONE] · [REGISTERED ADDRESS]

Fill in every `[…]` before sending. Find QS's current licensing contact on their own website; it isn't
recorded here, so don't guess an address.

## 4. How each stage is recorded in `ranking_providers`

Only an **owner** can do this, at `/admin/settings` → "Ranking reuse rights" → QS (`rights.manage`). Every
change is written to the audit log as `rights_change`, with the reason given in the form.

| Stage | `rights_status` | Other fields | Public effect |
|-------|-----------------|--------------|---------------|
| Today | `not_confirmed` | `rights_notes`: "QS terms require prior written consent…" (seeded) | None shown |
| Email sent | `requested` | `rights_checked_at` = date sent; `rights_notes` = who it was sent to, the date, and where the email is filed | None shown |
| Refused | `denied` | `rights_checked_at`, `rights_notes` = summary of the reply | None shown |
| Signed | `licensed` | see below | Shown, if each ranking row is itself verified and published |
| Expired | still `licensed` | `licence_expires_at` in the past | Hidden automatically from that day (view and tests) |

For `licensed`, the database refuses the change unless the first three fields are filled
(`ck_ranking_providers_licensed`):

- `licence_reference`: the agreement or invoice number, plus where the signed copy is stored (not in this repository).
- `licence_scope`: the permitted uses copied from the agreement, numbered U1–U7, **including any use not allowed**,
  the exact attribution wording, and the removal period after expiry.
- `rights_checked_at`: the date the owner read the signed agreement.
- `licence_expires_at`: the end date. Leaving it empty means no expiry; use that only if the agreement truly has none.
- `rights_notes`: fee, renewal date, and the QS contact.

Then each ranking is entered like any other fact: an editor adds a ranking under the university (year,
edition, position or band, and a source pointing at that university's QS page). It is submitted for
review, and a second person verifies and publishes it. Nothing is shown until both the licence and the
row allow it.

## 5. Code gaps to close before switching to `licensed`

Build these only once the licence terms are known; which ones are needed depends on the answers.

- **G1, done (0007): per-use switches.** Was: scope isn't enforced. `licensed` switches on U2, U3 and U5 together. If the licence excludes ordering or
  AI use, add a flag per use and check it in `directory-queries.ts` and `derek/evidence.ts`. Do this *before* setting `licensed`.
- **G2, done (0007): attribution field.** Was: no attribution field. `ranking_providers` has no `attribution_text`; `fx_providers` does. Add the column and
  show it on the card and on the rankings notice if QS requires wording.
- **G3, display format.** Positions are stored as integers and bands need both ends, so "=45" (a tie) and "1201+"
  (an open band) can't be shown exactly. Add a `display_label` column if QS requires its exact format.
- **G4, the top-1,000 claim.** Nothing derives it yet. It would come from `rank_position ≤ 1000` or
  `rank_band_high ≤ 1000` for the latest licensed edition, shown with the edition year.
- **G5, edition handling.** Ordering uses each university's latest QS year. If QS requires all listings to use one edition, filter by that edition year.
- **G6, the rankings notice.** `rankings-notice.tsx` says no rights are confirmed. It already switches its heading
  on the published count; check the wording against the attribution QS requires.

## 6. Owner checklist

1. Decide the legal entity (R-012) and the domain; describe the business model in one sentence.
2. Find QS's licensing contact on their website; fill in and send the email.
3. Set QS to `requested` in `/admin/settings`, with the date and contact.
4. When QS replies: record `denied` or `licensed` as in section 4; file the signed agreement privately.
5. Before setting `licensed`, ask for G1–G6 to be built to match the terms.
6. If QS refuses or the fee is unacceptable, replace the top-1,000 rule with a selection criterion that uses only official, freely reusable sources.
