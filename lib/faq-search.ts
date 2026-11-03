import type { FaqEntry } from './content/faq'

// Case- and accent-insensitive, like the university search ("visa" finds "Visa", "etude" finds "étude").
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Entries containing every word of the query in their question, answer or topic, in their original order. */
export function searchFaq(entries: readonly FaqEntry[], query: string): FaqEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return [...entries]
  return entries.filter((e) => {
    const text = fold([e.topic, e.question, ...e.answer].join(' '))
    return words.every((w) => text.includes(w))
  })
}
