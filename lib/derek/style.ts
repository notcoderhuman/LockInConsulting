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
