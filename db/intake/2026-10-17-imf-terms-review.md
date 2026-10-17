# IMF exchange-rate provider — terms evidence (for Owner decision)

**Database status stays `terms_status = 'not_reviewed'`.** This file is evidence only. It does not
approve anything. Only the Owner can change the status in /admin › Settings.

| Item | Value |
| --- | --- |
| Terms URL | https://www.imf.org/en/about/copyright-and-terms |
| Retrieved | 17 Oct 2026, headless Chromium (agent-browser). Plain `curl` gets HTTP 403. |
| Page title | "IMF Copyright and Usage" |
| Effective date | "Effective: October 11, 2024", seen in a web-reader copy on 17 Oct 2026. The browser text capture didn't include that line. |
| Dataset URL | https://www.imf.org/external/np/fin/ert/GUI/Pages/CountryDataBase.aspx ("Exchange Rate Report Wizard", loaded 17 Oct 2026) |

## Applicable terms (verbatim excerpts, "Special Terms for Statistical Data")

- Scope explicitly includes **"Exchange Rate Data"**.
- "Users may download, extract, copy, create derivative works, publish, distribute, and use Data obtained from IMF Sites subject to these conditions:"
- Attribution: "Distributed or reproduced Data must appear accurately with attribution to the IMF as the source, e.g. 'Source: International Monetary Fund, Database Name, <<link to the dataset>>.'"
- Integrity: "If material transformation occurs, it must be stated explicitly along with the required source citation." Deriving INR per foreign-currency cross rates from rates quoted per USD is likely a transformation, so it would need to be stated.
- "The Data is provided to Users 'as is' and without warranty of any kind".
- **"For any potential commercial reuse of IMF Data, email copyright@imf.org to request permission."**

## General terms that also apply

- "The IMF prohibits bulk download of information by automated technology without explicit permission".
- Use must not be "misleading or [imply] endorsement by or affiliation with the IMF".
- The IMF name and seal are registered trademarks. Attribution text must not use the logo.

## Cadence and coverage (from the dataset page)

- "Representative rates … normally quoted as currency units per U.S. dollar, are reported daily to the Fund by the issuing central bank."
- Coverage of INR, SAR, AED, GBP, EUR, CAD, AUD, NZD and PLN was **not confirmed**: the currency list only appears in later wizard steps, which weren't completed.

## Open questions the Owner must resolve before approval

1. **Commercial reuse.** LockIn is a commercial consultancy, so showing INR conversions on its site may count as "potential commercial reuse". Written permission from copyright@imf.org is the safe route. Do not approve before that answer.
2. **Automated fetching.** A scheduled fetch may count as "automated technology" downloading. Ask for permission in the same email, or enter rates manually.
3. Confirm currency coverage in a real browser.
4. Agree the exact attribution text, including a statement that the INR figures are derived cross rates.

**Result: unresolved.** Evidence is documented, but approval is blocked on questions 1 and 2.
