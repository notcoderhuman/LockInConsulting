import type { Metadata } from 'next'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { ConversationBadge } from '@/components/admin/conversation-badge'
import { EmptyState, PageHeader } from '@/components/admin/page-header'
import { requireAdminPage } from '@/lib/admin/access'
import { firstParam, formatUtc, positiveInt } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'
import { getInboxCounts, INBOX_PAGE_SIZE, listInbox } from '@/lib/support/conversations'
import { CONVERSATION_STATUSES, isConversationStatus, STATUS_LABEL } from '@/lib/support/state'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Live Inbox' }

type Search = Promise<Record<string, string | string[] | undefined>>

function href(params: { status?: string | null; unread?: boolean; page?: number }) {
  const q = new URLSearchParams()
  if (params.status) q.set('status', params.status)
  if (params.unread) q.set('unread', '1')
  if (params.page && params.page > 1) q.set('page', String(params.page))
  const s = q.toString()
  return `/admin/inbox${s ? `?${s}` : ''}`
}

export default async function InboxPage({ searchParams }: { searchParams: Search }) {
  const actor = await requireAdminPage('support.read')
  const sp = await searchParams
  const rawStatus = firstParam(sp.status)
  const status = isConversationStatus(rawStatus) ? rawStatus : null
  const unread = firstParam(sp.unread) === '1'
  const page = positiveInt(firstParam(sp.page)) ?? 1
  const db = getAdminPool()
  const [{ rows, total }, counts] = await Promise.all([listInbox(db, actor, { status, unread, page }), getInboxCounts(db, actor)])
  const pages = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE))

  const filters: { label: string; to: string; active: boolean; count?: number }[] = [
    { label: 'All', to: href({}), active: !status && !unread },
    { label: 'Unread', to: href({ unread: true }), active: unread && !status, count: counts.unread },
    ...CONVERSATION_STATUSES.map((s) => ({ label: STATUS_LABEL[s], to: href({ status: s }), active: status === s && !unread, count: counts.byStatus[s] })),
  ]

  return (
    <>
      <PageHeader
        title="Live Inbox"
        description="Student questions, newest activity first. Replies you send are labelled with your name. Derek drafts are never sent without review unless the owner has enabled automatic replies."
      />

      <nav aria-label="Filter conversations">
        <ul className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <li key={f.label}>
              <Link
                href={f.to}
                aria-current={f.active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
                  f.active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
                {f.count != null ? <span className="tabular-nums">{f.count}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{`Conversations, page ${page} of ${pages}`}</caption>
            <thead className="bg-card">
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">Conversation</th>
                <th scope="col" className="px-4 py-2 font-medium">Student</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="px-4 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link href={`/admin/inbox/${r.id}`} className="flex items-center gap-2 text-foreground hover:text-primary">
                      {r.unread ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : <span className="size-2 shrink-0" aria-hidden="true" />}
                      <span className={cn('truncate', r.unread && 'font-semibold')}>{`#${r.id} · ${r.subject}`}</span>
                    </Link>
                    {r.pendingDrafts ? <span className="mt-1 block pl-4 text-xs text-primary">Derek draft awaiting review</span> : null}
                  </th>
                  <td className="px-4 py-3 text-muted-foreground">{r.studentName}</td>
                  <td className="px-4 py-3">
                    <ConversationBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatUtc(r.lastMessageAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>
          {total === 0 && !status && !unread
            ? 'No student conversations yet. Student accounts are not open, so this stays empty until they are.'
            : 'No conversations match this filter.'}
        </EmptyState>
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={href({ status, unread, page: page - 1 })} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">{`Page ${page} of ${pages}`}</span>
          {page < pages ? (
            <Link href={href({ status, unread, page: page + 1 })} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
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
