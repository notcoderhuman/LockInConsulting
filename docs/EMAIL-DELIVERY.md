# Email delivery for student codes

The site sends exactly one kind of email today: the 6-digit sign-in, sign-up and password-reset code (`lib/mail.ts`).
The sender is provider-neutral: plain SMTP, which every option below offers. **Nothing has been bought and no credentials
exist.** Until `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` are set, email codes stay off and the sign-in page
offers only providers and passwords.

Expected volume at launch: well under 100 codes a day (each send is capped at 1 a minute and 5 an hour per email, plus a
process-wide budget of about 10 a minute).

## Options (prices checked 5 Nov 2026 from third-party summaries; confirm on each provider's own page before buying)

| Option | SMTP | Price | Notes |
|---|---|---|---|
| **Hostinger Email mailbox** (e.g. `no-reply@lockinconsulting.com`) | `smtp.hostinger.com`, 465 (SSL) or 587 (STARTTLS) | Included with the plan's mailboxes, or a Hostinger Business Email plan | Reported daily limits: about 100/day on free mailboxes, 1,000 (Business Starter) or 3,000 (Business Premium); confirm under Emails → Mailboxes → View limits. Simplest: same DNS, same panel. Mailbox passwords are full account credentials: use a dedicated mailbox. |
| Amazon SES | Regional SMTP endpoint, SMTP credentials from IAM | From USD 0.10 per 1,000 (à la carte); new accounts may default to an "Essentials" plan at USD 0.16 per 1,000 | Sandbox until production access is approved; Mumbai region available. Cheapest at volume, most setup. |
| Zoho ZeptoMail (now under Zoho CPaaS) | `smtp.zeptomail.in` | About USD 2.50 per 10,000 emails, prepaid credits valid 6 months; first 10,000 reported free | Transactional only; Indian company and data centre option; billed in INR available. |
| Brevo | `smtp-relay.brevo.com` | Free plan: 300 emails a day | Account approval before sending. |
| Resend | `smtp.resend.com` | Free: 3,000 a month, 100 a day; Pro USD 20/month for 50,000 | Developer-friendly; US-hosted. |
| Postmark | `smtp.postmarkapp.com` | Free: 100 a month; Basic USD 15/month for 10,000 | Strong deliverability record for transactional mail. |

Any of them is also a processor of the student's email address: name it in the privacy notice and sign its data-processing terms
(DPDP Act s.8(2)). Recommendation: start with a **dedicated Hostinger mailbox** (no new vendor, no new processor beyond the host),
move to ZeptoMail or SES if limits or deliverability become a problem.

## Setup once the Owner supplies credentials

1. Create the mailbox (or provider account) for `no-reply@lockinconsulting.com`. Do not reuse a person's mailbox.
2. In the hosting panel set `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM="LockIn Consulting <no-reply@lockinconsulting.com>"`.
   Never commit them.
3. DNS (Hostinger DNS zone), then verify with an external checker:
   - **SPF**: one TXT record on the root, e.g. `v=spf1 include:_spf.mail.hostinger.com ~all` (plus the provider's include if another is used). Only one SPF record may exist.
   - **DKIM**: enable in Hostinger Email (or the provider) and publish the CNAME/TXT records it shows.
   - **DMARC**: start with `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<owner mailbox>`; move to `p=quarantine` after two clean weeks of reports.
4a. One real message, from a trusted machine with the `SMTP_*`/`MAIL_FROM` values set in that shell only: `pnpm test:smtp-live you@your-mailbox.example`. It logs in, sends one email and prints the server answer, never the user name or password.
4. Delivery test (local build with the production mail settings, not production switches): send a code to Gmail, Outlook and Yahoo test
   inboxes; check it arrives in the inbox, and that the headers show `spf=pass`, `dkim=pass`, `dmarc=pass`.
5. If Apple sign-in is used: register the sending domain for Apple's private email relay (`docs/AUTH-PROVIDERS.md`).

Status: blocked on credentials. SPF, DKIM, DMARC and delivery are **not** tested.
