import { DIRECTORY_LABEL, type EvidenceItem } from './provider'

// Server-side checks on every question and every draft, independent of the model's own behaviour.
//
//   high       never auto-sent; flagged to reviewers as high-risk
//   uncertain  never auto-sent; routed to human review
//   low        may be auto-sent only when automatic replies are fully permitted
//
// The most important rule: any figure in a draft (money, percentage, rank, test score, date) must
// appear in the verified evidence it was given. Anything else is treated as invented.

export type RiskLevel = 'low' | 'uncertain' | 'high'

export interface RiskAssessment {
  level: RiskLevel
  reasons: string[]
}

const ORDER: Record<RiskLevel, number> = { low: 0, uncertain: 1, high: 2 }
const worst = (a: RiskLevel, b: RiskLevel): RiskLevel => (ORDER[a] >= ORDER[b] ? a : b)

const HIGH_RISK_TOPICS: [RegExp, string][] = [
  [/\b(visa|immigration|immigrate|work permit|study permit|residence permit|permanent residen|\bpr\b|deport|asylum|overstay)/i, 'Visa or immigration question'],
  [/\b(suicid|kill myself|self[- ]?harm|hurt myself|end my life|hopeless|abuse[ds]?)\b/i, 'Possible distress or safeguarding concern'],
  [/\b(lawyer|legal action|sue|court|fraud|scam)\b/i, 'Legal question'],
  [/\b(refund|payment|bank|loan|pay (?:the )?fee)\b/i, 'Payment or financial question'],
]

const UNCERTAIN_TOPICS: [RegExp, string][] = [
  [/\b(chance|chances|probability|likely|odds|will i get (?:in|admitted|accepted)|can i get in)\b/i, 'Admission-probability question'],
  [/\b(guarantee|guaranteed|assured)\b/i, 'Asks for a guarantee'],
]

// Questions that need a directory fact; without matching evidence the answer is "unknown".
// Each pattern allows plurals and word stems (e.g. "requirements", "eligible", "expensive").
const FACT_TOPICS: [RegExp, string, RegExp][] = [
  [/\b(fees?|tuition|costs?|price[sd]?|expens\w*|living costs?|rent)\b/i, 'fees or costs', /tuition|fee/i],
  [/\b(rank\w*|qs|times higher education)\b/i, 'rankings', /rank/i],
  [/\b(deadlines?|intakes?|apply by|closing dates?|application dates?|last date)\b/i, 'intakes or deadlines', /intake|deadline/i],
  [/\b(acceptance rates?|admit rates?|selectiv\w*)\b/i, 'acceptance rates', /acceptance/i],
  [/\b(requirements?|ielts|toefl|pte|duolingo|gpa|cgpa|grades?|percentage needed|minimum marks|eligib\w*|cut-?offs?)\b/i, 'entry or language requirements', /requirement/i],
  [/\b(scholarships?|bursar\w*|funding|financial aid)\b/i, 'scholarships', /scholarship/i],
]

/** The factual topics (fees, rankings, deadlines…) a question asks about. */
export function factTopicsIn(text: string): string[] {
  return FACT_TOPICS.filter(([re]) => re.test(text)).map(([, label]) => label)
}

const FORBIDDEN_CLAIMS: [RegExp, string][] = [
  [/\b(guarantee[ds]?|assured|certain(?:ly)? (?:get|be admitted)|100 ?% (?:chance|sure))\b/i, 'Draft makes a guarantee'],
  [/\b(you will (?:definitely )?(?:get|be (?:admitted|accepted|granted))|visa will be (?:approved|granted))\b/i, 'Draft predicts an outcome'],
  [/\b(approximately|about|around|roughly)\s+(?:INR|₹|rs\.?)\s?\d/i, 'Draft converts to INR'],
  // Visa and work-rights rules change and are never in the directory: any number beside one is invented.
  [/\b(visas?|work permits?|work rights?|post-?study work|psw|graduate route|stay[- ]back|part-?time work)\b[^.\n]{0,80}\d|\d+\s*(?:hours?|hrs?)\s*(?:a|per)\s*week/i, 'Draft states a visa or work-rights rule'],
]

/** Removes contact details before text is passed to any provider. */
export function redactPersonalData(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, '[number removed]')
    .replace(/\b[A-Z][0-9]{7}\b/g, '[document number removed]')
}

export function assessQuestion(question: string, evidence: EvidenceItem[]): RiskAssessment {
  let level: RiskLevel = 'low'
  const reasons: string[] = []
  for (const [re, label] of HIGH_RISK_TOPICS) if (re.test(question)) (level = worst(level, 'high')), reasons.push(label)
  for (const [re, label] of UNCERTAIN_TOPICS) if (re.test(question)) (level = worst(level, 'uncertain')), reasons.push(label)
  for (const [re, label, evidenceRe] of FACT_TOPICS) {
    if (re.test(question) && !evidence.some((e) => evidenceRe.test(e.ref) || evidenceRe.test(e.text))) {
      level = worst(level, 'uncertain')
      reasons.push(`No verified evidence for ${label}`)
    }
  }
  return { level, reasons }
}

// Figures that must be backed by evidence. Each match is reduced to its digits for comparison.
const FIGURE_PATTERNS: RegExp[] = [
  /(?:[$€£₹]|\b(?:USD|EUR|GBP|INR|CAD|AUD|NZD|PLN|SAR|AED|Rs\.?)\b)\s?\d[\d,]*(?:\.\d+)?/gi, // money
  /\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b)/gi, // percentages
  /(?:#\s?\d+|\b(?:rank(?:ed|ing)?|position|top)\s+(?:#\s?)?\d+)/gi, // ranks
  /\b(?:IELTS|TOEFL|PTE|Duolingo|GPA|CGPA|GRE|GMAT|SAT)\b[^.\n\d]{0,20}\d+(?:\.\d+)?/gi, // test scores
  /\b\d[\d,]{2,}(?:\.\d+)?\b/g, // any other large number (e.g. a bare fee)
  // dates such as "15 January", "1st of March" or "January 15th" (invented deadlines)
  /\b\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
]

const digits = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map((d) => d.replace(/^0+(?=\d)/, ''))

export function unsupportedFigures(draft: string, evidence: EvidenceItem[]): string[] {
  const allowed = new Set<string>()
  for (const e of evidence) for (const n of digits(`${e.text} ${e.checkedAt}`.replace(/,/g, ''))) allowed.add(n)
  const unsupported = new Set<string>()
  // Years and dates are allowed only if present too, but URLs are excluded from the check.
  const text = draft.replace(/https?:\/\/\S+/g, ' ')
  for (const re of FIGURE_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const nums = digits(match[0].replace(/,/g, ''))
      if (nums.some((n) => !allowed.has(n))) unsupported.add(match[0].trim())
    }
  }
  return [...unsupported]
}

export function assessDraft(
  draft: string,
  question: RiskAssessment,
  evidence: EvidenceItem[],
  { modelUncertain = false }: { modelUncertain?: boolean } = {},
): RiskAssessment {
  let level = question.level
  const reasons = [...question.reasons]
  if (modelUncertain) (level = worst(level, 'uncertain')), reasons.push('Derek reported it could not answer from the evidence')
  for (const [re, label] of FORBIDDEN_CLAIMS) if (re.test(draft)) (level = worst(level, 'high')), reasons.push(label)
  if (!evidence.length && (draft.includes(DIRECTORY_LABEL) || /\b(lockin|our directory) (has )?(verified|confirms?)\b|\bverified by lockin\b/i.test(draft)))
    (level = worst(level, 'high')), reasons.push('Draft claims LockIn-verified information, but no verified evidence was provided')
  const invented = unsupportedFigures(draft, evidence)
  if (invented.length) {
    level = worst(level, 'high')
    reasons.push(`Figures not found in verified evidence: ${invented.slice(0, 5).join(', ')}`)
  }
  return { level, reasons: [...new Set(reasons)] }
}
