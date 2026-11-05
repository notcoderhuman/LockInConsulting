import { DESTINATIONS, type Destination } from '@/lib/destinations'
import type { EvidenceItem, QuestionGuidance } from './provider'
import { factTopicsIn } from './safeguards'

// Per-question guidance for Derek. Pure and deterministic: it decides what kind of answer the
// student needs and tells the provider how to shape it. It never adds facts; facts only ever come
// from the verified EVIDENCE (lib/derek/evidence.ts).
//
//   general             concept or process questions ("What is a conditional offer?")
//   broad_destination   "Tell me about UK universities": explain what to compare, no figures
//   specific_fact       fees, rankings, deadlines, requirements, scholarships, acceptance rates
//                       → only from evidence; without evidence, say so and ask which university/course

const ALIASES: Record<string, string[]> = {
  // No bare "us": "tell us about…" must not mean the USA.
  US: ['usa', 'u.s.', 'u.s.a.', 'united states', 'america', 'american'],
  GB: ['uk', 'u.k.', 'united kingdom', 'britain', 'british', 'england', 'scotland', 'wales'],
  CA: ['canada', 'canadian'],
  IT: ['italy', 'italian'],
  DE: ['germany', 'german'],
  AU: ['australia', 'australian'],
  NZ: ['new zealand', 'nz'],
  SA: ['saudi arabia', 'saudi', 'ksa'],
  AE: ['uae', 'u.a.e.', 'united arab emirates', 'emirates', 'dubai', 'abu dhabi'],
  FI: ['finland', 'finnish'],
  PL: ['poland', 'polish'],
}

// Dots stay inside abbreviations ("u.k.") but a sentence-ending dot is dropped, so "…in Germany."
// still names Germany. Aliases are compared without their own final dot for the same reason.
const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').replace(/\.(?= |$)/g, '').trim()} `

export function detectDestinations(text: string): Destination[] {
  const t = norm(text)
  return DESTINATIONS.filter((d) => (ALIASES[d.iso2] ?? [d.shortName.toLowerCase(), d.name.toLowerCase()]).some((a) => t.includes(` ${a.replace(/\.$/, '')} `)))
}

const STUDY_LEVEL = /\b(bachelor'?s?|undergrad\w*|ug|master'?s?|postgrad\w*|pg|mba|phd|doctora\w*|diploma|foundation|msc|ma|mres|bsc|ba|beng|meng|btech|mtech|llm|mbbs|class 12|12th)\b/i
const SUBJECT = /\b(computer|computing|cs|data|ai|engineering|business|management|finance|economics|law|medicine|nursing|psychology|design|arts?|science|biology|chemistry|physics|mathematics|maths?|marketing|accounting|architecture|history|media|hospitality)\b/i
const BROAD = /\b(tell me about|what about|overview|options?|which (country|university|universities)|best (country|universit\w*)|compare|comparison|vs\.?|versus|should i (study|go|choose))\b/i
const UNIVERSITY_WORD = /\b(universit\w*|college|institute|school of)\b/i
const CONCEPT = /^\s*(what (is|are|does|do)|what's|define|meaning of|explain|how does|how do (i|you) (write|structure))\b/i
/**
 * The study plan a student gave before their first question, read from the conversation subject the
 * homepage form writes ("Germany · MSc Computer Science · Instagram @handle"). Only a known
 * destination and the course are returned: the Instagram handle never reaches a provider.
 */
export function studentPlanFromSubject(subject: string): string | null {
  const [place, course] = subject.split(' · ').map((p) => p.trim())
  const destination = DESTINATIONS.find((d) => d.name === place)
  if (!destination || !course || /^instagram\b/i.test(course)) return null
  return `I plan to study ${course} in ${destination.shortName}.`
}

/** Target length for a country comparison: inside the 900-character automatic-send limit with room to spare. */
export const COMPARISON_TARGET_CHARS = { min: 500, max: 700 } as const

// "fees at Example University", "ranking of Nowhere U": a capitalised name after a preposition.
const NAMED_TARGET = /\b(?:at|of|for|in|from)\s+(?:the\s+)?[A-Z][\w.&'-]*/
const FOLLOW_UP = /^\s*(?:and|also|then|so|what about|how about|same (?:for|in|with)|what if|is it|are they|does it|do they|aur|uska|uske|iska|iske|wahan|waha)\b/i
const OPEN_ENDED = /\b(study abroad|help me|guide me|advice|suggest|recommend|confused|not sure|where (should|can) i|which (course|subject|country|degree)|what should i|how (do|can|should) i (start|begin|plan|apply))\b/i

/** `lastReply`: the previous Derek or team message, so the same follow-up is never asked twice in a row. */
export function analyseQuestion(question: string, evidence: EvidenceItem[], earlierStudentText = '', lastReply = ''): QuestionGuidance {
  const all = `${earlierStudentText}\n${question}`
  // A short or explicitly connected question continues the earlier one: keep its context.
  const isFollowUp = Boolean(earlierStudentText.trim()) && (FOLLOW_UP.test(question) || question.trim().split(/\s+/).length <= 4)
  const ownDestinations = detectDestinations(question).map((d) => d.shortName)
  const destinations = ownDestinations.length || !isFollowUp ? ownDestinations : detectDestinations(earlierStudentText).map((d) => d.shortName)
  const ownTopics = factTopicsIn(question)
  const topics = ownTopics.length || !isFollowUp ? ownTopics : factTopicsIn(earlierStudentText)
  // A fact about something named (a country, a university, "fees at X") needs verified evidence;
  // the same topic asked about in general gets a general answer without figures.
  const named = destinations.length > 0 || UNIVERSITY_WORD.test(question) || NAMED_TARGET.test(question) || (isFollowUp && UNIVERSITY_WORD.test(earlierStudentText))
  const hasUniversityEvidence = evidence.some((e) => e.ref.startsWith('university:'))
  const hasFactEvidence = evidence.some((e) => !e.ref.startsWith('university:') || /tuition|fee|rank|intake|deadline|acceptance|requirement/i.test(e.text))
  const knowsLevel = STUDY_LEVEL.test(all)
  const knowsSubject = SUBJECT.test(all)

  let kind: QuestionGuidance['kind']
  if (topics.length && named) kind = 'specific_fact'
  else if (destinations.length || (BROAD.test(question) && UNIVERSITY_WORD.test(question))) kind = 'broad_destination'
  else kind = 'general'

  // Concept questions ("What is a conditional offer?") need no follow-up; open-ended planning ones do.
  const openEnded = OPEN_ENDED.test(question) && !CONCEPT.test(question)
  const askFollowUp =
    (kind === 'specific_fact' && !hasFactEvidence) ||
    (kind === 'broad_destination' && !(knowsLevel && knowsSubject)) ||
    (kind === 'general' && openEnded && !(knowsLevel && knowsSubject))

  const candidate = !askFollowUp
    ? null
    : kind === 'specific_fact'
      ? 'Which university and course are you interested in?'
      : !knowsLevel && !knowsSubject
        ? 'Are you planning undergraduate or postgraduate study, and in which subject?'
        : !knowsLevel
          ? 'Are you planning undergraduate or postgraduate study?'
          : 'Which subject would you like to study?'
  const followUp = candidate && !lastReply.includes(candidate) ? candidate : null

  const where = destinations.length ? ` in ${destinations.join(' and ')}` : ''
  const notes: string[] = []
  if (isFollowUp && (ownDestinations.length < destinations.length || ownTopics.length < topics.length))
    notes.push(`Follow-up to the student's earlier message: they still mean ${[...topics, ...destinations].join(', ')}. Answer in that context; do not ask again for what they already told you.`)
  if (kind === 'general') notes.push('General question: answer it directly in plain words. Explain any term the student may not know.')
  if (kind === 'general' && topics.length)
    notes.push(`The student asks about ${topics.join(', ')} in general, not for a named university. Explain how this usually works without any figure, date, score or range, and say where the exact details are published (the official course page).`)
  const comparison = kind === 'broad_destination' && destinations.length > 1
  if (kind === 'broad_destination' && !comparison)
    notes.push(
      `Broad question about universities${where}. Explain, in general terms and without figures, the main things to compare: course content and structure, entry requirements for their level, total cost (tuition and living), location and city, and application timelines or intakes.`,
    )
  if (comparison)
    notes.push(
      `This is a comparison of ${destinations.join(' and ')}. Answer it directly in ${COMPARISON_TARGET_CHARS.min} to ${COMPARISON_TARGET_CHARS.max} characters in total: at most four short bullets, each starting with a label (for example "- Course structure:", "- Language:", "- Admissions:", "- Costs:"), and only the points where they really differ. Country-level, general terms only, no figures. Only facts in EVIDENCE may be presented as verified for a university; leave out anything else that would need a figure. No introduction and no closing summary; one short sentence at the end that exact requirements and costs vary by university and are on each official course page.`,
    )
  if (kind === 'broad_destination')
    notes.push(
      hasUniversityEvidence
        ? 'Some verified LockIn directory listings are in EVIDENCE: you may name them on the "From the LockIn directory:" line, without adding facts that are not in EVIDENCE.'
        : 'There are no verified LockIn directory listings for this, so do not name or recommend specific universities.',
    )
  if (kind === 'specific_fact')
    notes.push(
      hasFactEvidence
        ? `The student asks about ${topics.join(', ')}. Use ONLY the matching EVIDENCE lines for these facts, on the "From the LockIn directory:" line with the official source. Anything not in EVIDENCE is unknown.`
        : `The student asks about ${topics.join(', ')}${where}, but LockIn has no verified record for it. Start with [UNCERTAIN]. Say in one sentence that LockIn has not verified this yet, give brief general guidance on where to check (the official university course page), and do not give any figure, date or range.`,
    )
  const universities = new Set(evidence.filter((e) => e.ref.startsWith('university:')).map((e) => e.ref)).size
  if (kind === 'specific_fact' && universities > 1)
    notes.push(`This compares ${universities} universities. Keep each fact with its own university and source; where one has a fact the other lacks, say LockIn has not verified it for that university. Never fill a gap with another university's figure.`)
  if (followUp) notes.push(`The student's goals are not clear yet. End with exactly this one follow-up question, or a close equivalent: "${followUp}"`)
  else notes.push('Do not ask a follow-up question unless you truly need one.')

  return { kind, destinations, topics, askFollowUp: followUp != null, followUp, note: notes.join(' '), isFollowUp }
}
