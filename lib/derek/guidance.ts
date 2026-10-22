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

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim()} `

export function detectDestinations(text: string): Destination[] {
  const t = norm(text)
  return DESTINATIONS.filter((d) => (ALIASES[d.iso2] ?? [d.shortName.toLowerCase(), d.name.toLowerCase()]).some((a) => t.includes(` ${a} `)))
}

const STUDY_LEVEL = /\b(bachelor'?s?|undergrad\w*|ug|master'?s?|postgrad\w*|pg|mba|phd|doctora\w*|diploma|foundation|msc|ma|mres|bsc|ba|beng|meng|btech|mtech|llm|mbbs|class 12|12th)\b/i
const SUBJECT = /\b(computer|data|ai|engineering|business|management|finance|economics|law|medicine|nursing|psychology|design|arts?|science|biology|chemistry|physics|mathematics|maths?|marketing|accounting|architecture|history|media|hospitality)\b/i
const BROAD = /\b(tell me about|what about|overview|options?|which (country|university|universities)|best (country|universit\w*)|compare|comparison|vs\.?|versus|should i (study|go|choose))\b/i
const UNIVERSITY_WORD = /\b(universit\w*|college|institute|school of)\b/i
const CONCEPT = /^\s*(what (is|are|does|do)|what's|define|meaning of|explain|how does|how do (i|you) (write|structure))\b/i
const OPEN_ENDED = /\b(study abroad|help me|guide me|advice|suggest|recommend|confused|not sure|where (should|can) i|which (course|subject|country|degree)|what should i|how (do|can|should) i (start|begin|plan|apply))\b/i

export function analyseQuestion(question: string, evidence: EvidenceItem[], earlierStudentText = ''): QuestionGuidance {
  const all = `${earlierStudentText}\n${question}`
  const destinations = detectDestinations(question).map((d) => d.shortName)
  const topics = factTopicsIn(question)
  const hasUniversityEvidence = evidence.some((e) => e.ref.startsWith('university:'))
  const hasFactEvidence = evidence.some((e) => !e.ref.startsWith('university:') || /tuition|fee|rank|intake|deadline|acceptance|requirement/i.test(e.text))
  const knowsLevel = STUDY_LEVEL.test(all)
  const knowsSubject = SUBJECT.test(all)

  let kind: QuestionGuidance['kind']
  if (topics.length) kind = 'specific_fact'
  else if (destinations.length || (BROAD.test(question) && UNIVERSITY_WORD.test(question))) kind = 'broad_destination'
  else kind = 'general'

  // Concept questions ("What is a conditional offer?") need no follow-up; open-ended planning ones do.
  const openEnded = OPEN_ENDED.test(question) && !CONCEPT.test(question)
  const askFollowUp =
    (kind === 'specific_fact' && !hasFactEvidence) ||
    (kind === 'broad_destination' && !(knowsLevel && knowsSubject)) ||
    (kind === 'general' && openEnded && !(knowsLevel && knowsSubject))

  const followUp = !askFollowUp
    ? null
    : kind === 'specific_fact'
      ? 'Which university and course are you interested in?'
      : !knowsLevel && !knowsSubject
        ? 'Are you planning undergraduate or postgraduate study, and in which subject?'
        : !knowsLevel
          ? 'Are you planning undergraduate or postgraduate study?'
          : 'Which subject would you like to study?'

  const where = destinations.length ? ` in ${destinations.join(' and ')}` : ''
  const notes: string[] = []
  if (kind === 'general') notes.push('General question: answer it directly in plain words. Explain any term the student may not know.')
  if (kind === 'broad_destination')
    notes.push(
      `Broad question about universities${where}. Explain, in general terms and without figures, the main things to compare: course content and structure, entry requirements for their level, total cost (tuition and living), location and city, and application timelines or intakes.`,
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
  if (followUp) notes.push(`The student's goals are not clear yet. End with exactly this one follow-up question, or a close equivalent: "${followUp}"`)
  else notes.push('Do not ask a follow-up question unless you truly need one.')

  return { kind, destinations, topics, askFollowUp, followUp, note: notes.join(' ') }
}
