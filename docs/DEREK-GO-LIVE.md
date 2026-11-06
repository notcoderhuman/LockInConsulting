# Derek go-live checklist (Gemini)

For the Owner. Set every variable yourself, in the hosting panel only; never in the repository, a chat or a
`NEXT_PUBLIC_` variable. **None of these are set today**, and nothing here is purchased without your approval.

## Before any variable

1. **Google Cloud project with billing.** Create a dedicated project, link it to an active Cloud Billing account,
   and add prepaid credit (minimum USD 5). Gemini's paid tier needs this, and only the paid tier keeps student
   messages out of Google's product improvement.
2. **Budget alert** on that billing account (for example USD 10 a month, alerts at 50, 90 and 100 %).
3. **API key** created in that project only, restricted to the Generative Language API.
4. **Record Google's permission** for this use (D-041) and the data-handling review.
5. **Students can sign in:** student accounts are enabled by the auth workstream; Derek only answers signed-in
   students with a recorded 18+ confirmation, and that check runs on the server for every provider.
6. **Live smoke test with synthetic data:** `pnpm test:gemini-live` (at most 5 requests; see `docs/ENVIRONMENT.md`).

## Production environment for Derek

| # | Variable | Value | What it does |
|---|---|---|---|
| 1 | `GEMINI_API_KEY` | the key from step 3 (**secret**) | lets the server call Gemini |
| 2 | `GEMINI_PAID_TIER` | `true` | attests the key's project is billed; Derek refuses to run in production without it |
| 3 | `DEREK_PROVIDER` | `gemini` | selects the Gemini adapter (`gemini-3.5-flash-lite`) |
| 4 | `DEREK_PROVIDER_APPROVED` | `gemini` | records step 4; without it Derek is blocked in production |
| 5 | `DEREK_AI_ENABLED` | `true` | the master switch; set it last of 1–5 |
| 6 | `DEREK_AUTO_REPLY_CLEARED` | `gemini` | **only if** low-risk answers should go straight to students; without it every answer waits for a person in the Live Inbox |

Optional limits (defaults shown): `DEREK_GEMINI_DAILY_DRAFT_LIMIT=100`, `DEREK_DAILY_TOKEN_LIMIT=500000`,
`DEREK_MAX_ATTEMPTS=2`. Never set `MIGRATE_ON_BOOT` in the same environment update.

## After setting them

- In **Admin → Settings**, "automatic replies" is the kill switch: untick it to stop every automatic reply at once.
- Derek answers automatically only while the team is offline. Visa, legal, payment, distress, Hindi or
  Hinglish, and uncertain questions always wait for a person.
- In the **Live Inbox**, every conversation is visible; open one to take over (Derek stops) or return it to Derek.
- To switch Derek off completely, set `DEREK_AI_ENABLED=false` (or remove it).
