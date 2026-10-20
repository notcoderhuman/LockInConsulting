import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/admin/page-header'
import { requireAdminPage } from '@/lib/admin/access'
import { ACTION_LABEL } from '@/lib/admin/describe'
import { ENTITIES, ENTITY_KEYS, humanize } from '@/lib/admin/entities'
import { getChainStatus, getChangeLog } from '@/lib/admin/queries'
import { changedColumns, firstParam, formatUtc, positiveInt, recordHref } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'

export const metadata: Metadata = { title: 'Change log' }

const LOG_TO_ENTITY = new Map(ENTITY_KEYS.map((k) => [ENTITIES[k].logType as string, k]))

function targetHref(type: string, id: unknown): string | null {
  const entity = LOG_TO_ENTITY.get(type)
  if (entity) return recordHref(entity, id)
  if (type === 'source') return `/admin/sources/${id}`
  if (type === 'ranking_provider' || type === 'fx_provider' || type === 'fx_rate' || type === 'support_settings') return '/admin/settings'
  if (type === 'admin_member') return '/admin/team'
  if (type === 'conversation') return `/admin/inbox/${id}`
  if (type === 'student_profile') return `/admin/students/${id}`
  return null
}

export default async function ChangesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('data.read')
  const page = positiveInt(firstParam((await searchParams).page)) ?? 1
  const db = getAdminPool()
  const [{ rows, total, names, pageSize }, chain] = await Promise.all([getChangeLog(db, page), getChainStatus(db)])
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <>
      <PageHeader
        title="Change log"
        description="Every create, edit, verification, publish and rights change, newest first. Entries are hash-chained and the database refuses to update or delete them."
      />

      <div
        role="status"
        className={
          chain.ok
            ? 'flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4'
            : 'flex items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4'
        }
      >
        {chain.ok ? <ShieldCheck className="mt-0.5 size-5 text-primary" aria-hidden="true" /> : <ShieldAlert className="mt-0.5 size-5 text-destructive" aria-hidden="true" />}
        <p className="text-sm leading-relaxed text-foreground">
          {chain.ok
            ? `Integrity check passed: all ${chain.checked} entries match their hashes.`
            : `Integrity check failed${chain.brokenAtId != null ? ` at entry #${chain.brokenAtId}` : ''}: ${chain.reason}.`}
        </p>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{`Change log, page ${page} of ${pages}`}</caption>
            <thead className="bg-card">
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">#</th>
                <th scope="col" className="px-4 py-3 font-medium">When (UTC)</th>
                <th scope="col" className="px-4 py-3 font-medium">Action</th>
                <th scope="col" className="px-4 py-3 font-medium">Record</th>
                <th scope="col" className="px-4 py-3 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const href = targetHref(String(r.entity_type), r.entity_id)
                const changed = r.action === 'update' ? changedColumns(r.before_data, r.after_data) : []
                const label = `${humanize(String(r.entity_type))} #${r.entity_id}`
                return (
                  <tr key={String(r.id)} className="border-t border-border align-top">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{String(r.id)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatUtc(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="text-foreground">{ACTION_LABEL[String(r.action)] ?? String(r.action)}</span>
                      {r.reason ? <span className="block max-w-xs text-xs leading-relaxed text-muted-foreground">{`“${String(r.reason)}”`}</span> : null}
                      {changed.length ? <span className="block max-w-xs font-mono text-xs text-muted-foreground">{changed.join(', ')}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      {href ? (
                        <Link href={href} className="text-foreground hover:text-primary">
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {names.get(String(r.actor_id)) ?? String(r.actor_id)}
                      {r.actor_role ? <span className="block text-xs">{String(r.actor_role)}</span> : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No changes recorded yet.</EmptyState>
      )}

      {pages > 1 ? (
        <nav aria-label="Change log pages" className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={`/admin/changes?page=${page - 1}`} className={buttonVariants({ variant: 'outline' })}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">{`Page ${page} of ${pages}`}</span>
          {page < pages ? (
            <Link href={`/admin/changes?page=${page + 1}`} className={buttonVariants({ variant: 'outline' })}>
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  )
}
