import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { HistoryList } from '@/components/admin/history-list'
import { EmptyState, PageHeader, Panel } from '@/components/admin/page-header'
import { PublicationBadge } from '@/components/admin/status-badge'
import { requireAdminPage } from '@/lib/admin/access'
import { ENTITIES, humanize } from '@/lib/admin/entities'
import { getSourceDetail } from '@/lib/admin/queries'
import { formatDate, formatUtc, positiveInt, recordHref } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'

export const metadata: Metadata = { title: 'Source' }

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage('data.read')
  const id = positiveInt((await params).id)
  if (id == null) notFound()
  const detail = await getSourceDetail(getAdminPool(), id)
  if (!detail) notFound()
  const { source, citations, history, names } = detail

  return (
    <>
      <PageHeader title={String(source.title)} crumbs={[{ href: '/admin/sources', label: 'Data sources' }]} description={String(source.publisher)} />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-3">
          <Panel title={`Cited by (${citations.length})`}>
            {citations.length ? (
              <ul className="flex flex-col divide-y divide-border">
                {citations.map((c) => (
                  <li key={`${c.entity}-${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <Link href={recordHref(c.entity, c.id)} className="min-w-0 text-sm text-foreground hover:text-primary">
                      {c.title}
                      <span className="block text-xs text-muted-foreground">{ENTITIES[c.entity].label}</span>
                    </Link>
                    <PublicationBadge status={c.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>No record cites this source yet.</EmptyState>
            )}
          </Panel>
          <Panel title="History">
            <HistoryList rows={history} names={names} />
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel title="Details">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">URL</dt>
                <dd>
                  <a href={String(source.url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
                    {String(source.url)}
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </dd>
              </div>
              {[
                ['Type', humanize(String(source.source_type))],
                ['Retrieved', formatDate(source.retrieved_at)],
                ['Added by', `${names.get(String(source.added_by)) ?? String(source.added_by ?? '—')}`],
                ['Added', formatUtc(source.created_at)],
                ['Notes', source.notes ? String(source.notes) : '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="leading-relaxed whitespace-pre-line text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Sources are never edited or deleted, so every citation keeps pointing at what was actually checked. Record a new source when a page changes.
            </p>
          </Panel>
        </div>
      </div>
    </>
  )
}
