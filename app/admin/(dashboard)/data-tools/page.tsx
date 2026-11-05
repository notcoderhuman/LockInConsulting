import type { Metadata } from 'next'
import Link from 'next/link'
import { ImportForm, ResolveConflictForm, ScanDuplicatesForm } from '@/components/admin/data-tools-forms'
import { EmptyState, PageHeader, Panel } from '@/components/admin/page-header'
import { requireAdminPage } from '@/lib/admin/access'
import { listConflicts, listImportBatches } from '@/lib/admin/data-tools'
import { ENTITIES, humanize, isEntityKey } from '@/lib/admin/entities'
import { can } from '@/lib/admin/roles'
import { formatDate, recordHref } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'

export const metadata: Metadata = { title: 'Data tools' }

const str = (v: unknown) => (v == null ? '' : String(v))

export default async function DataToolsPage() {
  const actor = await requireAdminPage('data.read')
  const pool = getAdminPool()
  const [open, resolved, batches] = await Promise.all([listConflicts(pool, 'open'), listConflicts(pool, 'resolved', 20), listImportBatches(pool)])
  const capture = can(actor.role, 'data.capture')
  const review = can(actor.role, 'data.review')

  return (
    <>
      <PageHeader
        title="Data tools"
        description="Bulk import, duplicate detection and conflict resolution. Imports only ever create unverified drafts with their sources; verification and publishing stay with reviewers and the Owner."
        actions={
          can(actor.role, 'data.bulk_verify') ? (
            <Link href="/admin/data-tools/verify" className="text-sm text-primary hover:underline">
              Bulk verification
            </Link>
          ) : null
        }
      />

      {capture ? (
        <Panel title="Bulk import" description="Universities with optional courses, intakes and fees. The whole file is validated before anything is written; a file can be imported only once.">
          <ImportForm />
        </Panel>
      ) : null}

      <Panel
        title={`Conflicts and possible duplicates (${open.length} open)`}
        description="Raised by imports and duplicate scans. Nothing changes until a reviewer decides, with a reason."
        actions={capture ? <ScanDuplicatesForm /> : null}
      >
        {open.length ? (
          <ul className="flex flex-col divide-y divide-border">
            {open.map((c) => {
              const entity = str(c.entity_type)
              const href = (id: unknown) => (isEntityKey(entity) ? recordHref(entity, Number(id)) : '#')
              return (
                <li key={str(c.id)} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="text-foreground">
                      {c.kind === 'duplicate' ? 'Possible duplicate: ' : `${humanize(str(c.field_name))} differs on `}
                      <Link href={href(c.entity_id)} className="text-primary hover:underline">
                        {str(c.entity_name) || `${isEntityKey(entity) ? ENTITIES[entity].label : entity} #${str(c.entity_id)}`}
                      </Link>
                      {c.kind === 'duplicate' ? (
                        <>
                          {' and '}
                          <Link href={href(c.other_entity_id)} className="text-primary hover:underline">
                            {str(c.other_name) || `#${str(c.other_entity_id)}`}
                          </Link>
                        </>
                      ) : null}
                    </p>
                    {c.kind === 'field_value' ? (
                      <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-[8rem_1fr]">
                        <dt>Current</dt>
                        <dd className="break-words text-foreground">{str(c.current_value) || '(empty)'}</dd>
                        <dt>Proposed</dt>
                        <dd className="break-words text-foreground">{str(c.proposed_value)}</dd>
                        <dt>Proposed source</dt>
                        <dd className="break-words">
                          {c.proposed_source_url ? (
                            <a href={str(c.proposed_source_url)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              {str(c.proposed_source_title) || str(c.proposed_source_url)}
                              <span className="sr-only"> (opens in a new tab)</span>
                            </a>
                          ) : (
                            'None recorded'
                          )}
                        </dd>
                      </dl>
                    ) : null}
                    {c.detail ? <p className="text-xs text-muted-foreground">{str(c.detail)}</p> : null}
                  </div>
                  {review ? <ResolveConflictForm id={Number(c.id)} kind={c.kind === 'duplicate' ? 'duplicate' : 'field_value'} /> : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState>No open conflicts.</EmptyState>
        )}
      </Panel>

      <Panel title="Recently resolved">
        {resolved.length ? (
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {resolved.map((c) => (
              <li key={str(c.id)}>
                {`#${str(c.id)} ${humanize(str(c.kind))} · ${humanize(str(c.status))} · ${formatDate(c.resolved_at)} · ${str(c.resolution_note)}`}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Nothing resolved yet.</EmptyState>
        )}
      </Panel>

      <Panel title="Import history">
        {batches.length ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Import batches</caption>
              <thead className="bg-card">
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Batch</th>
                  <th scope="col" className="px-4 py-3 font-medium">File</th>
                  <th scope="col" className="px-4 py-3 font-medium">Rows</th>
                  <th scope="col" className="px-4 py-3 font-medium">Created</th>
                  <th scope="col" className="px-4 py-3 font-medium">Matched</th>
                  <th scope="col" className="px-4 py-3 font-medium">Conflicts</th>
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={str(b.id)} className="border-t border-border">
                    <th scope="row" className="px-4 py-3 text-left font-normal">#{str(b.id)}</th>
                    <td className="px-4 py-3 break-all">{str(b.file_name)}</td>
                    <td className="px-4 py-3 tabular-nums">{str(b.rows_total)}</td>
                    <td className="px-4 py-3 tabular-nums">{str(b.created_count)}</td>
                    <td className="px-4 py-3 tabular-nums">{str(b.duplicate_count)}</td>
                    <td className="px-4 py-3 tabular-nums">{str(b.conflict_count)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No imports yet.</EmptyState>
        )}
      </Panel>
    </>
  )
}
