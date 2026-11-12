// Suggested follow-up questions, Derek's short-answer and uncertainty rules, and the cross-tab "has joined" notice.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { namedUniversity, planFromSubject, suggestQuestions } from '@/lib/derek/suggestions'
import { DEREK_INSTRUCTIONS } from '@/lib/derek/provider'
import { parseGeminiResponse } from '@/lib/derek/providers/gemini'
import { joinedText, onceAcrossTabs } from '@/components/support/team-presence'

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8')

describe('suggested questions', () => {
  it('use the student’s own course, university and question, and never repeat the topic just asked', () => {
    const out = suggestQuestions({ subject: 'Poland · MSc Computer Science · Instagram @asha', studentMessages: ['What are the fees at University of Warsaw?'] })
    expect(out).toHaveLength(3)
    expect(out[0]).toBe('What are the entry requirements for MSc Computer Science at University of Warsaw?')
    expect(out.every((q) => q.includes('MSc Computer Science'))).toBe(true)
    expect(out.some((q) => /tuition fees/.test(q))).toBe(false) // they just asked about fees
    expect(out.join(' ')).not.toMatch(/@asha|Instagram/) // the handle never appears
  })

  it('adapt to a different student and question', () => {
    const out = suggestQuestions({ subject: 'Germany · MBA', studentMessages: ['What are the entry requirements?'] })
    expect(out[0]).toBe('What are the tuition fees for MBA in Germany, and are there scholarships?')
    expect(out.some((q) => /entry requirements/.test(q))).toBe(false)
    // Topics already discussed earlier go last.
    const later = suggestQuestions({ subject: 'Germany · MBA', studentMessages: ['What are the fees?', 'What are the entry requirements?'] })
    expect(later[0]).toMatch(/deadlines/)
  })

  it('work from what is available when the course or university is missing, and state no facts', () => {
    const out = suggestQuestions({ subject: 'What is a statement of purpose?', studentMessages: ['What is a statement of purpose?'] })
    expect(out).toHaveLength(3)
    expect(out.every((q) => q.includes('my course') && q.endsWith('?'))).toBe(true)
    for (const q of [...out, ...suggestQuestions({ subject: 'Italy · BSc Economics', studentMessages: ['tell me about Bocconi University'] })])
      expect(q).not.toMatch(/\d|€|£|\$|₹/) // questions only, no figures
    expect(planFromSubject('Atlantis · Law')).toEqual({ destination: null, course: null })
    expect(namedUniversity(['I like Politecnico di Milano', 'and McGill University too'])).toBe('McGill University')
    expect(namedUniversity(['which university is best?'])).toBeNull()
  })

  it('are clickable and go through the normal send in the student chat', () => {
    const chat = read('components/support/student-chat.tsx')
    expect(chat).toMatch(/onClick=\{\(\) => send\(q\)\}/)
    expect(chat).toMatch(/function send\(body: string, subject\?: string\) \{\s+const item: Pending = \{ key: newKey\(\), body, subject, state: 'sending' \}/)
    expect(chat).toMatch(/send\(body, subject\)/) // typed questions use the same function
  })
})

describe('Derek answers', () => {
  it('are asked to be short and to say plainly when unsure', () => {
    expect(DEREK_INSTRUCTIONS).toMatch(/usually 2 to 4 sentences/)
    expect(DEREK_INSTRUCTIONS).toMatch(/Never present a guess as a confirmed fact/)
    expect(DEREK_INSTRUCTIONS).toMatch(/never your internal reasoning/)
  })

  it('mark a truncated answer as incomplete, so it is never sent as a preliminary answer', () => {
    const body = (text: string, finishReason = 'STOP') => ({ candidates: [{ content: { parts: [{ text }] }, finishReason }], modelVersion: 'm' })
    expect(parseGeminiResponse(body('A conditional offer is', 'MAX_TOKENS'), 'm')).toMatchObject({ uncertain: true, incomplete: true })
    expect(parseGeminiResponse(body('[UNCERTAIN] I am not sure about this.'), 'm')).toMatchObject({ uncertain: true })
    expect(parseGeminiResponse(body('[UNCERTAIN] I am not sure about this.'), 'm').incomplete).toBeUndefined()
  })
})

describe('"has joined your chat" across tabs', () => {
  it('runs once per join event however many tabs see it, and never includes a message', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
    let held = Promise.resolve()
    vi.stubGlobal('navigator', {
      locks: {
        request: (_: string, fn: () => Promise<void>) => {
          const run = held.then(fn)
          held = run.catch(() => {})
          return run
        },
      },
    })
    const shown: string[] = []
    await Promise.all([1, 2, 3].map(() => onceAcrossTabs('2026-11-12 10:00:00.000', () => shown.push('notify'))))
    expect(shown).toEqual(['notify'])
    await onceAcrossTabs('2026-11-12 10:05:00.000', () => shown.push('again')) // Dev left and came back: a new event
    expect(shown).toEqual(['notify', 'again'])
    vi.unstubAllGlobals()
    expect(joinedText('Dev')).toBe('Dev has joined your chat.')
    const src = read('components/support/team-presence.tsx')
    expect(src).toMatch(/new Notification\('LockIn', \{ body: joinedText\(name\), tag: TAG \}\)/) // no message text in the notification
    expect(src).not.toMatch(/requestPermission\(\)[^]*useEffect/) // permission is asked from a click, not on load
  })
})
