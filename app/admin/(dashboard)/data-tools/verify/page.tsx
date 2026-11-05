import type { Metadata } from 'next'
import Link from 'next/link'
import { BulkVerifyForm } from '@/components/admin/data-tools-forms'
import { EmptyState, PageHeader, Panel } from '@/components/admin/page-header'
import { requireAdminPage } from '@/lib/admin/access'
import { BULK_VERIFY_LIMIT, listInReview } from '@/lib/admin/data-tools'
import { ENTITIES, isEntityKey, type EntityKey } from '@/lib/admin/entities'
import { firstParam } from '@/lib/admin/view'
import { todayIso } from '@/lib/data/publication'
import { getAdminPool } from '@/lib/db/pool'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Bulk verification' }

const TYPES: EntityKey[] = ['university', 'campus', 'course', 'course_intake', 'tuition_fee', 'acceptance_rate', 'university_ranking']

export default async function BulkVerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('data.bulk_verify')
  const requested = firstParam((await searchParams).entity)
  const entity: EntityKey = requested && isEntityKey(requested) ? requested : 'university'
  const items = await listInReview(getAdminPool(), entity)
  const today = todayIso()
  const due = new Date(Date.parse(`${today}T00:00:00Z`) + 180 * 86_400_000).toISOString().slice(0, 10)

  return (
    <>
      <PageHeader
        title="Bulk verification"
        crumbs={[{ href: '/admin/data-tools', label: 'Data tools' }]}
        description={`Owner only. Each ticked record is verified against its own recorded source through the normal verify step, one by one, up to ${BULK_VERIFY_LIMIT} at a time. Open every source first: ticking a record states you checked it. Publishing stays a separate step.`}
      />
      <nav aria-label="Record type">
        <ul className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <li key={t}>
              <Link
                href={`/admin/data-tools/verify?entity=${t}`}
                aria-current={t === entity ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition-colors',
                  t === entity ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {ENTITIES[t].plural}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Panel title={`${ENTITIES[entity].plural} awaiting review (${items.length})`}>
        {items.length ? (
          <BulkVerifyForm
            entity={entity}
            today={today}
            defaultDue={due}
            items={items.map((i) => ({
              id: Number(i.id),
              label: String(i.label),
              sourceUrl: i.source_url == null ? null : String(i.source_url),
              sourceTitle: i.source_title == null ? null : String(i.source_title),
              sourceType: i.source_type == null ? null : String(i.source_type),
            }))}
          />
        ) : (
          <EmptyState>Nothing of this type is awaiting review.</EmptyState>
        )}
      </Panel>
    </>
  )
}
