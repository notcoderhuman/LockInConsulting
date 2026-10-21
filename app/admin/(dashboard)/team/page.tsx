import type { Metadata } from 'next'
import { EmptyState, PageHeader, Panel } from '@/components/admin/page-header'
import { RevokeMemberForm, SupportAccessForm } from '@/components/admin/support-forms'
import { requireAdminPage } from '@/lib/admin/access'
import { ROLE_LABEL } from '@/lib/admin/roles'
import { listTeam } from '@/lib/admin/team'
import { formatUtc } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'
import { TEAM_SEED } from '@/lib/content/team'

export const metadata: Metadata = { title: 'Our Team' }

export default async function TeamPage() {
  const actor = await requireAdminPage('members.read')
  const members = await listTeam(getAdminPool(), actor)

  return (
    <>
      <PageHeader
        title="Our Team"
        description="Everyone with admin access. New accounts and role changes are made only with the CLI (pnpm admin:user), so nobody can raise their own access from a browser. Here an owner can revoke access or let an individual editor answer student questions."
      />

      <Panel title="Members">
        {members.length ? (
          <ul className="flex flex-col divide-y divide-border">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{m.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <span className={m.status === 'active' ? 'block font-medium text-primary' : 'block'}>{`${ROLE_LABEL[m.role]} · ${m.status === 'active' ? 'Active' : 'Revoked'}`}</span>
                    <span className="block">
                      {m.role === 'editor' ? (m.supportEnabled ? 'Support replies allowed' : 'Directory data only') : 'Support access through role'}
                    </span>
                    <span className="block">{`Granted ${formatUtc(m.grantedAt)}${m.revokedAt ? ` · revoked ${formatUtc(m.revokedAt)}` : ''}`}</span>
                    <span className="block">{`${m.activeSessions} active session${m.activeSessions === 1 ? '' : 's'}`}</span>
                  </div>
                </div>
                {m.status === 'active' && m.userId !== actor.userId ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    {m.role === 'editor' ? <SupportAccessForm userId={m.userId} enabled={m.supportEnabled} /> : <span />}
                    <div className="sm:w-80">
                      <RevokeMemberForm userId={m.userId} name={m.name} />
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No members.</EmptyState>
        )}
      </Panel>

      <Panel title="Public team profiles" description="What the homepage “Our team” section shows. Profiles are still a code seed (lib/content/team.ts); moving them into the database needs approved copy (D-010).">
        <ul className="flex flex-col divide-y divide-border">
          {TEAM_SEED.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="text-sm text-foreground">{t.displayName}</span>
              <span className="text-xs text-muted-foreground">{`${t.role} · ${t.published ? 'Shown on homepage' : 'Hidden'}`}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  )
}
