# Derek: AI provider terms for LockIn's audience

> **Decision (6 November 2026):** the Owner chose the existing Gemini Developer API integration (`DEREK_PROVIDER=gemini`). Dev states that Google's permission for this use has been obtained (see D-041). The comparison below is kept for the record and is not being pursued. Go-live steps: `docs/DEREK-GO-LIVE.md`.

Checked on **6 November 2026** against the providers' official pages (URLs below). This is a reading of the
terms, not legal advice. The Owner decides, with legal review, before setting `DEREK_PROVIDER_APPROVED`.

**LockIn's audience:** students, mostly in India, using a free chat. Many are in Class 12 or college, so some
are under 18. Derek drafts only for signed-in students whose profile records an 18+ confirmation
(lib/derek/drafts.ts, for every provider since 6 Nov 2026), but other pages of the site are open to everyone.

## 1. Gemini Developer API (current `DEREK_PROVIDER=gemini`)

Source: Gemini API Additional Terms of Service, https://ai.google.dev/gemini-api/terms (redirects to
https://aistudio.google.com/docs/terms), "Effective March 23, 2026".

| Point | What the terms say | For LockIn |
|---|---|---|
| Age | "You must be 18 years of age or older to use the APIs." API clients may not be "directed towards or … likely to be accessed by individuals under the age of 18." | The binding constraint. Derek is limited to students with an 18+ confirmation, but whether a study-abroad chat for Class 12 students is "likely to be accessed" by under-18s is a legal question. |
| Consumer use | "Use of Google AI Studio and Gemini API is for developers building with Google AI models for professional or business purposes, not for consumer use." "Consumer use" is not defined. The terms elsewhere expect developers to make "API Clients available to users". | Ambiguous for a free, consumer-facing chat. D-041 records Google's earlier confirmation; it should be re-confirmed against these terms. |
| EEA, Switzerland, UK | "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." | Production already requires `GEMINI_PAID_TIER=true`. |
| Data, unpaid tier | Google uses content "to provide, improve, and develop Google products"; "human reviewers may read, annotate, and process your API input and output"; "Do not submit sensitive, confidential, or personal information to the Unpaid Services." | Never for real students. |
| Data, paid tier | Google "doesn't use your prompts … to improve our products"; it "logs prompts and responses for a limited period of time" for abuse detection (no number of days given). Paid use needs a Cloud project with an active billing account. | Acceptable with the paid tier. |
| Advice | "Don't rely on the Services for medical, mental health, legal, financial, or other professional advice." | Derek already refuses visa, legal and financial advice and sends those to a person. |
| Region | India is listed: https://ai.google.dev/gemini-api/docs/available-regions (no date on the page). | Available. |

Generative AI Prohibited Use Policy, https://policies.google.com/terms/generative-ai/use-policy ("Last Modified:
December 17, 2024"): no rule on minors or education; it bars automated decisions with "material detrimental
impact" in high-risk domains without human supervision. Derek gives information and never decides admissions.

Model: `gemini-3.5-flash-lite` is "Stable" with "No shutdown date announced"
(https://aistudio.google.com/docs/models and https://aistudio.google.com/docs/deprecations, checked 6 Nov 2026).
`GEMINI_MODEL` is unchanged.

## 2. Gemini on Vertex AI (Google Cloud; new `DEREK_PROVIDER=vertex`)

Google now calls Vertex AI the "Gemini Enterprise Agent Platform"; the API host is still `aiplatform.googleapis.com`.

| Point | What the terms or docs say | Source |
|---|---|---|
| Age | **Same rule as the Developer API.** "Customer will not, and will not allow End Users to, use a Generative AI Service as part of a website, Customer Application, or other online service that is directed towards or is likely to be accessed by individuals under the age of 18." (Generative AI Services, "Age Restrictions"; Google may suspend for a breach.) | Service Specific Terms §20(d), https://cloud.google.com/terms/service-terms |
| Consumer use | No "not for consumer use" clause. Customers may "integrate the GCP Services … into any Customer Application". Restricted: medical advice and clinical use (§20(e)), High Risk Activities (Cloud Terms §3.3). | https://cloud.google.com/terms ; Service Specific Terms §20(e) |
| Training | "Google will not use Customer Data to train or fine-tune any AI/ML models." | Service Specific Terms §18 (Training Restriction); https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance |
| Abuse logging | "Google may log Customer prompts solely for the purpose of reviewing" possible policy violations. | Cloud Terms §4.3, https://cloud.google.com/terms |
| Caching | Gemini models cache customer data by default; in-memory cache is "deleted no later than 24 hours after it's written" and never used for training. Caching can be turned off per project (`disableCache`). | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance |
| Model | `gemini-3.5-flash-lite` is listed under "Generally available Gemini models", including on the global endpoint. Availability in `asia-south1` (Mumbai) could not be confirmed (the region table did not render). | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models ; https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations |
| Data location | "Endpoints don't guarantee data residency or in-region ML processing." "Don't use the global endpoint if you have ML processing requirements." | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations |
| Authentication | Vertex accepts "a Google Cloud API key or application default credentials"; Google recommends an API key "for testing" and application default credentials (a service account) for production. | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys |
| Price | **Not confirmed.** The pricing page (https://cloud.google.com/vertex-ai/generative-ai/pricing) returned no price table on 6 Nov 2026. Check it in the Cloud console before enabling. | — |

## 3. Non-Google comparison: OpenAI API

The OpenAI Services Agreement, Usage Policies and Terms of Use (https://openai.com/policies/services-agreement,
https://openai.com/policies/usage-policies, https://openai.com/policies/terms-of-use) **could not be read**
(HTTP 403 on 6 Nov 2026). The points below come from OpenAI's developer docs only; the agreements must be read
by hand before relying on any of this.

| Point | What the docs say | Source |
|---|---|---|
| Minors | Serving minors is possible with safeguards: "developers should implement additional safeguards when using our API to serve minors (under 18 years old)". For children under 13, no personal data "without first implementing zero data retention". OpenAI "reserves the right to audit organizations". | https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance |
| Training | "data sent to the OpenAI API is not used to train or improve OpenAI models" (unless you opt in). | https://developers.openai.com/api/docs/guides/your-data |
| Retention | Abuse monitoring logs are "retained for up to 30 days"; zero data retention needs OpenAI's "prior approval". | same page |
| India | Data residency table lists India (`in.api.openai.com`): regional storage yes, regional processing no; needs a sales agreement. | same page |
| Cost | `gpt-6-luna`: USD 0.10 input / 0.50 output per 1M tokens. | https://developers.openai.com/api/docs/pricing |

Moving to OpenAI would need a new adapter, a new model approval and a new live test. Nothing has been built for it.

## Recommendation

1. **The age rule decides this, and it is the same for both Google options.** Neither Google option permits a
   generative AI service that is "directed towards or likely to be accessed by" under-18s. Derek already runs
   only for signed-in students with a recorded 18+ confirmation. The Owner's lawyer must confirm whether that
   is enough, given that Class 12 students use the rest of the site. If it is not enough, neither Google option
   is usable, and OpenAI (which allows minors with safeguards) is the alternative to evaluate, starting with its
   agreements.
2. **If the 18+-only Derek is enough, prefer Vertex AI over the Developer API.** Vertex has no "not for consumer
   use" clause, a contractual no-training term, prompt handling under the Cloud terms, and a choice of region.
   The Developer API stays available for the synthetic live test.
3. Before approval: confirm the Vertex price, confirm `gemini-3.5-flash-lite` in the chosen region (or accept
   `global`), switch off caching if the privacy notice requires it, and name Google Cloud as a processor in the
   privacy notice.
4. Set `DEREK_PROVIDER_APPROVED=vertex` only after 1–3.

## Environment variables (none are set in production)

| Variable | For | Value |
|---|---|---|
| `DEREK_AI_ENABLED` | all | `true` to switch Derek on |
| `DEREK_PROVIDER` | all | `vertex` (recommended), `gemini`, or `mock` (never in production) |
| `DEREK_PROVIDER_APPROVED` | production | the same id as `DEREK_PROVIDER`, after the review above |
| `DEREK_AUTO_REPLY_CLEARED` | direct replies | the same id, to let low-risk answers go straight to students |
| `VERTEX_API_KEY` | vertex | **secret**; a Google Cloud API key restricted to the Vertex AI API |
| `VERTEX_PROJECT_ID` | vertex | the billed Google Cloud project ID |
| `VERTEX_LOCATION` | vertex | `global` (default) or a region such as `asia-south1` |
| `GEMINI_API_KEY` | gemini | **secret**; Developer API key |
| `GEMINI_PAID_TIER` | gemini, production | `true` |
| `DEREK_GEMINI_MODEL` | both | optional; only `gemini-3.5-flash-lite` is accepted |
| `DEREK_GEMINI_DAILY_DRAFT_LIMIT` | both | optional; default 100 drafts per rolling 24 h |
| `DEREK_DAILY_TOKEN_LIMIT` | all | optional; default 500,000 tokens per rolling 24 h |
| `DEREK_MAX_ATTEMPTS` | all | optional; `1` or `2` (default) |

shortcut: the Vertex adapter authenticates with an API key only. Google recommends application default
credentials (a service account) for production; add that if the review requires it.
