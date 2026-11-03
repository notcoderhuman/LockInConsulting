# Stage 3: admin bootstrap, regression and directory import

Prepared 2 November 2026. Owner creation and the import both need separate approval. Nothing here has been run on Hostinger.

## Owner account

`owner-bootstrap.mjs`, kept outside the repository, wraps the existing `scripts/admin-user.mjs`. No sign-up route is added.

1. Supply a real email address and name.
2. Dry run: `node owner-bootstrap.mjs --email <email> --name "<name>"`.
3. After approval, run it with `--apply --i-approve-owner` in your own terminal.
4. Type the password twice at the hidden prompt. It must meet `PASSWORD_POLICY`. It is never on a command line, in a file, in the environment or in chat.

The script adds a temporary single-IP rule on `lockin_app`, verifies TLS, confirms 0 Owners and an unused email, creates the account, confirms exactly 1 active Owner, verifies the audit chain, then removes the rule. It refuses if any Owner exists. If the rule cannot be removed it exits 2 with the exact rule.

## Admin regression

Account passwords cannot be typed by an assistant on this hostname, so the Owner signs in personally and the session is then tested from the browser pane.

| Area | Test |
| --- | --- |
| Owner | Sign in, sign out, wrong password, session after restart |
| Dashboard | Overview, team, settings, changes |
| University management | List, record view, edit a draft |
| Sources and review | Source list, review queue, status changes |
| Audit | History page, `verify-audit` |
| Roles | Editor and reviewer separation, which needs two more accounts and separate approval |
| Unauthorised requests | Already passed anonymously; repeat with each role |
| Layout | Desktop and 375 px on admin pages |

The review steps change data, so they need synthetic records and should run before the import, or use one record that is then returned to draft.

## Directory import

| Step | Operation |
| --- | --- |
| 1 | Add a temporary single-IP rule on `lockin_app`; verify TLS |
| 2 | Compare `schema_migrations` names and checksums, and table and column lists, with the local database. Any difference stops the import |
| 3 | Back up with `mysqldump` over verified TLS into the private folder, and confirm the file restores into a throwaway database |
| 4 | Confirm 0 universities on staging |
| 5 | `import-research.mjs --apply --allow-remote --universities-only --identity-from <snapshot>` |
| 6 | Confirm the totals below, 0 verified, 0 published, 0 courses, 0 fees, 0 intakes, 0 rankings, audit chain intact |
| 7 | Remove the rule and confirm it is gone |
| 8 | Check every destination page and `public_provisional_universities` live |

The script for these steps will be written and rehearsed after approval. Expect about 7 minutes of network time for about 8,600 statements.

`--universities-only` leaves out the 29 courses, 4 intakes and 17 fees that the research would otherwise add. The local database holds 96 courses, 60 fees and 57 intakes, and none of those are copied. Rankings are never read.

`--identity-from` replays the recorded website checks, with their original dates and evidence, instead of fetching 431 websites again. The snapshot is in the private research folder, under `import-backups`. A university with no recorded check is refused, not guessed.

Re-running changes nothing. An existing university is never touched.

| Destination | Universities | Website-checked | Pending |
| --- | --- | --- | --- |
| Australia | 41 | 23 | 18 |
| Canada | 50 | 44 | 6 |
| Finland | 13 | 11 | 2 |
| Germany | 50 | 44 | 6 |
| Italy | 50 | 24 | 26 |
| New Zealand | 10 | 5 | 5 |
| Poland | 50 | 19 | 31 |
| Saudi Arabia | 41 | 14 | 27 |
| UAE | 26 | 14 | 12 |
| United Kingdom | 50 | 40 | 10 |
| United States | 50 | 36 | 14 |
| **Total** | **431** | **274** | **157** |

All 431 remain unverified. Public views expose name, website, city and identity status only. Review notes and evidence stay in the base table. A website check counts for 180 days, so the 274 start reverting to pending around late April 2027 unless they are re-checked.
