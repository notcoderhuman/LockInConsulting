import type { Metadata } from 'next'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/admin/page-header'
import { MarkReadForm, SyncReviewNotices } from '@/components/admin/support-forms'
import { requireAdminPage } from '@/lib/admin/access'
import { can } from '@/lib/admin/roles'
import { firstParam, formatUtc, positiveInt } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'
import { listNotifications, staffViewer, type NotificationKind } from '@/lib/support/notifications'
import { isSafeTargetPath } from '@/lib/support/validation'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Notifications' }

const KIND_LABEL: Record<NotificationKind, string> = {
  new_question: 'New question',
  student_reply: 'Student replied',
  human_review: 'Human review',
  draft_ready: 'Derek draft ready',
  high_risk: 'High-risk or uncertain draft',
  ai_failure: 'Derek failed',
  review_overdue: 'Review overdue',
  staff_reply: 'Reply sent',
}

const PAGE = 30

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdminPage('data.read')
  const before = positiveInt(firstParam((await searchParams).before))
  const db = getAdminPool()
  const viewer = staffViewer(actor)
  const items = await listNotifications(db, viewer, { limit: PAGE + 1, before })
  const page = items.slice(0, PAGE)
  const unreadIds = page.filter((n) => !n.read).map((n) => n.id)

  return (
    <>
      {can(actor.role, 'data.review') ? <SyncReviewNotices /> : null}
      <PageHeader
        title="Notifications"
        description="In-site only. You see notifications addressed to you and to the teams your role belongs to. Nothing is emailed or sent to another service."
        actions={unreadIds.length ? <MarkReadForm ids="all" label="Mark all as read" /> : null}
      />
      {page.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {page.map((n) => (
            <li key={n.id} className={cn('flex flex-wrap items-center justify-between gap-3 px-4 py-3', !n.read && 'bg-primary/5')}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs font-medium text-primary">{KIND_LABEL[n.kind] ?? n.kind}</span>
                {isSafeTargetPath(n.targetPath) ? (
                  <Link href={n.targetPath} className={cn('text-sm hover:text-primary', n.read ? 'text-muted-foreground' : 'font-medium text-foreground')}>
                    {n.title}
                  </Link>
                ) : (
                  <span className="text-sm text-foreground">{n.title}</span>
                )}
                <time className="text-xs text-muted-foreground">{formatUtc(n.createdAt)}</time>
              </div>
              {!n.read ? <MarkReadForm ids={[n.id]} /> : <span className="text-xs text-muted-foreground">Read</span>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No notifications.</EmptyState>
      )}
      {items.length > PAGE ? (
        <Link href={`/admin/notifications?before=${page[page.length - 1].id}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-start')}>
          Older
        </Link>
      ) : null}
    </>
  )
}
