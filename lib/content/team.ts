export interface TeamMember {
  id: string
  displayName: string
  role: string
  quote?: string
  description?: string
  portrait: { src: string; alt: string; width: number; height: number }
  order: number
  published: boolean
}

/**
 * Stage-1 seed only. Phase 12 moves team profiles into the database and
 * the admin "Our Team" manager; this file then becomes a migration seed.
 * Description intentionally left empty until Dev supplies approved copy.
 */
export const TEAM_SEED: readonly TeamMember[] = [
  {
    id: 'dev-gautam',
    displayName: 'Dev Gautam',
    role: 'Founder and CEO',
    quote: 'You gotta LockIn dude 😭',
    portrait: {
      src: '/images/founder-dev-gautam.webp',
      alt: 'Dev Gautam, Founder and CEO of LockIn Consulting, wearing a black blazer',
      width: 900,
      height: 1200,
    },
    order: 1,
    published: true,
  },
]
