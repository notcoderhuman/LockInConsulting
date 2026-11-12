import { DESTINATIONS } from '@/lib/destinations'

// Follow-up questions offered to a student after Derek answers (Owner request, 12 Nov 2026). Pure and
// deterministic: no model call, no facts. Each suggestion is a QUESTION built from what the student already told
// LockIn (destination and course from the first-question form, a university they named) and steers to the next
// useful topic after the one they just asked about. Nothing here states a requirement, fee or date.

export interface SuggestionContext {
  /** The conversation subject the first-question form writes: "Germany · MSc Computer Science · Instagram @x". */
  subject: string
  /** The student's own messages, oldest first; the last one is the question Derek just answered. */
  studentMessages: string[]
}

type Topic = 'requirements' | 'fees' | 'deadlines' | 'careers' | 'next_steps'

const TOPIC_PATTERNS: Record<Topic, RegExp> = {
  requirements: /\b(requirement|eligib\w*|entry|admission criteria|ielts|toefl|pte|gre|gmat|gpa|cgpa|percentage|marks|qualif\w*)\b/i,
  fees: /\b(fee|fees|tuition|cost|costs|afford\w*|scholarship\w*|funding|loan|budget)\b/i,
  deadlines: /\b(deadline\w*|intake\w*|last date|documents?|sop|lor|transcripts?|when (?:can|should|do) i apply)\b/i,
  careers: /\b(career\w*|jobs?|placement\w*|salary|salaries|employ\w*|work after|post[- ]?study)\b/i,
  next_steps: /\b(next steps?|how (?:do|can|should) i apply|application process|apply)\b/i,
}

// What a student usually needs after each kind of question.
const NEXT: Record<Topic | 'none', Topic[]> = {
  requirements: ['fees', 'deadlines', 'next_steps', 'careers'],
  fees: ['requirements', 'deadlines', 'careers', 'next_steps'],
  deadlines: ['requirements', 'fees', 'next_steps', 'careers'],
  careers: ['requirements', 'fees', 'next_steps', 'deadlines'],
  next_steps: ['deadlines', 'requirements', 'fees', 'careers'],
  none: ['requirements', 'fees', 'deadlines', 'careers', 'next_steps'],
}

// "University of Warsaw", "Technical University of Munich", "Politecnico di Milano", "McGill University".
const UNIVERSITY_NAME =
  /\b((?:[A-Z][\w'’.-]*\s+){0,3}(?:University|Universität|Università|Universidad|Uniwersytet|Politecnico|Politechnika|Institute|College)(?:\s+(?:of|di|de|der|des|for|and|&)\s+[A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3}|\s+[A-Z][\w'’.-]*){0,2})/

/** The university the student most recently named, if any (their own words, never looked up). */
export function namedUniversity(messages: string[]): string | null {
  for (const text of [...messages].reverse()) {
    const m = text.match(UNIVERSITY_NAME)
    const name = m?.[1]?.trim().replace(/[.,;:!?]+$/, '')
    // A bare "University" or "college" is not a name.
    if (name && name.split(/\s+/).length >= 2 && name.length <= 80) return name
  }
  return null
}

function topicOf(text: string): Topic | null {
  for (const t of Object.keys(TOPIC_PATTERNS) as Topic[]) if (TOPIC_PATTERNS[t].test(text)) return t
  return null
}

/** Destination and course from the subject, only when the form wrote them. */
export function planFromSubject(subject: string): { destination: string | null; course: string | null } {
  const [place, course] = subject.split(' · ').map((p) => p.trim())
  const destination = DESTINATIONS.find((d) => d.name === place)?.shortName ?? null
  return { destination, course: destination && course && !/^instagram\b/i.test(course) ? course.slice(0, 80) : null }
}

/** Two or three short follow-up questions for this student, specific to their course, university and question. */
export function suggestQuestions({ subject, studentMessages }: SuggestionContext): string[] {
  const { destination, course } = planFromSubject(subject)
  const university = namedUniversity(studentMessages)
  const latest = studentMessages.at(-1) ?? ''
  const asked = new Set(studentMessages.slice(0, -1).map(topicOf).filter((t): t is Topic => t != null))
  const current = topicOf(latest)

  const what = course ?? 'my course'
  const where = university ? ` at ${university}` : destination ? ` in ${destination}` : ''
  const text: Record<Topic, string> = {
    requirements: `What are the entry requirements for ${what}${where}?`,
    fees: `What are the tuition fees for ${what}${where}, and are there scholarships?`,
    deadlines: `What are the application deadlines for ${what}${where}, and which documents do I need?`,
    careers: `What career options are there after ${what}${destination ? ` in ${destination}` : ''}?`,
    next_steps: `What are my next steps to apply for ${what}${where}?`,
  }
  // Topics not discussed yet first, then the rest, never the one just asked about.
  const order = NEXT[current ?? 'none'].filter((t) => t !== current)
  const ranked = [...order.filter((t) => !asked.has(t)), ...order.filter((t) => asked.has(t))]
  const already = new Set(studentMessages.map((m) => m.trim().toLowerCase()))
  return ranked
    .map((t) => text[t])
    .filter((q) => !already.has(q.toLowerCase()))
    .slice(0, 3)
}
