// Mirrors admin_members.role in db/migrations/0002_admin_auth.sql.
export const ADMIN_ROLES = ['editor', 'reviewer', 'owner'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

export type Permission =
  | 'data.read' // open the dashboard and read every record
  | 'data.capture' // create/edit drafts, add sources, submit for review
  | 'data.review' // verify, publish, unpublish, return to draft, enter exchange rates
  | 'rights.manage' // ranking reuse rights and exchange-rate provider terms
  | 'members.read' // see who has admin access

const RANK: Record<AdminRole, number> = { editor: 1, reviewer: 2, owner: 3 }

const MINIMUM_ROLE: Record<Permission, AdminRole> = {
  'data.read': 'editor',
  'data.capture': 'editor',
  'data.review': 'reviewer',
  'rights.manage': 'owner',
  'members.read': 'owner',
}

export function can(role: AdminRole | null | undefined, permission: Permission): boolean {
  if (!role || !(role in RANK)) return false
  return RANK[role] >= RANK[MINIMUM_ROLE[permission]]
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
}
