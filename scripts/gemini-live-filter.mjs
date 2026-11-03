// Checks a `-t` / `--testNamePattern` filter for the live Gemini smoke test BEFORE anything starts.
// Vitest silently skips every test when a filter matches none ("6 skipped"), which looks like a
// pass; the runner refuses instead and lists the valid tags. Pure, so tests/gemini-live-runner.test.ts
// can check it without a key, a database or a network call.

export const LIVE_SUITE = 'LIVE Gemini smoke test (synthetic data)'

/** Test titles declared in the live test file, e.g. "comparison: compares two countries…". */
export function liveTestTitles(source) {
  return [...source.matchAll(/^\s*it\('([^']+)'/gm)].map((m) => m[1])
}

/** The name pattern Vitest will use, or null when the run is not filtered. */
export function namePattern(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-t' || a === '--testNamePattern') return args[i + 1] ?? ''
    if (a.startsWith('--testNamePattern=')) return a.slice('--testNamePattern='.length)
    if (a.startsWith('-t=')) return a.slice(3)
  }
  return null
}

/** Titles the filter selects, matched the way Vitest does (a RegExp against "<suite> <title>"). */
export function selectedTitles(args, titles) {
  const pattern = namePattern(args)
  if (pattern === null) return titles
  let re
  try {
    re = new RegExp(pattern)
  } catch {
    return []
  }
  return titles.filter((t) => re.test(`${LIVE_SUITE} ${t}`))
}
