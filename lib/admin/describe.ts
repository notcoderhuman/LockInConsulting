import { humanize, MONTH_NAMES, type EntityKey } from './entities'

type R = Record<string, unknown>

/** Short human label for a record, used in lists, breadcrumbs and the review queue. */
export function recordTitle(entity: EntityKey, row: R): string {
  switch (entity) {
    case 'university':
    case 'campus':
    case 'course':
      return String(row.name ?? `#${row.id}`)
    case 'course_intake': {
      const month = MONTH_NAMES[Number(row.intake_month) - 1] ?? '?'
      return `${month}${row.intake_year ? ` ${row.intake_year}` : ''} intake`
    }
    case 'tuition_fee': {
      const amount = row.amount == null ? 'not published' : `${row.currency} ${row.amount}`
      return `${humanize(String(row.fee_category))} fee · ${amount} · ${humanize(String(row.billing_period))}`
    }
    case 'acceptance_rate':
      return `${row.rate_percent == null ? 'Not published' : `${row.rate_percent}%`} · ${row.cohort_label}`
    case 'university_ranking': {
      const rank = row.rank_position != null ? `#${row.rank_position}` : `${row.rank_band_low}–${row.rank_band_high}`
      return `${row.ranking_year}${row.subject ? ` ${row.subject}` : ''} · ${rank}`
    }
  }
}

export const PUBLICATION_LABEL: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  unpublished: 'Unpublished',
}

export const VERIFICATION_LABEL: Record<string, string> = {
  unverified: 'Unverified',
  verified: 'Verified',
  unavailable: 'Verified: not published by source',
}

export const ACTION_LABEL: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  submit_for_review: 'Submitted for review',
  verify: 'Verified',
  mark_unavailable: 'Marked not publicly available',
  publish: 'Published',
  unpublish: 'Unpublished',
  rights_change: 'Rights changed',
  return_to_draft: 'Returned to draft',
  reverify: 'Re-verified',
  terms_change: 'Terms changed',
  role_grant: 'Access granted',
  role_revoke: 'Access revoked',
  staff_reply: 'Team reply sent',
  status_change: 'Conversation status changed',
  draft_edit: 'Derek draft edited',
  draft_approve: 'Derek draft approved',
  draft_reject: 'Derek draft rejected',
  draft_send: 'Derek reply sent',
  settings_change: 'Support settings changed',
  support_grant: 'Support access granted',
  support_revoke: 'Support access revoked',
  student_erase: 'Student data erased',
}
