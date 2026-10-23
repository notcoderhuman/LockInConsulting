// Deterministic scope and risk classification of a student's message, run BEFORE any provider is
// contacted. The model's own instructions are a second line of defence, never the first.
//
//   off_topic   clearly unrelated (coding, games, entertainment, politics…) or an attempt to
//               override Derek's role → a fixed refusal; no provider call
//   greeting    a bare greeting → one fixed clarifying question; no provider call
//   in_scope    mentions study abroad, universities, courses, admissions… → normal drafting
//   unclear     neither → drafted for review, never sent automatically
//
// English, Hindi (Devanagari) and Hinglish (romanised Hindi) are recognised. Anything that is not
// plainly English is "uncertain" for automatic sending: the keyword lists below cannot promise to
// catch every Hindi or Hinglish way of asking about a visa or describing distress, so a person
// reads it first. Message text is untrusted: it is classified, never obeyed.

import type { RiskAssessment } from './safeguards'

export type Scope = 'in_scope' | 'off_topic' | 'greeting' | 'unclear'
export type Language = 'en' | 'hi' | 'hinglish'

export interface MessageClassification {
  scope: Scope
  language: Language
  /** Text that tries to change Derek's role or instructions. */
  injection: boolean
  /** High-risk topics in any supported language (visa, legal, distress, payments, safety). */
  highRisk: string[]
}

export const OFF_TOPIC_REPLY =
  "I'm Derek, LockIn Consulting's study-abroad assistant. I can help with universities, courses, admissions and studying abroad, but I can't assist with unrelated topics. What would you like to know about studying abroad?"

export const CLARIFY_REPLY =
  "I'm Derek, LockIn Consulting's AI assistant for studying abroad. What would you like help with: choosing a country or university, a course, or your application?"

const norm = (text: string) => text.normalize('NFKC').toLowerCase()

// Words that put a message inside LockIn's service. Romanised Hindi spellings vary, so stems are used.
const STUDY = [
  /\b(universit\w*|uni|college\w*|campus\w*|course\w*|programme\w*|degree\w*|bachelor\w*|master\w*|masters|undergrad\w*|postgrad\w*|ug|pg|phd|doctorate|diploma\w*|foundation year|mba|msc|ms in|bsc|btech|mtech|llm)\b/,
  /\b(admission\w*|admit\w*|apply\w*|appl(y|ie|ication)\w*|offer letter|conditional offer|unconditional offer|intake\w*|deadline\w*|enrol\w*|shortlist\w*)\b/,
  /\b(sop|statement of purpose|lor|letter of recommendation|recommendation letter|cv|resume|portfolio|transcript\w*|personal statement)\b/,
  /\b(ielts|toefl|pte|duolingo|gre|gmat|cgpa|gpa|backlog\w*)\b/,
  /\b(scholarship\w*|bursar\w*|tuition|fees?|stipend\w*|assistantship\w*|education loan|living cost\w*|cost of living|accommodation|hostel\w*|dorm\w*)\b/,
  /\b(study\w*|studying|abroad|overseas|international student\w*|foreign universit\w*|student visa|ranking\w*|times higher)\b/,
  /\b(uk|usa|america|canada|germany|australia|new zealand|ireland|italy|poland|finland|france|netherlands|uae|dubai|saudi arabia|europe)\b/,
  // Hinglish
  /\b(padhai|padhna|padhne|videsh|bahar padh\w*|vishwavidyalay\w*|daakhil\w*|dakhil\w*|pravesh|chhatravritti|chatravritti|shulk)\b/,
  // Devanagari
  /(विश्वविद्यालय|यूनिवर्सिटी|कॉलेज|कोर्स|डिग्री|पढ़ाई|पढाई|विदेश|दाखिला|प्रवेश|छात्रवृत्ति|फीस|शुल्क|आवेदन|मास्टर्स|स्नातक|वीज़ा|वीजा|आईईएलटीएस)/,
]

// Requests that are clearly outside the service when nothing above applies.
const OFF_TOPIC = [
  /\b(code|coding|program in|python|javascript|typescript|java\b|c\+\+|sql query|debug\w*|stack ?overflow|regex|html|css|api key|compile\w*)\b/,
  /\b(game|games|gaming|minecraft|fortnite|pubg|bgmi|free fire|valorant|gta|xbox|playstation|ps5|cheat code)\b/,
  /\b(movie\w*|film\w*|netflix|web series|song\w*|lyrics|bollywood|actor|actress|celebrity|anime|cartoon|meme\w*)\b/,
  /\b(cricket score|ipl|football match|match score|who won|horoscope|astrology|zodiac|lottery|betting|bet on)\b/,
  /\b(election\w*|prime minister|president of|political|politics|bjp|congress party|modi|vote for|rahul gandhi|trump|biden)\b/,
  /\b(recipe\w*|cook\w*|joke\w*|poem|poetry|write (?:me )?a story|riddle|trivia|weather|stock price|share price|crypto\w*|bitcoin|girlfriend|boyfriend|crush|dating)\b/,
  /\b(gaana|picture dekh|film dekh|khel(na|o)?|chutkula|shayari|kahani sunao|mausam)\b/,
  /(गाना|फ़िल्म|फिल्म|मूवी|खेल|चुटकुला|शायरी|चुनाव|मौसम|क्रिकेट)/,
]

// Attempts to change Derek's role or read his instructions. Classified, never obeyed.
const INJECTION = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(instruction\w*|rules?|prompt\w*|guidelines?|polic(y|ies)|previous|above|system)\b/,
  /\b(you are now|from now on you are|act as|pretend (to be|you are)|roleplay as|role-play as|you're now|behave like)\b/,
  /\b(system prompt|developer mode|dan mode|jailbreak\w*|do anything now|reveal your (instructions|prompt|rules)|print your (instructions|prompt))\b/,
  /\b(nirdesh\w*|niyam)\b[^.\n]{0,30}\b(bhool\w*|ignore|chhod\w*|mat mano)\b/,
  /(निर्देश|नियम)[^।\n]{0,30}(भूल|अनदेखा|छोड़|मत मानो)/,
]

// High-risk topics in Hindi and Hinglish (English ones live in lib/derek/safeguards.ts).
const HIGH_RISK: [RegExp, string][] = [
  [/\b(veeza|vija|visa (reject|refus|mana)\w*|visa nahi|pr kaise|nagrikta|deport\w*|immigration)\b|(वीज़ा|वीजा|नागरिकता|आप्रवास|इमिग्रेशन)/, 'Visa or immigration question'],
  [/\b(marna|mar jau\w*|mar jaana|jeena nahi|zindagi khatam|khudkushi|suicide|bahut pareshan|depress\w*|akela mehsoos|darr lag|dar lag)\b|(आत्महत्या|मरना|मर जा|जीना नहीं|ज़िंदगी ख़त्म|डर लग|परेशान)/, 'Possible distress or safeguarding concern'],
  [/\b(vakil|kanooni|kanuni|police|thana|case karna|court|adalat|dhokha|dhoka|fraud|scam|harass\w*|pareshan kar)\b|(वकील|क़ानूनी|कानूनी|पुलिस|अदालत|धोखा|ठगी)/, 'Legal question or dispute'],
  [/\b(paise wapas|refund|bhugtan|payment|loan chahiye|fees bhar\w*|paisa|paise)\b|(पैसे|भुगतान|रिफंड|लोन)/, 'Payment or financial question'],
  [/\b(khatra|khatre|unsafe|asurakshit|danger)\b|(ख़तरा|खतरा|असुरक्षित)/, 'Safety concern'],
]

// Common romanised-Hindi function words. English look-alikes ("me", "to", "so") are left out.
const HINGLISH_MARKERS = /\b(hai|hain|kya|kaise|kaisa|kaun|kitna|kitni|kitne|kab|mujhe|mera|meri|mere|humko|hume|chahiye|karna|karni|karu|karun|nahi|nahin|bhi|aur|ke liye|ki|ka|ko|se|mein|batao|bataiye|kijiye|kripya|accha|theek|lagega|lagegi|lagenge|milega|milegi)\b/g
const GREETING = /^(hi+|hello|hey|hii+|namaste|namaskar|good (morning|afternoon|evening)|hola|yo)[\s!.,?]*(derek|there|team)?[\s!.,?]*$/

export function detectLanguage(text: string): Language {
  if (/[ऀ-ॿ]/.test(text)) return 'hi'
  const markers = norm(text).match(HINGLISH_MARKERS)?.length ?? 0
  return markers >= 2 ? 'hinglish' : 'en'
}

export function classifyMessage(raw: string): MessageClassification {
  const text = norm(raw)
  const language = detectLanguage(raw)
  const injection = INJECTION.some((re) => re.test(text))
  const highRisk = [...new Set(HIGH_RISK.filter(([re]) => re.test(text)).map(([, label]) => label))]
  const study = STUDY.some((re) => re.test(text))
  const offTopic = OFF_TOPIC.some((re) => re.test(text))
  let scope: Scope
  if (injection) scope = 'off_topic' // a study word cannot launder an override attempt
  else if (GREETING.test(text.trim())) scope = 'greeting'
  else if (study && !offTopic) scope = 'in_scope'
  else if (offTopic && !study) scope = 'off_topic'
  else scope = 'unclear' // both or neither: a person decides
  // High-risk topics are never dismissed as "unrelated": a person must see them.
  if (highRisk.length && scope === 'off_topic' && !injection) scope = 'unclear'
  return { scope, language, injection, highRisk }
}

/** What the classification adds to a draft's risk. Anything not "low" is never sent automatically. */
export function scopeRisk(c: MessageClassification): RiskAssessment {
  const reasons: string[] = []
  let level: RiskAssessment['level'] = 'low'
  if (c.injection) (level = 'high'), reasons.push('The message tries to change Derek’s instructions or role')
  if (c.highRisk.length) (level = 'high'), reasons.push(...c.highRisk)
  if (c.language !== 'en' && level === 'low') level = 'uncertain'
  if (c.language !== 'en') reasons.push('Hindi or Hinglish question: a person reads it before any reply is sent')
  if (c.scope === 'unclear' && level === 'low') level = 'uncertain'
  if (c.scope === 'unclear') reasons.push('Intent unclear or partly outside study abroad')
  return { level, reasons }
}

/** LockIn's own fixed replies: no third-party model, no data leaves the server. */
export const RULES_PROVIDER_ID = 'derek-rules'
