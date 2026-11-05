# Personal data breach runbook (draft, pending legal review)

For the Owner. Based on DPDP Act 2023 s.8(6) and DPDP Rules 2025 r.7 (official text, G.S.R. 846(E), 13 Nov 2025; rule 7
applies from about 13 May 2027, but follow it now). A **personal data breach** is any unauthorised processing, or any
accidental disclosure, acquisition, sharing, use, alteration, destruction or loss of access to personal data that compromises
its confidentiality, integrity or availability (Act s.2(u)).

Contact details and the lawyer are placeholders: **[To be completed by the Owner: lawyer, hosting support route, email provider contact]**.

## 0–1 hour: contain

1. Write down the time you **became aware** of the breach (UTC). Every deadline below runs from this moment.
2. Stop the leak without destroying evidence:
   - Student area: remove `STUDENT_ACCOUNTS_ENABLED` in the hosting panel and rebuild. Students are then refused and no new data comes in.
   - Derek: untick automatic replies in `/admin/settings` (kill switch) and unset `DEREK_AI_ENABLED`.
   - Leaked credentials: rotate `BETTER_AUTH_SECRET` (this signs everyone out and invalidates email codes and device cookies), the database password, `GEMINI_API_KEY`, `SMTP_PASSWORD` and the OAuth client secrets, as applicable.
   - Staff account misuse: revoke the member in `/admin/team`, or with `pnpm admin:user` on a trusted machine.
3. Take a backup **now** with `prod-backup.mjs` and keep it as evidence (it holds personal data: store it encrypted and offline).
4. Keep the logs: Hostinger access logs, `data_change_log` (verify the hash chain with the audit check), and the Node logs.

## Without delay: tell the Data Protection Board (r.7(2)(a))

Send a description of the breach: its nature, extent, timing and location, and the likely impact. Use the Board's online
channel: **[To be completed by the Owner: Board portal link once published]**.

## Without delay: tell each affected student (r.7(1))

Write to their account email (or show it in their account) in **concise, clear and plain** language:

- (a) what happened: the nature, extent and timing;
- (b) the consequences likely for them;
- (c) what LockIn has done and is doing to reduce the risk;
- (d) what they can do to protect themselves (for example, sign out all devices from Your account, watch for phishing, change any reused password);
- (e) the business contact of the person who can answer their questions **[To be completed by the Owner]**.

Never put the leaked data itself in the notice.

## Within 72 hours: detailed report to the Board (r.7(2)(b))

Unless the Board allowed longer on a written request:

1. updated and detailed description;
2. the broad facts: events, circumstances and reasons that led to the breach;
3. measures implemented or proposed to mitigate risk;
4. any findings about the person who caused it;
5. remedial measures to prevent it happening again;
6. a report on the notices given to affected students.

## Afterwards

- Record the breach, the timeline and the decisions in `IMPLEMENTATION-RECORD.md`, with no personal data in it.
- Fix the cause in a PR with a test, deploy, and only then turn the switches back on.
- Keep the evidence backup and logs for at least one year (r.6(1)(e)), then delete them.
