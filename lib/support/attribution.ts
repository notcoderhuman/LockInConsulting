// The one place that decides how a message's author is described. It reads only the stored
// attribution columns (messages.author_kind, reviewed_by, and the final draft revision's author),
// so a human reply can never be labelled as Derek and a Derek reply can never be labelled human.

export type AuthorKind = 'student' | 'staff' | 'derek'

export interface AttributionInput {
  authorKind: AuthorKind
  authorName: string | null
  reviewedByName: string | null
  /** For Derek messages: whether a team member edited the final text before approving it. */
  editedByHuman: boolean
}

export function attributionLabel(m: AttributionInput, viewer: 'student' | 'staff'): string {
  switch (m.authorKind) {
    case 'student':
      return viewer === 'student' ? 'You' : (m.authorName ?? 'Student')
    case 'staff':
      return `Replied by ${m.authorName ?? 'a LockIn team member'} · LockIn team`
    case 'derek':
      if (!m.reviewedByName) return 'Replied by Derek · AI assistant · automatic reply, not reviewed by a person'
      return m.editedByHuman
        ? `Drafted by Derek · AI assistant · edited and approved by ${m.reviewedByName}`
        : `Replied by Derek · AI assistant · reviewed by ${m.reviewedByName}`
  }
}
