# Audit: `global_university_directory_2026_2027-v6.pdf` (17 Oct 2026)

**Verdict: rejected as a data source.** Nothing from this document has been imported, seeded or published.
The machine-readable result is `2026-10-17-pdf-audit.json`. `tests/intake-audit.test.ts` checks that no
candidate carries any PDF fact and that no migration seeds universities.

## Findings

| Check | Result |
| --- | --- |
| Row count | The header says **749**. Parsing found **779**, and the per-country headings add up to 779. |
| Names | **754 of 779** are generated placeholders: `University of <Country> #N` / `<Country> State University #N`. Canada, Germany, Australia, France, Italy, Japan, Saudi Arabia, UAE, New Zealand, Finland, Poland, Philippines and Georgia contain **no real names**. |
| Named institutions | 25 in total: 15 in the US and 10 in the UK. |
| Tuition, deadlines, entry criteria, scholarships | Every country uses **one identical text block** for all its rows. For example, all 150 US rows show `$62,000`, `GPA 3.9+, SAT 1530+, TOEFL 100`, `Fall: Jan 1 / Nov 1 EA / Spring: Oct 15`. This includes public universities, which charge residents differently. All 130 UK rows show `A*A*A / IB 39+`, `£39,000` and "Chevening". Chevening is a postgraduate government scholarship, not a university award. |
| Acceptance rates | The rate rises by 1 point every two rows (4%, 5%, 5%, 6%, 6% …), so it follows the row's position in the table and is not real data. |
| QS / THE ranks and scores | They are internally inconsistent: QS #2 and #4 are claimed for both a US and a UK university, and every QS rank from #53 onward appears in 13 countries. Sub-scores fall by a constant 0.4 per row. Placeholder rows score above named ones (US row 16 is 88.6, row 15 is 77.5). No reuse licence exists (R-003), so nothing would be published even if the figures were correct. |
| Country scope | It covers France, Japan, Philippines and Georgia, which are **not** among the site's 11 destinations. |
| Living-cost "mandates" | These are not used. Visa financial requirements change and must come from the immigration authority's own page. |

## What was kept

The PDF contributed nothing except the 25 institution **names**. Each name is only a lead. I fetched
each candidate's official homepage on 17 Oct 2026:

- **17** returned HTTP 200 with a page title matching the institution (`reviewStatus: identity_candidate`).
- **8** were blocked by bot protection (Cloudflare or a CAPTCHA): UPenn, Princeton, Johns Hopkins, Columbia, NYU,
  Michigan, Oxford and UCL. Their status is `identity_check_blocked`. Someone needs to open these in a browser.

No other field was verified, and `acceptedFacts` is empty for every candidate.

## How a candidate becomes public

1. An Editor adds the official page as a **Source** in `/admin/sources`, with its retrieval date.
2. The Editor adds the university as a draft in `/admin/universities`, then adds each fact as its own child
   record (fee, intake, acceptance rate) linked to its source. Each fact needs its academic year or valid-to
   date. A figure the university does not publish is marked "not publicly available". It is never estimated.
3. A Reviewer checks the fact against the source and verifies it. The Owner or Reviewer then publishes it. The CHECK
   constraints and `public_*` views refuse anything unverified, unsourced or past its review date.
4. Rankings stay drafts until R-003 records confirmed reuse rights for that provider.
