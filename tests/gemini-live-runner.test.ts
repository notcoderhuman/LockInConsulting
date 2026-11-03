// The live Gemini runner must never "pass" by skipping everything (regression: `-t comparison`
// matched no title, so Vitest reported 6 skipped). No key, database or network call here.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { liveTestTitles, namePattern, selectedTitles } from '../scripts/gemini-live-filter.mjs'

const ROOT = path.join(__dirname, '..')
const source = readFileSync(path.join(ROOT, 'tests/db/gemini-live.db.test.ts'), 'utf8')
const titles = liveTestTitles(source)
const TAGS = ['config', 'greeting', 'ordinary', 'comparison', 'visa', 'handoff']

const runRunner = (args: string[]) => {
  const env = { ...process.env }
  delete env.GEMINI_API_KEY // never needed here; the runner must stop before any call
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts/gemini-live.mjs'), ...args], { cwd: ROOT, env, encoding: 'utf8' })
}

describe('live Gemini runner', () => {
  it('every live test starts with a unique tag, and each tag selects exactly that test', () => {
    expect(titles.map((t) => t.split(':')[0])).toEqual(TAGS)
    for (const tag of TAGS) expect(selectedTitles(['-t', tag], titles), tag).toEqual([titles.find((t) => t.startsWith(`${tag}:`))])
    expect(selectedTitles([], titles)).toEqual(titles)
  })

  it('reads every filter form Vitest accepts, and finds nothing for a wrong or broken pattern', () => {
    expect(namePattern(['-t', 'comparison'])).toBe('comparison')
    expect(namePattern(['--testNamePattern=comparison'])).toBe('comparison')
    expect(namePattern(['-t=comparison'])).toBe('comparison')
    expect(namePattern(['--reporter', 'verbose'])).toBeNull()
    expect(selectedTitles(['-t', 'comparisons-typo'], titles)).toEqual([])
    expect(selectedTitles(['-t', '('], titles)).toEqual([])
  })

  it('the comparison test makes one Derek run with at most two attempts (answer + one rewrite), then restores one', () => {
    const block = source.slice(source.indexOf("it('comparison:"), source.indexOf("it('visa:"))
    expect(block.match(/\brun\(/g)).toHaveLength(1)
    expect(block).not.toMatch(/handOffToDerek|prepareDerekDraft/)
    expect(block).toContain("process.env.DEREK_MAX_ATTEMPTS = '2'")
    expect(block).toMatch(/finally \{\s*process\.env\.DEREK_MAX_ATTEMPTS = '1'/)
    expect(block).toContain('expect(sent).toBeLessThanOrEqual(2)')
    // Every other live test keeps the suite-wide single attempt.
    expect(source).toContain("DEREK_MAX_ATTEMPTS: '1'")
  })

  it('refuses a filter that matches nothing before checking the key or starting anything', () => {
    const bad = runRunner(['-t', 'comparisons-typo'])
    expect(bad.status).toBe(1)
    expect(bad.stderr).toMatch(/No live test matches the filter "comparisons-typo"/)
    expect(bad.stderr).toMatch(/comparison/)
    // A correct filter gets as far as the key check, and stops there without a key.
    const noKey = runRunner(['-t', 'comparison'])
    expect(noKey.status).toBe(1)
    expect(noKey.stderr).toMatch(/GEMINI_API_KEY is not set/)
  })
})
