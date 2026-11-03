// pnpm test:gemini-live — the LIVE Gemini smoke test (tests/db/gemini-live.db.test.ts).
// Real API, synthetic data, throwaway database, at most 5 requests. Needs GEMINI_API_KEY in this
// shell only (see docs/ENVIRONMENT.md); the key is never printed or written anywhere.
// Extra arguments go to Vitest. Each live test starts with a tag, so one can run alone, e.g.
//   pnpm test:gemini-live -- -t comparison     (the comparison only: 1 request, 2 if it is shortened)
// A filter that matches no test is refused here, before any database or API call.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { liveTestTitles, namePattern, selectedTitles } from './gemini-live-filter.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const testFile = 'tests/db/gemini-live.db.test.ts'
const args = process.argv.slice(2)

const titles = liveTestTitles(readFileSync(path.join(root, testFile), 'utf8'))
const selected = selectedTitles(args, titles)
if (!selected.length) {
  console.error(`No live test matches the filter "${namePattern(args)}". Use one of these tags with -t:`)
  for (const t of titles) console.error(`  ${t.split(':')[0]}`)
  process.exit(1)
}
if (!process.env.GEMINI_API_KEY?.trim()) {
  console.error('GEMINI_API_KEY is not set in this shell. See docs/ENVIRONMENT.md → "Live Gemini smoke test".')
  process.exit(1)
}
if (process.env.NODE_ENV === 'production') {
  console.error('The smoke test is for a local machine only.')
  process.exit(1)
}
console.log(`Running ${selected.length} live test(s): ${selected.map((t) => t.split(':')[0]).join(', ')}`)
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')
const child = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.db.config.mts', testFile, ...args], {
  cwd: root,
  env: { ...process.env, GEMINI_LIVE_SMOKE: '1' },
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 1))
