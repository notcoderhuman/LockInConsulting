import { DIRECTORY_LABEL, UNVERIFIED_LABEL, type EvidenceItem } from './provider'

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

/** The stricter of two assessments, with both sets of reasons. */
export function combineRisk(a: RiskAssessment, b: RiskAssessment): RiskAssessment {
  return { level: worst(a.level, b.level), reasons: [...new Set([...a.reasons, ...b.reasons])] }
}

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

const INR_CONVERSION = 'Draft converts to INR'

const FORBIDDEN_CLAIMS:[RegExp, string][] = [
  // Derek is the AI assistant; only staff messages carry a person's identity.
  [/\b(?:i am|i'm|i’m|as) (?:a |an )?(?:human|real person|counsell?or|advis[eo]r at lockin|member of (?:the )?lockin team|lockin (?:staff|employee|counsell?or))\b/i, 'Draft claims to be a person'],
  [/\b(guarantee[ds]?|assured|certain(?:ly)? (?:get|be admitted)|100 ?% (?:chance|sure))\b/i, 'Draft makes a guarantee'],
  [/\b(you will (?:definitely )?(?:get|be (?:admitted|accepted|granted))|visa will be (?:approved|granted))\b/i, 'Draft predicts an outcome'],
  [/\b(?:scholarships?|visas?|admissions?|offers?|places?) (?:is|are) (?:guaranteed|certain|assured|sure)\b|\beasy (?:to )?(?:get|secure) (?:a |an )?(?:admission|scholarship|visa|offer)\b|\byou(?:'ll|’ll| will) (?:definitely |surely |easily )?(?:receive|win|be awarded|qualify for|secure) (?:a |an |the )?(?:scholarship|visa|admission|offer|place)\b/i, 'Draft promises admission, a scholarship or a visa'],
  // Derek never converts; an INR figure may only be quoted from an evidence line that states it (assessDraft).
  [/\b(approximately|about|around|roughly)\s+(?:INR|₹|rs\.?)\s?\d/i, INR_CONVERSION],
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

/**
 * `general`: the question asks how something usually works rather than for a named university's
 * fact (lib/derek/guidance.ts). Its answer carries no figures, and assessDraft still rejects any
 * figure that is not in the evidence, so missing evidence alone is no reason to hold it.
 */
export function assessQuestion(question: string, evidence: EvidenceItem[], { general = false }: { general?: boolean } = {}): RiskAssessment {
  let level: RiskLevel = 'low'
  const reasons: string[] = []
  for (const [re, label] of HIGH_RISK_TOPICS) if (re.test(question)) (level = worst(level, 'high')), reasons.push(label)
  for (const [re, label] of UNCERTAIN_TOPICS) if (re.test(question)) (level = worst(level, 'uncertain')), reasons.push(label)
  if (!general) for (const [re, label, evidenceRe] of FACT_TOPICS) {
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

/** A URL without trailing punctuation, as a reader would follow it. */
export const trimUrl = (u: string) => u.replace(/[),.;:!?'"’”\]]+$/, '')
const urlsIn = (text: string) => (text.match(/https?:\/\/\S+/gi) ?? []).map(trimUrl)

/** Every link a draft may cite: the evidence sources and the official pages named inside evidence. */
export function evidenceUrls(evidence: EvidenceItem[]): Set<string> {
  return new Set(evidence.flatMap((e) => [trimUrl(e.sourceUrl), ...urlsIn(e.text)]))
}

const hasFigure = (text: string) => {
  const t = text.replace(/https?:\/\/\S+/g, ' ')
  return FIGURE_PATTERNS.some((re) => new RegExp(re.source, re.flags.replace('g', '')).test(t))
}

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

/**
 * A fact from a draft record (EvidenceItem.unverified) may appear only under UNVERIFIED_LABEL or on a
 * line that itself says it is unverified. Anywhere else (including under the directory label) a
 * figure or source link that only a draft record supports reads as verified.
 */
export function draftPresentedAsVerified(draft: string, evidence: EvidenceItem[]): boolean {
  if (!evidence.some((e) => e.unverified)) return false
  const verified = evidence.filter((e) => !e.unverified)
  const verifiedUrls = evidenceUrls(verified)
  const draftUrls = new Set([...evidenceUrls(evidence)].filter((u) => !verifiedUrls.has(u)))
  let section: 'other' | 'unverified' = 'other'
  for (const line of draft.split('\n')) {
    if (line.includes(UNVERIFIED_LABEL)) section = 'unverified'
    else if (line.includes(DIRECTORY_LABEL)) section = 'other'
    else if (section !== 'unverified' && !/\bunverified\b|not yet checked/i.test(line))
      if (urlsIn(line).some((u) => draftUrls.has(u)) || unsupportedFigures(line, verified).length) return true
  }
  return false
}

/** The reason assessDraft records when the model itself said it was not sure (the [UNCERTAIN] marker). */
export const MODEL_UNCERTAIN_REASON = 'Derek reported it could not answer from the evidence'

export function assessDraft(
  draft: string,
  question: RiskAssessment,
  evidence: EvidenceItem[],
  { modelUncertain = false }: { modelUncertain?: boolean } = {},
): RiskAssessment {
  let level = question.level
  const reasons = [...question.reasons]
  if (modelUncertain) (level = worst(level, 'uncertain')), reasons.push(MODEL_UNCERTAIN_REASON)
  const quotesInr = evidence.some((e) => e.ref.endsWith(':inr'))
  for (const [re, label] of FORBIDDEN_CLAIMS)
    if (re.test(draft) && !(label === INR_CONVERSION && quotesInr)) (level = worst(level, 'high')), reasons.push(label)
  // Every sourced fact names its source: each line under the directory label, and any figure at all.
  if (evidence.length) {
    const allowed = evidenceUrls(evidence)
    const cites = (text: string) => urlsIn(text).some((u) => allowed.has(u))
    const sourced = draft.split(DIRECTORY_LABEL).slice(1).join('\n')
    const unsourcedLine = sourced.split('\n').some((l) => /^\s*-\s/.test(l) && !cites(l))
    if (unsourcedLine || (sourced.trim() && !cites(sourced)) || (hasFigure(draft) && !cites(draft)))
      (level = worst(level, 'uncertain')), reasons.push('Directory facts without their official source reference')
  }
  const verified = evidence.filter((e) => !e.unverified)
  if (!verified.length && (draft.includes(DIRECTORY_LABEL) || /\b(lockin|our directory) (has )?(verified|confirms?)\b|\bverified by lockin\b/i.test(draft)))
    (level = worst(level, 'high')), reasons.push('Draft claims LockIn-verified information, but no verified evidence was provided')
  if (draftPresentedAsVerified(draft, evidence))
    (level = worst(level, 'high')), reasons.push('An unverified draft record is presented without its "not yet checked by LockIn" label')
  const invented = unsupportedFigures(draft, evidence)
  if (invented.length) {
    level = worst(level, 'high')
    reasons.push(`Figures not found in verified evidence: ${invented.slice(0, 5).join(', ')}`)
  }
  return { level, reasons: [...new Set(reasons)] }
}
