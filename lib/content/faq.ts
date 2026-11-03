import type { IsoDate } from '@/lib/data/types'

/**
 * Owner-approved FAQ content. Add an entry ONLY with wording the owner has approved, and record when.
 * Nothing here is drafted or inferred: until entries exist, /faq shows an honest empty state, is not
 * indexed, and is linked from nowhere. tests/faq.test.ts checks every entry's shape.
 */
export interface FaqEntry {
  /** URL fragment for a direct link (/faq#<id>): lowercase words joined by hyphens. */
  id: string
  topic: string
  question: string
  /** One string per paragraph, plain text. */
  answer: string[]
  /** The date the owner approved this wording. */
  approvedOn: IsoDate
  /** An official source for readers who want to check, when the answer depends on one. */
  source?: { label: string; url: string }
}

export const FAQ_ENTRIES: readonly FaqEntry[] = []
