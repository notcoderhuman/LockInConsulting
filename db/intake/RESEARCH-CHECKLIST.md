# University research checklist

Use this for every university and every fact. The intake JSON files in this folder are the private
review file: they hold evidence and research status only and are never read by the public site.

## Status vocabulary (intake files)

| Status | Meaning |
| --- | --- |
| `captured` | An automated or manual fetch on the stated date returned the quoted evidence from the official page. Still needs human verification in /admin. |
| `blocked_automated_check` | The site blocks automated fetches (bot challenge, timeout). Open it in a real browser before entry. |
| `source_not_located` | No official page found yet. Leave the field empty; never estimate. |
| `stale` | Evidence is for a period that has already ended. Re-capture before entry. |
| `not_yet_researched` | Known gap. |

Only the database `verification_status = 'verified'` (set in /admin by a reviewer) makes a value publishable.

## 1. Identity (university record)

- [ ] Official name exactly as the institution writes it.
- [ ] Official website is on the institution's own domain, uses `https://`, and loads in a browser.
- [ ] The page title or header names the institution.
- [ ] Institution type (public/private) taken from the institution or a government register, otherwise `unknown`.
- [ ] A matching name and working website verify **identity only**. Do not mark fees, courses or anything else as verified because of it.

## 2. Facts

For each fact record:

- [ ] Exact source URL on the official domain (not a search result, aggregator, agent or ranking site).
- [ ] Date checked.
- [ ] Academic year or validity period printed on the page. No period printed → the fact cannot be verified.
- [ ] Scope: `university_wide` (applies to all programmes, e.g. a fee band policy) or `course_specific` (applies to one programme). Course-specific values belong on a course record, never on the university.
- [ ] A short quote of the evidence.
- [ ] Bands, ranges and "usually" statements are policies, not fees. Do not enter them as a course fee.
- [ ] Missing facts are recorded as unavailable. Never estimate acceptance rates, fees, deadlines, requirements or scholarship eligibility.

## 3. Rankings

- [ ] Never captured from university pages or third-party lists.
- [ ] Stay unpublished until the provider's reuse rights are recorded in /admin › Settings.

## 4. Entry in /admin

1. Create the source (/admin/sources/new) for each URL.
2. Create the university as a draft with the official website and source.
3. Add courses and fees as drafts, each linked to its own source.
4. Submit for review. A second Owner/Editor opens each source page, compares the value, then verifies.
5. Publish only after verification. The database rejects publishing unverified records.
6. Update the intake file's `status` once entered, with the date.

## 5. Re-check

- Every verified record has a review-due date. Re-check before it, or unpublish.
