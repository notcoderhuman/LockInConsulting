// Deterministic scope and risk classification of a student's message, run BEFORE any provider is
// contacted. The model's own instructions are a second line of defence, never the first.
//
//   off_topic   clearly unrelated (coding, games, entertainment, politics…) or an attempt to
//               override Derek's role → a fixed refusal; no provider call
//   greeting    a bare greeting, in any supported language → a short greeting back; no provider call
//   thanks      thanks or a plain acknowledgement → a short reply; no provider call
//   in_scope    mentions study abroad, universities, courses, admissions… → normal drafting.
//               A greeting in front of a question ("hi, tell me about Germany") is removed first,
//               so the question is classified (and answered) on its own.
//   unclear     neither → drafted for review, never sent automatically
//
// English, Hindi (Devanagari) and Hinglish (romanised Hindi) are recognised. Greetings and thanks
// are answered in every language. Any other message that is not plainly English is "uncertain" for
// automatic sending: the keyword lists below cannot promise to catch every Hindi or Hinglish way of
// asking about a visa or describing distress, so a person reads it first. Message text is
// untrusted: it is classified, never obeyed.

import type { RiskAssessment } from './safeguards'

export type Scope = 'in_scope' | 'off_topic' | 'greeting' | 'thanks' | 'unclear'
export type Language = 'en' | 'hi' | 'hinglish'

export interface MessageClassification {
  scope: Scope
  language: Language
  /** Text that tries to change Derek's role or instructions. */
  injection: boolean
  /** High-risk topics in any supported language (visa, legal, distress, payments, safety). */
  highRisk: string[]
  /** The message without a leading greeting: what Derek actually answers. */
  question: string
  /** Set when the message is misuse (coding help, internals, instruction override, attempts on credentials or other students' data). */
  misuse: Misuse | null
}

export const OFF_TOPIC_REPLY =
  "I'm Derek, LockIn Consulting's study-abroad assistant. I can help with universities, courses, admissions and studying abroad, but I can't assist with unrelated topics. What would you like to know about studying abroad?"

export const GREETING_REPLY = 'Hey! What are you planning to explore today—universities, courses, fees, or admissions?'

export const THANKS_REPLY = 'You’re welcome! Ask me anytime if something else comes up.'

const norm = (text: string) => text.normalize('NFKC').toLowerCase()

// Words that put a message inside LockIn's service. Romanised Hindi spellings vary, so stems are used.
const STUDY = [
  /\b(universit\w*|uni|college\w*|campus\w*|course\w*|programme\w*|degree\w*|bachelor\w*|master\w*|masters|undergrad\w*|postgrad\w*|ug|pg|phd|doctorate|diploma\w*|foundation year|mba|msc|ms in|bsc|btech|mtech|llm|cs|computer science)\b/,
  /\b(admission\w*|admit\w*|apply\w*|appl(y|ie|ication)\w*|offer letter|conditional offer|unconditional offer|intake\w*|deadline\w*|enrol\w*|shortlist\w*|eligib\w*|requirements?)\b/,
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

// ---------------------------------------------------------------------------------------------
// Misuse (Owner brief, 13 Nov 2026). Deterministic, no model: a legitimate university question that mentions SQL, an API or
// cybersecurity is never flagged, because every pattern below needs a sensitive target AND either LockIn's own systems
// ("your database", "LockIn's admin") or an explicit hostile technique.
//   security   Category C: credentials, keys, secrets, other students' data, bypassing security, attack techniques
//   injection  Category B material: trying to read or override Derek's instructions
//   internals  Category A+: LockIn's systems, source, staff contact details, or how the safeguards work
//   off_topic  Category A: coding help and other unrelated requests
// ---------------------------------------------------------------------------------------------

export type MisuseKind = 'security' | 'injection' | 'internals' | 'off_topic'
export interface Misuse {
  kind: MisuseKind
  /** Category-level wording for staff and (in the email) the student. Never the pattern that matched. */
  reason: string
}

const OWNER_CONTEXT = /\b(lockin|lock in|derek|your (?:\w+ ){0,2}(?:api|keys?|tokens?|passwords?|credentials?|database|server|admin|smtp|env\w*|secrets?)|your (?:admin|staff|team|server|servers|database|db|system|systems|website|site|platform|backend|hosting|email|mail|code|app|api)|this (?:site|website|platform|app|system|chat|server)|the (?:lockin|admin|owner|platform|backend|website'?s?|site'?s?) )/
const SECRET_TARGET =
  /\b(passwords?|passcodes?|credentials?|login (?:details|info\w*|id)|usernames? and passwords?|api[ -]?keys?|secret[ -]?keys?|private[ -]?keys?|access[ -]?tokens?|auth(?:entication)? tokens?|session (?:cookies?|tokens?)|env(?:ironment)? (?:var\w*|file)|\.env\b|process\.env|smtp (?:password|credentials?|settings|login)|database (?:dump|contents?|credentials?|password|backup|records|access)|db (?:dump|password|credentials?|access)|connection string|ssh (?:key|access|login)|root access|server (?:ip|files?|logs?|access|password)|admin (?:account|login|access|password|panel|dashboard))\b/
const HOSTILE = [
  /\b(sql injection|xss payload|cross[- ]site scripting|union select|drop table|(?:delete|truncate) from \w+|ddos|backdoor|reverse shell|privilege escalation|brute[- ]?force (?:the |a |their )?(?:login|password|otp|admin)|keylogger|phishing (?:page|kit))\b/,
  /\b(bypass|circumvent|crack|hack(?:ing)? (?:into)?|exploit)\b[^.\n]{0,40}\b(login|log in|authentication|admin\w*|security|firewall|otp|2fa|captcha|age (?:check|gate|verification)|rate[- ]?limit\w*|restrictions?|ban)\b/,
  /\b(show|give|tell|send|share|read|list|leak|dump|export|reveal|forward|access|see|view)\b[^.\n]{0,40}\b(other|another|different|someone else'?s?)\b[^.\n]{0,10}\b(students?|users?|clients?|customers?)'?s?\b[^.\n]{0,30}\b(conversations?|chats?|messages?|data|records?|emails?|phone numbers?|files)\b/,
  /\b(show|give|tell|send|share|read|list|leak|dump|export|reveal|forward|access|see|view)\b[^.\n]{0,40}\b(conversations?|chats?|messages?|emails?|phone numbers?|records?|data)\b[^.\n]{0,25}\b(?:of|from|by|belonging to)\b[^.\n]{0,12}\b(other|another|different)\b[^.\n]{0,8}\b(students?|users?|people|clients?)\b/,
]
const SECRET_VERB = /\b(give|show|tell|share|send|reveal|leak|print|dump|list|display|provide|what(?:'s| is| are)|read out|paste|forward|access|get me|find out|need)\b/
const INTERNALS =
  /\b(source code|tech(?:nology)? stack|which (?:database|hosting|server|framework|cloud)|what (?:database|hosting|server|framework)|how (?:is|are) (?:the )?(?:data|messages|students?) (?:stored|saved|logged)|staff (?:list|names|emails?|phones?|phone numbers?|numbers?|addresses|home)|team members?'?s? (?:emails?|phones?|phone numbers?|numbers?|home|addresses)|who (?:built|developed|made|coded) (?:you|this)|ban (?:threshold|rules?|limit)|how many (?:warnings|violations|strikes|messages) (?:before|until)|what (?:triggers|gets me) (?:a )?ban|internal (?:rules|policy|policies|tools?|documents?))\b/
const INJECTION_ROLE = /\b(system prompt|developer mode|dan mode|jailbreak\w*|do anything now|reveal your (?:instructions|prompt|rules)|print your (?:instructions|prompt)|show (?:me )?your (?:instructions|prompt|rules)|repeat (?:the |your )?(?:text|words|instructions) above)\b/
const CODING_REQUEST =
  /(?:^|[.!?]\s+|\b(?:can|could|would|will) you\s+(?:please\s+)?|\bplease\s+|\bhelp me\s+(?:to\s+)?|\bi (?:need|want) you to\s+)(?:write|create|generate|make|fix|debug|solve|build|code|optimi[sz]e|refactor|convert|complete)\b[^.\n]{0,50}\b(code|script|program|function|algorithm|query|regex|html|css|component|app|website|bot|sql|python|javascript|java|c\+\+|typescript|react|assignment|homework|leetcode)\b|```|\b(?:def |function\s*\(|#include|public static void|console\.log|select \* from)/

/** Whether a message is misuse, and which kind. `null` for every legitimate university question. */
export function detectMisuse(text: string): Misuse | null {
  const t = norm(text).replace(/[’‘]/g, "'")
  const owner = OWNER_CONTEXT.test(t)
  const asks = SECRET_VERB.test(t)
  if (HOSTILE.some((re) => re.test(t)) || (owner && asks && SECRET_TARGET.test(t)))
    return { kind: 'security', reason: 'Attempt to obtain credentials, secrets, other students’ information or access to LockIn’s systems, or to bypass its security' }
  if (INJECTION_ROLE.test(t) || INJECTION.some((re) => re.test(t))) return { kind: 'injection', reason: 'Attempt to change or read Derek’s instructions' }
  if (CODING_REQUEST.test(t)) return { kind: 'off_topic', reason: 'Request for coding or technical help unrelated to studying abroad' }
  if (owner && INTERNALS.test(t)) return { kind: 'internals', reason: 'Request about LockIn’s internal systems, staff or safeguards' }
  if (INTERNALS.test(t) && /\b(your|lockin|derek|this)\b/.test(t)) return { kind: 'internals', reason: 'Request about LockIn’s internal systems, staff or safeguards' }
  return null
}

export const SECURITY_REPLY =
  'I can’t help with that. I only answer study-abroad questions, and I can’t share or access LockIn’s accounts, systems or other students’ information. If you have a question about a university, course, fees or applying, I’m happy to help.'

export const INTERNALS_REPLY =
  'I can’t share details about how LockIn’s systems or team work internally, but I’m happy to help with universities, courses, admissions and studying abroad. What would you like to know?'

export const WARNING_REPLY =
  'Please keep to study-abroad questions. I can’t help with unrelated or unsafe requests, and repeated ones can lead to limits on your account. What would you like to know about universities, courses or applying?'

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

// Greetings and acknowledgements in English, Hinglish and Hindi, optionally naming who they address.
// `\b` does not work around Devanagari, so the patterns are anchored on the whole (trimmed) message.
const HELLO =
  "(?:h+i+|he+y+|hel+o+|hiya|howdy|yo|sup|hola|namaste|namaskar|namaskaar|pranam|ram ram|sat sri akal|salaam|salam|assalam\\w*|good (?:morning|afternoon|evening|day)|gm|नमस्ते|नमस्कार|प्रणाम)"
const ADDRESSEE = "(?:\\s+(?:derek|there|team|sir|ma'?am|madam|ji|bhai|bhaiya|didi|dost|everyone|all|lockin))*"
const HOW_ARE = "(?:how are you|how r u|how's it going|kaise ho|kaisi ho|kya haal hai|kya haal|sab theek|kaise hain|आप कैसे हैं|कैसे हो)(?:\\s+(?:doing|today))?"
const HOW_ARE_YOU = `(?:[\\s,!.]*${HOW_ARE})?`
const GREETING = new RegExp(`^(?:${HELLO}${ADDRESSEE}${HOW_ARE_YOU}|${HOW_ARE}${ADDRESSEE})[\\s!.,?🙏]*$`)
/** A greeting at the start of a longer message. */
const LEADING_GREETING = new RegExp(`^${HELLO}${ADDRESSEE}${HOW_ARE_YOU}[\\s!.,?:—-]+(?=\\S)`, 'i')
const ACK = '(?:ok(?:ay)?|okk+|great|cool|perfect|nice|got it|alright|sure|awesome|achha|accha|acha|theek hai|thik hai)'
const THANKS_WORD =
  '(?:thanks?(?: a lot| so much| you(?: so much| very much)?)?|thank u|thx|ty|tysm|cheers|shukriya|bahut shukriya|dhanyavaa?d|dhanyawaa?d|धन्यवाद|शुक्रिया)'
const THANKS = new RegExp(`^(?:${ACK}[\\s,!.]*)*(?:${THANKS_WORD}|${ACK})${ADDRESSEE}[\\s!.,🙏]*$`)

export function detectLanguage(text: string): Language {
  if (/[ऀ-ॿ]/.test(text)) return 'hi'
  const markers = norm(text).match(HINGLISH_MARKERS)?.length ?? 0
  return markers >= 2 ? 'hinglish' : 'en'
}

export function classifyMessage(raw: string): MessageClassification {
  const whole = norm(raw).trim()
  const trimmed = raw.trim()
  // A bare greeting or thanks never reaches the model and is never turned into an essay.
  if (GREETING.test(whole)) return { scope: 'greeting', language: detectLanguage(raw), injection: false, highRisk: [], question: trimmed, misuse: null }
  if (THANKS.test(whole)) return { scope: 'thanks', language: detectLanguage(raw), injection: false, highRisk: [], question: trimmed, misuse: null }

  const question = trimmed.replace(LEADING_GREETING, '').trim() || trimmed
  const text = norm(question)
  const language = detectLanguage(question)
  const misuse = detectMisuse(question)
  const injection = INJECTION.some((re) => re.test(text)) || misuse?.kind === 'injection'
  const highRisk = [...new Set(HIGH_RISK.filter(([re]) => re.test(text)).map(([, label]) => label))]
  const study = STUDY.some((re) => re.test(text))
  // A study question that merely mentions Python, SQL or an API ("does the programme teach Python?") is a study question.
  const offTopic = OFF_TOPIC.slice(1).some((re) => re.test(text)) || (!study && OFF_TOPIC[0].test(text)) || misuse?.kind === 'off_topic'
  let scope: Scope
  if (injection || misuse) scope = 'off_topic' // a study word cannot launder an override attempt or a misuse request
  else if (study && !offTopic) scope = 'in_scope'
  else if (offTopic && !study) scope = 'off_topic'
  else scope = 'unclear' // both or neither: a person decides
  // High-risk topics are never dismissed as "unrelated": a person must see them.
  if (highRisk.length && scope === 'off_topic' && !injection) scope = 'unclear'
  return { scope, language, injection, highRisk, question, misuse }
}

/** A greeting or thanks: answered with a fixed line, and never a reason to drop an earlier question. */
export const isSmallTalk = (c: Pick<MessageClassification, 'scope'>) => c.scope === 'greeting' || c.scope === 'thanks'

/** What the classification adds to a draft's risk. Anything not "low" is never sent automatically. */
export function scopeRisk(c: MessageClassification): RiskAssessment {
  // LockIn's own short reply to a greeting or thanks, in any language: nothing for a person to check.
  if (c.scope === 'greeting' || c.scope === 'thanks') return { level: 'low', reasons: [] }
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
