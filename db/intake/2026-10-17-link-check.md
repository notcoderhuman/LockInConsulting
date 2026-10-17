# Official-resource link check — 17 Oct 2026

Method: automated `curl -L` from the build sandbox with a desktop browser user-agent (20–40 s timeout),
plus one HTTP/1.1 retry and a server-side web reader for failures. **No link here has been opened
by a person in a real browser.** "Reachable" means HTTP 200 only; it does not confirm the content
is still accurate.

## Listed on the site (OFFICIAL_RESOURCES, 35 links)

- **32 reachable** (HTTP 200).
- **3 blocked automated checks, not confirmed broken.** Each returned real content through the web reader:
  - `https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html`: HTTP/2 stream reset, then a 40 s timeout over HTTP/1.1. The web reader returned "Study permit - Canada.ca".
  - `https://studyinitaly.esteri.it/`: the TLS handshake was dropped. The web reader returned "Study In Italy" (MAECI).
  - `https://vistoperitalia.esteri.it/`: the TLS handshake was dropped. The web reader returned the MAECI visa page.
- **0 confirmed broken.**

## Unresolved (UNRESOLVED_OFFICIAL_LINKS, not shown on the site)

| URL | 15 Oct result | 17 Oct result | Classification |
| --- | --- | --- | --- |
| travel.state.gov student visa | 403 | 403 | Blocks automated checks |
| universitaly.it | 202 | **200** "Homepage - Universitaly" | Reachable now. Not promoted: needs a manual check first. |
| migri.fi studying in Finland | 403 | 403 | Blocks automated checks |
| studywithnewzealand.govt.nz | 429 | 429 | Blocks automated checks |
| web.khda.gov.ae | timeout | TLS certificate chain not verifiable from the sandbox | Blocks automated checks |
| go-poland.pl | timeout | TLS hostname mismatch | **Broken** (superseded by study.gov.pl) |
| studyinsaudi.moe.gov.sa | DNS failure | DNS failure | **Broken** (host does not resolve) |

## Needs a real-browser check before staging sign-off

All 3 blocked listed links, plus universitaly.it, travel.state.gov, migri.fi, studywithnewzealand.govt.nz and khda.gov.ae.
