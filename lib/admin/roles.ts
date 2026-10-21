// Mirrors admin_members.role in db/migrations/0002_admin_auth.sql.
export const ADMIN_ROLES = ['editor', 'reviewer', 'owner'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

export type Permission =
  | 'data.read' // open the dashboard and read every record
  | 'data.capture' // create/edit drafts, add sources, submit for review
  | 'data.review' // verify, publish, unpublish, return to draft, enter exchange rates
  | 'rights.manage' // ranking reuse rights and exchange-rate provider terms
  | 'members.read' // see who has admin access
  | 'support.read' // open the Live Inbox and read student conversations
  | 'support.reply' // send a human reply and change a conversation's status
  | 'support.review_ai' // edit, approve, reject or request Derek drafts
  | 'students.read' // student profile list and detail (contact details)
  | 'members.manage' // revoke membership and grant/revoke editor support access
  | 'support.settings' // online/offline mode and automatic replies
  | 'students.erase' // erase a student's account and conversations

const RANK: Record<AdminRole, number> = { editor: 1, reviewer: 2, owner: 3 }

const MINIMUM_ROLE: Record<Permission, AdminRole> = {
  'data.read': 'editor',
  'data.capture': 'editor',
  'data.review': 'reviewer',
  'rights.manage': 'owner',
  'members.read': 'owner',
  'support.read': 'reviewer',
  'support.reply': 'reviewer',
  'support.review_ai': 'reviewer',
  'students.read': 'reviewer',
  'members.manage': 'owner',
  'support.settings': 'owner',
  'students.erase': 'owner',
}

// Support tasks an owner may explicitly delegate to an individual editor
// (admin_members.support_enabled). Approving AI drafts is never delegated: like publishing
// directory data, it stays with reviewers and owners.
const EDITOR_DELEGABLE: ReadonlySet<Permission> = new Set(['support.read', 'support.reply'])

export function can(role: AdminRole | null | undefined, permission: Permission): boolean {
  if (!role || !(role in RANK)) return false
  return RANK[role] >= RANK[MINIMUM_ROLE[permission]]
}

/** Role check plus per-member delegation. Use this for anything an actor is about to do. */
export function actorCan(actor: Pick<AdminActor, 'role' | 'supportEnabled'> | null | undefined, permission: Permission): boolean {
  if (!actor) return false
  if (can(actor.role, permission)) return true
  return actor.role === 'editor' && actor.supportEnabled === true && EDITOR_DELEGABLE.has(permission)
}

export const ROLE_LABEL: Record<AdminRole, string> = {
  editor: 'Editor',
  reviewer: 'Reviewer',
  owner: 'Owner',
}

export interface AdminActor {
  userId: string
  name: string
  email: string
  role: AdminRole
  /** Owner-granted support access for an editor. Ignored for reviewers and owners. */
  supportEnabled?: boolean
}
