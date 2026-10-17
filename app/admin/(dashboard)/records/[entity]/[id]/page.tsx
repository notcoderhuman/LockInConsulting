import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ExternalLink, Pencil, Plus } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { HistoryList } from '@/components/admin/history-list'
import { EmptyState, PageHeader, Panel } from '@/components/admin/page-header'
import { LiveBadge, PublicationBadge, VerificationBadge } from '@/components/admin/status-badge'
import { WorkflowPanel } from '@/components/admin/workflow-panel'
import { requireAdminPage } from '@/lib/admin/access'
import { recordTitle } from '@/lib/admin/describe'
import { ENTITIES, humanize, isEntityKey } from '@/lib/admin/entities'
import { getFormOptions, getRecordDetail, owningUniversityId } from '@/lib/admin/queries'
import { can } from '@/lib/admin/roles'
import { addDaysIso, displayValue, formatDate, formatUtc, positiveInt, recordHref } from '@/lib/admin/view'
import { availableActions } from '@/lib/admin/workflow'
import { todayIso } from '@/lib/data/publication'
import { getAdminPool } from '@/lib/db/pool'

export const metadata: Metadata = { title: 'Record' }

const DEFAULT_REVIEW_INTERVAL_DAYS = 180

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm leading-relaxed break-words text-foreground">{children}</dd>
    </div>
  )
}

export default async function RecordPage({ params }: { params: Promise<{ entity: string; id: string }> }) {
  const actor = await requireAdminPage('data.read')
  const { entity, id: rawId } = await params
  const id = positiveInt(rawId)
  if (!isEntityKey(entity) || id == null) notFound()
  const db = getAdminPool()
  const detail = await getRecordDetail(db, entity, id)
  if (!detail) notFound()

  const { row, ancestors, children, source, readiness, history, names, providerName } = detail
  const def = ENTITIES[entity]
  const options = await getFormOptions(db, await owningUniversityId(db, entity, null, row))
  const lookups = {
    source: new Map(options.source.map((o) => [o.value, o.label])),
    campus: new Map(options.campus.map((o) => [o.value, o.label])),
    course: new Map(options.course.map((o) => [o.value, o.label])),
    ranking_provider: new Map([[String(row.provider_id), providerName ?? `#${row.provider_id}`]]),
  }
  const status = String(row.publication_status)
  const actions = availableActions(row, actor.role)
  const today = todayIso()
  const canEdit = can(actor.role, 'data.capture') && status !== 'published'
  const title = recordTitle(entity, row)

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ href: '/admin/universities', label: 'University data' }, ...ancestors.map((a) => ({ href: recordHref(a.entity, a.id), label: a.title }))]}
        description={
          <div className="flex flex-wrap items-center gap-2">
            <span>{def.label}</span>
            <PublicationBadge status={status} />
            <VerificationBadge status={String(row.verification_status)} />
            <LiveBadge live={readiness.live} />
          </div>
        }
        actions={
          canEdit ? (
            <Link href={`${recordHref(entity, id)}/edit`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil aria-hidden="true" />
              Edit
            </Link>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-3">
          <Panel title="Captured values">
            <dl className="grid gap-4 sm:grid-cols-2">
              {def.fields.map((f) => (
                <div key={f.name} className={f.kind === 'textarea' ? 'sm:col-span-2' : undefined}>
                  <Meta label={f.label}>
                    <span className="whitespace-pre-line">{displayValue(f, row, lookups)}</span>
                  </Meta>
                </div>
              ))}
            </dl>
          </Panel>

          {children.map((child) => {
            const cdef = ENTITIES[child.entity]
            return (
              <Panel
                key={child.entity}
                title={cdef.plural}
                actions={
                  can(actor.role, 'data.capture') ? (
                    <Link href={`/admin/records/${child.entity}/new?parent=${id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                      <Plus aria-hidden="true" />
                      Add
                    </Link>
                  ) : null
                }
              >
                {child.rows.length ? (
                  <ul className="flex flex-col divide-y divide-border">
                    {child.rows.map((c) => (
                      <li key={String(c.id)} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                        <Link href={recordHref(child.entity, c.id)} className="min-w-0 text-sm text-foreground hover:text-primary">
                          {recordTitle(child.entity, c)}
                        </Link>
                        <div className="flex items-center gap-2">
                          <VerificationBadge status={String(c.verification_status)} />
                          <PublicationBadge status={String(c.publication_status)} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState>{`No ${cdef.plural.toLowerCase()} yet.`}</EmptyState>
                )}
              </Panel>
            )
          })}

          <Panel title="History" description="From the append-only change log.">
            <HistoryList rows={history} names={names} />
          </Panel>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel title="Publishing">
            {readiness.blockers.length && status !== 'published' ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-foreground">Before this can be published</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-muted-foreground">
                  {readiness.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {readiness.warnings.map((w) => (
              <p key={w} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                {w}
              </p>
            ))}
            {row.unpublished_reason ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {'Unpublished because: '}
                <span className="text-foreground">{String(row.unpublished_reason)}</span>
              </p>
            ) : null}
            <WorkflowPanel
              entity={entity}
              id={id}
              status={status}
              version={`${status}:${row.verification_status}:${String(row.updated_at)}`}
              actions={actions}
              blockers={readiness.blockers}
              allowUnavailable={def.allowUnavailable}
              sources={options.source}
              defaultSourceId={row.source_id == null ? '' : String(row.source_id)}
              today={today}
              defaultReviewDue={addDaysIso(today, DEFAULT_REVIEW_INTERVAL_DAYS)}
            />
          </Panel>

          <Panel title="Verification">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Meta label="Status">{humanize(String(row.verification_status))}</Meta>
              <Meta label="Checked on">{formatDate(row.checked_at)}</Meta>
              <Meta label="Review due">
                <span className={row.review_due_at && String(row.review_due_at) < today ? 'text-destructive' : undefined}>{formatDate(row.review_due_at)}</span>
              </Meta>
              <Meta label="Verified">
                {row.verified_by ? `${names.get(String(row.verified_by)) ?? String(row.verified_by)}, ${formatUtc(row.verified_at)}` : '—'}
              </Meta>
              {row.verification_notes ? <Meta label="Notes">{String(row.verification_notes)}</Meta> : null}
            </dl>
          </Panel>

          <Panel title="Source">
            {source ? (
              <dl className="flex flex-col gap-3">
                <Meta label="Page">
                  <Link href={`/admin/sources/${source.id}`} className="hover:text-primary">
                    {String(source.title)}
                  </Link>
                </Meta>
                <Meta label="Publisher">{String(source.publisher)}</Meta>
                <Meta label="Retrieved">{formatDate(source.retrieved_at)}</Meta>
                <Meta label="URL">
                  <a href={String(source.url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
                    {String(source.url)}
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </Meta>
              </dl>
            ) : (
              <EmptyState>No source linked. A record cannot be verified without one.</EmptyState>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}
