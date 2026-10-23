// Light clean-up of a provider's draft before it is checked and stored. It only removes filler and
// markdown that the rules forbid (greetings, "Great question", sign-offs, **bold**, # headings);
// it never adds or rewrites content, and a reviewer still sees and approves the result.

const LEADING_FILLER: RegExp[] = [
  /^(hi|hello|hey|dear|namaste)\b[^.!?\n]{0,40}[.!?,:]\s*/i,
  /^(that'?s |what )?(a )?(great|good|excellent|wonderful|fantastic) question[.!]?\s*/i,
  /^(thanks|thank you) for (your|the|asking)[^.!?\n]{0,60}[.!?]\s*/i,
  /^as an ai( assistant)?[^.!?\n]{0,80}[.!?]\s*/i,
  /^(sure|certainly|of course|absolutely)[,!.]\s*/i,
]

const TRAILING_FILLER: RegExp[] = [
  /\s*(i )?hope (this|that) helps[^.!?\n]{0,40}[.!?]?\s*$/i,
  /\s*(feel free to|don'?t hesitate to) (ask|reach out|contact)[^.!?\n]{0,60}[.!?]?\s*$/i,
  /\s*(best of luck|good luck)( with [^.!?\n]{0,40})?[.!]?\s*$/i,
]

export function tidyDraft(raw: string): string {
  let text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .trim()
  for (let pass = 0; pass < 3; pass++) {
    const before = text
    for (const re of LEADING_FILLER) text = text.replace(re, '')
    for (const re of TRAILING_FILLER) text = text.replace(re, '')
    text = text.trim()
    if (text === before) break
  }
  // Never let clean-up empty a draft; the original goes to review instead.
  return text || raw.trim()
}

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

// Editorial checks drawn from Wikipedia's "Signs of AI writing" advice page, used as a practical
// style guide for a study-abroad adviser, never as an AI-detection score. Each finding is shown to
// the reviewer, and any finding keeps a reply from being sent automatically. They flag clear
// problems only; they do not demand a template, a word count or a list format.

// Words that make an answer read like an advert. One is enough.
const PROMOTIONAL = /\b(world[- ]class|prestigious|renowned|unparalleled|unmatched|breathtaking|nestled|dream destination|gateway to|unlock (?:your )?(?:full )?potential|embark|tapestry|testament to|delve|plethora|second to none|top-notch|game[- ]changer)\b/i
// Common on their own; a cluster of them is the sign.
const BUZZWORDS = /\b(vibrant|bustling|journey|myriad|landscape|ever[- ]evolving|transformative|seamless(?:ly)?|holistic|robust|pivotal|cutting[- ]edge|state[- ]of[- ]the[- ]art|thriving|leverag\w+|empower\w*)\b/gi
const SIGNIFICANCE = /\b(plays? an? (?:vital|crucial|pivotal|key) role|stands as|in today'?s (?:fast-paced|competitive|globali[sz]ed) world|opens? (?:up )?(?:endless|countless|a world of|many) (?:opportunities|doors)|(?:bright|exciting|promising) future|limitless (?:opportunities|possibilities))\b/i
const FILLER_OPENER = /^\s*(?:(?:that'?s |what )?(?:an? )?(?:great|good|excellent|wonderful) question|certainly|of course|absolutely|sure thing|i'?d be (?:happy|glad) to help|happy to help)\b/i
const COLLAB = /\b(i hope this helps|feel free to (?:ask|reach out)|let me know if|is there anything else|best of luck|good luck (?:with|on) your (?:journey|future))\b/i
const NEGATIVE_PARALLEL = /\bnot (?:just|only|merely)\b[^.\n]{1,80}\b(?:but|it'?s)\b/i
const HEDGE = /\b(based on (?:the )?available information|while specific details are (?:limited|scarce)|it is important to note|it'?s worth noting)\b/i
const EMOJI = /\p{Extended_Pictographic}/u

/** Editorial problems in a draft (empty = none found). */
export function styleIssues(text: string): string[] {
  const issues: string[] = []
  if (FILLER_OPENER.test(text)) issues.push('Starts with filler instead of the answer')
  if (COLLAB.test(text)) issues.push('Chatbot sign-off or filler phrase')
  if (PROMOTIONAL.test(text)) issues.push('Promotional wording')
  if (new Set((text.match(BUZZWORDS) ?? []).map((w) => w.toLowerCase())).size >= 2) issues.push('Cluster of buzzwords')
  if (SIGNIFICANCE.test(text)) issues.push('Vague claim about significance or opportunities')
  if (NEGATIVE_PARALLEL.test(text)) issues.push('"Not just X, but Y" construction')
  if (HEDGE.test(text)) issues.push('Generic hedge or disclaimer')
  if (/\*\*|__|^#{1,6}\s/m.test(text) || EMOJI.test(text)) issues.push('Decorative formatting (bold, headings or emoji)')
  if ((text.match(/^\s*(?:-|\*|•|\d+[.)])\s/gm) ?? []).length > 8) issues.push('Long list')
  if (wordCount(text) > 220) issues.push(`Long reply (${wordCount(text)} words)`)
  // Three or more sentences opening with the same two words read as a template.
  const openings = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[-*•\d.)\s]+/, '').toLowerCase().split(/\s+/).slice(0, 2).join(' '))
    .filter((o) => o.split(' ').length === 2)
  if (Object.values(openings.reduce<Record<string, number>>((n, o) => ({ ...n, [o]: (n[o] ?? 0) + 1 }), {})).some((n) => n >= 3))
    issues.push('Repetitive sentence openings')
  return issues
}
