# Bulk import format (`lockin-import@1`)

Admin → Data tools → Bulk import. Editors, reviewers and the Owner can import; the file is validated
in full with the same rules as the capture forms before anything is written, and the whole import is
one transaction.

What an import can and cannot do:

- Every record it creates is a **draft, unverified** record with its source. A verification status in
  the file is ignored. Verifying and publishing stay in the normal workflow (Owner: bulk verification).
- It **never changes an existing record**. A university matched by slug, name (accents, case,
  punctuation and a leading "The" ignored) or website host, or a course matched by slug, gets one
  open conflict per differing field instead, with the file's source attached.
- The same file (by SHA-256) can be imported only once.
- A fee's `academicYear` must be in Settings → Academic years once that list has any entry.
- Up to 500 universities and 900 KB per file.

```json
{
  "format": "lockin-import@1",
  "universities": [
    {
      "destinationIso2": "FI",
      "name": "Example University",
      "slug": "example-university",
      "officialWebsite": "https://www.example.fi/",
      "admissionsUrl": "https://www.example.fi/admissions",
      "city": "Helsinki",
      "subRegion": "Uusimaa",
      "institutionType": "public",
      "institutionSubtype": "research_university",
      "source": { "url": "https://www.example.fi/about", "title": "About", "publisher": "Example University", "sourceType": "university_official", "accessedOn": "2026-11-05" },
      "courses": [
        {
          "name": "Master's Programme in Example Studies",
          "qualification": "master",
          "studyLevel": "PG",
          "durationMonths": 24,
          "studyMode": "full_time",
          "teachingLanguage": "English",
          "entryRequirements": "Copied verbatim from the programme page.",
          "languageRequirements": "IELTS Academic 6.5 overall (verbatim).",
          "otherLanguageRequirements": null,
          "courseUrl": "https://www.example.fi/msc-example",
          "source": { "url": "https://www.example.fi/msc-example", "title": "MSc Example", "publisher": "Example University", "sourceType": "university_official" },
          "intakes": [{ "month": 9, "year": 2027, "applicationDeadline": "2027-01-15" }],
          "fees": [
            { "category": "international", "amount": "15000", "currency": "EUR", "billingPeriod": "per_year", "academicYear": "2027-2028",
              "source": { "url": "https://www.example.fi/fees", "title": "Tuition fees", "publisher": "Example University", "sourceType": "university_official" } }
          ]
        }
      ]
    }
  ]
}
```

Field values follow `lib/data/validation.ts` (`universityInput`, `courseInput`, `intakeInput`,
`tuitionFeeInput`). `slug` is derived from the name when omitted. A course, intake or fee without its
own `source` inherits its parent's. When one field comes from a different page than its record (for
example the admissions URL, or the English requirement on a separate page), add
`"fieldSources": { "<field name>": { ...source } }` to that university, course, intake or fee; the
import stores it as a pending `field_sources` row (migration 0013). Only fields the record sets are
allowed. Fees for a course that already exists are not imported (the import
report says so); add them on the course page.

Rankings: a university may list `"rankings": [{ "provider": "qs", "year": 2027, "position": 150, "source": { ... } }]`
(or `bandLow` + `bandHigh` instead of `position`; `subject` empty for the overall table). Each rank needs its own
source, typed from the provider's public page: no scraping or bulk download. The whole file is refused unless the
Owner has recorded that provider as `conditional` or `licensed` in Settings → Ranking reuse rights. Imported ranks
are drafts; none is ever shown publicly until the provider is `licensed` with its attribution text and link
(QS: https://www.topuniversities.com/world-university-rankings), and the rank is verified and published.

Never put fabricated values in a file: leave a field out when the official source does not publish it.
