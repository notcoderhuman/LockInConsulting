# Local preview and tests

Open the project folder (`<project-folder>`, your local clone) in Claude Code. It is the one development folder: branch `dev` holds every completed, approved feature, and `localhost:3000` always runs this folder. The folders under `.claude/worktrees/` are older or separate work (see `TODO.md`); do not preview from them.

## Commands (run in this folder)

| What | Command |
|---|---|
| Install or update dependencies (after pulling, or when `pnpm-lock.yaml` changes) | `pnpm install --frozen-lockfile` |
| Start the preview: sandbox database + `next dev` on http://localhost:3000 | `pnpm dev:local` |
| Stop the preview (database and `.env.sandbox.local` are deleted) | `Ctrl-C` in that terminal |
| Type-check (this is also the lint step) | `pnpm typecheck` |
| Unit tests | `pnpm test` |
| Database integration tests (throwaway MySQL) | `pnpm test:db` |
| Production build | `pnpm build` |

In the Claude desktop app, the preview pane's **lockin-local** entry (`.claude/launch.json`) runs the same `pnpm dev:local`.

## What the preview uses

- A fresh, disposable MySQL with every migration and **synthetic** accounts (owner, reviewer, editor, student `@sandbox.test`). Their generated passwords are in `.env.sandbox.local` (git-ignored) while the preview runs. Data does not survive a restart.
- Derek uses the **offline mock provider**. Its answers are labelled "test reply from the offline mock, not a real AI answer" and prove nothing about a real AI provider. Automatic replies are cleared for the mock only.
- No AI key, Google credentials or production setting is passed through, even if your shell has them (`scripts/dev-local.mjs` removes them). Production values live only in the hosting panel; never put them in a file in this folder.
- Edits hot-reload: save a file and refresh http://localhost:3000.

## Trying the chat, presence and handoff locally

1. Open http://localhost:3000, press **Chat Now**, sign in on `/auth` as `student@sandbox.test` (password in `.env.sandbox.local`). You land on `/chat`.
2. In a second browser (or a private window), sign in to http://localhost:3000/admin as `reviewer@sandbox.test`. Within 30 s the student chat shows "Sandbox is online" (the first name of that synthetic account), and new questions wait for a person.
3. Close the admin window. After about 2 minutes the status turns amber, after 3 minutes grey; the student's next check-in hands an eligible waiting question to Derek (mock), with the handoff notice first.

`pnpm dev:local` refuses to start if port 3000 is busy: stop the other server first (it may be an old preview from a worktree), or run on another port with `DEV_PORT=3100 pnpm dev:local` (sign-in then works on http://localhost:3100).

## Rehearsing student sign-up (`pnpm dev:local:signup`)

Same sandbox as `pnpm dev:local`, plus `STUDENT_SELF_SIGNUP_ENABLED=true` and `MAIL_TRANSPORT=log`. Emailed codes are printed to the
terminal as `[mail:log]`; nothing is sent, and any `SMTP_*` set in your shell is ignored. Flow: `/auth` → Create account →
`/age-confirm` (name and 18+) → code → `/chat` (name, password, privacy) → sign out → sign in with email and password.
