import type { Metadata } from 'next'
import Link from 'next/link'
import { EmptyState, PageHeader } from '@/components/admin/page-header'
import { VerificationBadge } from '@/components/admin/status-badge'
import { requireAdminPage } from '@/lib/admin/access'
import { ENTITIES } from '@/lib/admin/entities'
import { getReviewQueue, REVIEW_HORIZON_DAYS, type QueueReason } from '@/lib/admin/queries'
import { firstParam, formatDate, recordHref } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Review queue' }

const TABS: { value: QueueReason | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expired', label: 'Overdue' },
  { value: 'in_review', label: 'Awaiting review' },
  { value: 'due_soon', label: 'Due soon' },
]

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('data.read')
  const requested = firstParam((await searchParams).reason)
  const reason = TABS.some((t) => t.value === requested) ? (requested as QueueReason | 'all') : 'all'
  const queue = await getReviewQueue(getAdminPool())
  const items = reason === 'all' ? queue : queue.filter((i) => i.reason === reason)

  return (
    <>
      <PageHeader
        title="Review queue"
        description={`Records awaiting a reviewer, plus published records whose review date or fee validity has passed or falls within ${REVIEW_HORIZON_DAYS} days. Overdue records disappear from the public site automatically.`}
      />
      <nav aria-label="Filter queue">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const count = t.value === 'all' ? queue.length : queue.filter((i) => i.reason === t.value).length
            const active = t.value === reason
            return (
              <li key={t.value}>
                <Link
                  href={t.value === 'all' ? '/admin/review' : `/admin/review?reason=${t.value}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.label}
                  <span className="tabular-nums">{count}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {items.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Review queue ({items.length})</caption>
            <thead className="bg-card">
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">Record</th>
                <th scope="col" className="px-4 py-3 font-medium">Why</th>
                <th scope="col" className="px-4 py-3 font-medium">Review due</th>
                <th scope="col" className="px-4 py-3 font-medium">Verification</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={`${i.entity}-${i.id}`} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link href={recordHref(i.entity, i.id)} className="text-foreground hover:text-primary">
                      {i.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {ENTITIES[i.entity].label}
                      {i.context ? ` · ${i.context}` : ''}
                    </span>
                  </th>
                  <td className={cn('px-4 py-3 whitespace-nowrap', i.reason === 'expired' ? 'text-destructive' : 'text-muted-foreground')}>
                    {i.reason === 'expired' ? 'Overdue' : i.reason === 'in_review' ? 'Awaiting review' : 'Due soon'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(i.reviewDueAt)}
                    {i.validTo ? <span className="block text-xs">{`Fee valid to ${formatDate(i.validTo)}`}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <VerificationBadge status={i.verificationStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>Nothing in this queue.</EmptyState>
      )}
    </>
  )
}
