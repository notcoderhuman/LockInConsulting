// Conversation state machine. Mirrors conversations.status in db/migrations/0003_support_chat.sql.
//
//   open                    a student is waiting for the team; no AI draft is involved
//   awaiting_human_review   Derek prepared a draft (or flagged one as uncertain/high-risk) and a
//                           reviewer must approve, edit, reject it or write a reply
//   awaiting_student_reply  the last word came from the team (a human or an approved Derek reply)
//   resolved                closed by the team; a new student message reopens it
//   failed                  Derek failed or timed out; the question is preserved and a human must
//                           intervene. Never shown to the student as an error on their side.
//
// Every applied transition is written to conversation_events in the same transaction.

export const CONVERSATION_STATUSES = ['open', 'awaiting_human_review', 'awaiting_student_reply', 'resolved', 'failed'] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

export type ConversationEvent =
  | { type: 'student_message' }
  | { type: 'draft_needs_review' }
  | { type: 'ai_failed' }
  | { type: 'reply_sent' }
  | { type: 'staff_set'; to: ConversationStatus }

/** Statuses a team member may choose by hand. awaiting_student_reply only follows a real reply. */
export const STAFF_SETTABLE: readonly ConversationStatus[] = ['open', 'awaiting_human_review', 'resolved', 'failed']

export class TransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransitionError'
  }
}

export function isConversationStatus(v: unknown): v is ConversationStatus {
  return typeof v === 'string' && (CONVERSATION_STATUSES as readonly string[]).includes(v)
}

/** Returns the next status, or throws TransitionError for a transition the workflow forbids. */
export function nextStatus(current: ConversationStatus, event: ConversationEvent): ConversationStatus {
  switch (event.type) {
    case 'student_message':
      // A pending review or an unresolved failure still needs the team; anything else reopens.
      return current === 'awaiting_human_review' || current === 'failed' ? current : 'open'
    case 'draft_needs_review':
      if (current === 'resolved') throw new TransitionError('The conversation was resolved before the draft was ready.')
      return 'awaiting_human_review'
    case 'ai_failed':
      if (current === 'resolved') throw new TransitionError('The conversation was resolved before Derek failed.')
      return current === 'awaiting_student_reply' ? current : 'failed'
    case 'reply_sent':
      return 'awaiting_student_reply'
    case 'staff_set':
      if (!STAFF_SETTABLE.includes(event.to)) throw new TransitionError('That status is set automatically when a reply is sent.')
      if (event.to === current) throw new TransitionError('The conversation already has that status.')
      return event.to
  }
}

export const STATUS_LABEL: Record<ConversationStatus, string> = {
  open: 'Open',
  awaiting_human_review: 'Awaiting human review',
  awaiting_student_reply: 'Awaiting student reply',
  resolved: 'Resolved',
  failed: 'Needs intervention',
}

/** Shown under a student's latest message until someone replies. Team notifications are in-site only, so a person follows up when they next sign in. */
export const STUDENT_ACKNOWLEDGEMENT = 'Your question has been received. A member of the LockIn team will follow up.'

/** What the student sees. Internal review and failure states are never exposed as such. */
export const STUDENT_STATUS_LABEL: Record<ConversationStatus, string> = {
  open: 'Waiting for the LockIn team',
  awaiting_human_review: 'Waiting for the LockIn team',
  awaiting_student_reply: 'The team has replied',
  resolved: 'Resolved',
  failed: 'Waiting for the LockIn team',
}
