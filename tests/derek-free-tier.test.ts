// Gemini free-tier mode: what may and may not leave for Google, and when Derek counts as ready.
import { describe, expect, it } from 'vitest'
import { getDerekStatus } from '@/lib/derek/config'
import { screenForFreeTier } from '@/lib/derek/free-tier'

describe('free-tier screening', () => {
  const student = { displayName: 'Meera Iyer', email: 'meera.iyer@example.com' }

  it('lets general public-information questions through', () => {
    for (const q of [
      'What are the tuition fees for engineering at the University of Toronto?',
      'Do I need IELTS for a master’s in Germany?',
      'What is the deadline for the fall intake in Canada?',
      'How does the UK Graduate Route work?',
      'Which cities in Italy are cheaper for students?',
      'Is a transcript required for admission to Polish universities?',
      'What does a conditional offer mean?',
    ])
      expect(screenForFreeTier(q, student), q).toBeNull()
  })

  it('holds back anything personal, so a person answers it', () => {
    for (const q of [
      'My email is asha@example.com, please reply there',
      'Call me on +91 99999 12345',
      'my number is 9999912345',
      'My name is Asha and I want to study in Canada',
      'I scored 82% in class 12, can I get into Toronto?',
      'My IELTS is 6.5 and my CGPA is 7.8',
      'Our family income is 6 lakh, can I get a scholarship?',
      'My budget is 20 lakh for the whole course',
      'My visa was refused last year, what now?',
      'I have a health condition, will that matter?',
      'I am attaching my passport and marksheet',
      'here is my transcript',
      'My passport number is K1234567',
      'My instagram is @asha_study',
      'I live in Agra, which is the nearest centre?',
      'Please tell Meera about fees',
      'is meera.iyer allowed to apply?',
    ])
      expect(screenForFreeTier(q, student), q).not.toBeNull()
  })

  it('explains what it found without repeating the text', () => {
    expect(screenForFreeTier('write to asha@example.com')).toMatch(/^free tier: .*email address$/)
    expect(screenForFreeTier('write to asha@example.com')).not.toContain('asha@')
  })
})

describe('free-tier readiness', () => {
  const base = { DEREK_AI_ENABLED: 'true', DEREK_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', NODE_ENV: 'production', DEREK_PROVIDER_APPROVED: 'gemini' }

  it('needs either billing or the Owner’s recorded free-tier acceptance, and never calls an unpaid key paid', () => {
    expect(getDerekStatus(base).state).toBe('blocked')
    expect(getDerekStatus({ ...base, GEMINI_PAID_TIER: 'true' })).toMatchObject({ state: 'ready', freeTier: false })
    const free = getDerekStatus({ ...base, GEMINI_FREE_TIER_ACCEPTED: 'true' })
    expect(free).toMatchObject({ state: 'ready', freeTier: true })
    expect(free.state === 'ready' && free.notes.join(' ')).toMatch(/Free tier: Google may store/)
    // Billing wins if both are set: that is the paid path.
    expect(getDerekStatus({ ...base, GEMINI_PAID_TIER: 'true', GEMINI_FREE_TIER_ACCEPTED: 'true' })).toMatchObject({ freeTier: false })
    // The free-tier flag cannot stand in for the provider approval.
    expect(getDerekStatus({ ...base, DEREK_PROVIDER_APPROVED: undefined, GEMINI_FREE_TIER_ACCEPTED: 'true' }).state).toBe('blocked')
  })
})
