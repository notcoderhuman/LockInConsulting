// Gemini free-tier mode. Google's terms for the unpaid Gemini API let it store the input, have people read it and
// use it to improve its products, and say not to submit personal, sensitive or confidential information. So when
// LockIn runs Derek on the free tier (GEMINI_FREE_TIER_ACCEPTED=true, GEMINI_PAID_TIER unset) the server:
//   - sends Google only the current question (after the screening below), public directory facts and LockIn's
//     fixed instructions: no history, no name, no email, no ids, no timestamps, no student plan;
//   - withholds the question from Google altogether when it looks personal, so a person answers it instead;
//   - needs the student to have accepted the current privacy notice, which tells them all of this.
// The screening is deliberately blunt: a false alarm costs a human reply, a miss costs a student's privacy.
// shortcut: pattern matching, not a classifier; extend the lists when a real question slips through.

export const FREE_TIER_HOLD_CODE = 'withheld_private'

export interface StudentIdentity {
  displayName?: string | null
  email?: string | null
}

const PATTERNS: [RegExp, string][] = [
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, 'an email address'],
  [/(^|\s)@[a-z0-9_.]{3,}/i, 'a social media handle'],
  [/\+?\d[\d\s().-]{7,}\d/, 'a phone or ID number'],
  [/\d{8,}/, 'a long number'],
  [/\b[A-Z][0-9]{7}\b/i, 'a passport-style number'],
  [/\b(?:my name is|call me|i am called|name\s*:)/i, 'a name'],
  [/\b(?:date of birth|dob|born (?:in|on)|my age|i am \d{1,2} years|i['’]m \d{1,2}\b|my address|i live (?:at|in)|pin ?code|my (?:phone|mobile|whatsapp|instagram|insta|handle))\b/i, 'personal details'],
  [
    /\b(?:my|i have|i['’]ve|i got|i scored|i secured|we have|our)\b[^.?!\n]{0,60}\b(?:marks?|percentage|percent|cgpa|gpa|grades?|scored?|ielts|toefl|pte|duolingo|gre|gmat|sat|jee|neet|cuet|backlogs?)\b/i,
    'academic results',
  ],
  [/\b(?:i|we)\s+(?:scored|got|secured|obtained)\b[^.?!\n]{0,20}\d/i, 'academic results'],
  [/\b(?:ielts|toefl|pte|duolingo|gre|gmat|sat|cgpa|gpa)\b\s*(?:of|is|score|:)?\s*\d/i, 'a test score or grade'],
  [
    /\b(?:my|i have|i['’]ve|we have|our|my family)\b[^.?!\n]{0,60}\b(?:income|salary|bank|loan|savings?|sponsor(?:s|ship)?|budget|balance|earns?|funds?)\b/i,
    'financial details',
  ],
  [
    /\b(?:my|i have|i['’]ve|i am|i was|i['’]m)\b[^.?!\n]{0,60}\b(?:visa (?:was )?(?:refus|reject)\w*|refused|rejected|deport\w*|overstay\w*|criminal|arrest\w*|medical|diagnos\w*|disabilit\w*|pregnan\w*|health (?:condition|issue|problem)s?|mental health|depress\w*|anxiety)\b/i,
    'immigration, legal or health details',
  ],
  [/\b(?:my|attached|enclosed|here is|here are)\b[^.?!\n]{0,40}\b(?:passport|aadhaar|aadhar|pan card|transcripts?|mark ?sheets?|sop|statement of purpose|cv|resume|certificates?|offer letter|bank statement)\b/i, 'a document'],
  [/\b(?:attached|attachment|uploaded|uploading)\b/i, 'a document'],
]

/**
 * Why this question must not go to Google (a short reason for the team), or null when it may.
 * `student` adds the person's own name and email, which are never allowed in the text.
 */
export function screenForFreeTier(text: string, student: StudentIdentity = {}): string | null {
  for (const [pattern, what] of PATTERNS) if (pattern.test(text)) return `free tier: the question appears to contain ${what}`
  const lower = text.toLowerCase()
  const name = (student.displayName ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 3)
  if (name.some((part) => new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower))) return 'free tier: the question appears to contain the student’s name'
  const local = (student.email ?? '').split('@')[0].toLowerCase()
  if (local.length >= 4 && lower.includes(local)) return 'free tier: the question appears to contain the student’s email'
  return null
}
