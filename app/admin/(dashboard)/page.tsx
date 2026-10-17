import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { EmptyState, PageHeader, Panel } from '@/components/admin/page-header'
import { requireAdminPage } from '@/lib/admin/access'
import { ENTITIES, ENTITY_KEYS } from '@/lib/admin/entities'
import { getChainStatus, getReviewQueue, getStatusCounts, REVIEW_HORIZON_DAYS } from '@/lib/admin/queries'
import { ROLE_LABEL } from '@/lib/admin/roles'
import { formatDate, recordHref } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'

export const metadata: Metadata = { title: 'Overview' }

const REASON_LABEL = { expired: 'Overdue', in_review: 'Awaiting review', due_soon: 'Due soon' } as const

export default async function OverviewPage() {
  const actor = await requireAdminPage('data.read')
  const db = getAdminPool()
  const [counts, queue, chain] = await Promise.all([getStatusCounts(db), getReviewQueue(db), getChainStatus(db)])
  const tally = { expired: 0, in_review: 0, due_soon: 0 }
  for (const item of queue) tally[item.reason]++

  return (
    <>
      <PageHeader
        title={`Good to see you, ${actor.name.split(' ')[0]}`}
        description={`Signed in as ${ROLE_LABEL[actor.role]}. Only verified, published records reach students; everything else stays here.`}
      />

      <section aria-label="Review summary" className="grid gap-4 sm:grid-cols-3">
        {(Object.keys(tally) as (keyof typeof tally)[]).map((reason) => (
          <Link
            key={reason}
            href={`/admin/review?reason=${reason}`}
            className="flex flex-col gap-1 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
          >
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{REASON_LABEL[reason]}</span>
            <span className={reason === 'expired' && tally[reason] > 0 ? 'font-serif text-4xl text-destructive' : 'font-serif text-4xl text-foreground'}>
              {tally[reason]}
            </span>
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title="Records by status" description="Across all 11 destinations.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">Type</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Draft</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">In review</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Published</th>
                    <th scope="col" className="py-2 text-right font-medium">Unpublished</th>
                  </tr>
                </thead>
                <tbody>
                  {ENTITY_KEYS.map((key) => (
                    <tr key={key} className="border-b border-border/60 last:border-0">
                      <th scope="row" className="py-2.5 pr-4 text-left font-normal text-foreground">{ENTITIES[key].plural}</th>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">{counts[key].draft}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">{counts[key].in_review}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-primary">{counts[key].published}</td>
                      <td className="py-2.5 text-right tabular-nums text-muted-foreground">{counts[key].unpublished}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel title="Change log integrity">
            <div className="flex items-start gap-3">
              {chain.ok ? (
                <ShieldCheck className="mt-0.5 size-5 text-primary" aria-hidden="true" />
              ) : (
                <ShieldAlert className="mt-0.5 size-5 text-destructive" aria-hidden="true" />
              )}
              <p className="text-sm leading-relaxed text-muted-foreground">
                {chain.ok
                  ? `All ${chain.checked} entries verify. No entry has been altered or removed.`
                  : `The chain breaks${chain.brokenAtId != null ? ` at entry #${chain.brokenAtId}` : ''}: ${chain.reason}. Investigate before relying on the history.`}
              </p>
            </div>
            <Link href="/admin/changes" className="text-sm text-primary hover:underline">
              Open the change log
            </Link>
          </Panel>

          <Panel title="Next up" description={`Overdue and due within ${REVIEW_HORIZON_DAYS} days.`}>
            {queue.length ? (
              <ul className="flex flex-col divide-y divide-border">
                {queue.slice(0, 5).map((item) => (
                  <li key={`${item.entity}-${item.id}`} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={recordHref(item.entity, item.id)} className="min-w-0 text-sm text-foreground hover:text-primary">
                      <span className="block truncate">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {ENTITIES[item.entity].label}
                        {item.context ? ` · ${item.context}` : ''}
                      </span>
                    </Link>
                    <span className={item.reason === 'expired' ? 'shrink-0 text-xs text-destructive' : 'shrink-0 text-xs text-muted-foreground'}>
                      {item.reason === 'in_review' ? 'In review' : formatDate(item.reviewDueAt ?? item.validTo)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>Nothing needs attention.</EmptyState>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}
