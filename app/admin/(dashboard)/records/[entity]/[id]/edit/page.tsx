import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EntityForm } from '@/components/admin/entity-form'
import { PageHeader, Panel } from '@/components/admin/page-header'
import { requireAdminPage } from '@/lib/admin/access'
import { recordTitle } from '@/lib/admin/describe'
import { ENTITIES, isEntityKey } from '@/lib/admin/entities'
import { getAncestors, getFormOptions, getRecordRow, owningUniversityId } from '@/lib/admin/queries'
import { positiveInt, recordHref, rowToFormValues } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'

export const metadata: Metadata = { title: 'Edit record' }

export default async function EditRecordPage({ params }: { params: Promise<{ entity: string; id: string }> }) {
  await requireAdminPage('data.capture')
  const { entity, id: rawId } = await params
  const id = positiveInt(rawId)
  if (!isEntityKey(entity) || id == null) notFound()
  const db = getAdminPool()
  const row = await getRecordRow(db, entity, id)
  if (!row) notFound()
  const def = ENTITIES[entity]
  const title = recordTitle(entity, row)
  const ancestors = await getAncestors(db, entity, row)
  const crumbs = [
    { href: '/admin/universities', label: 'University data' },
    ...ancestors.map((a) => ({ href: recordHref(a.entity, a.id), label: a.title })),
    { href: recordHref(entity, id), label: title },
  ]
  const here = `/admin/records/${entity}/${id}/edit`

  if (row.publication_status === 'published')
    return (
      <>
        <PageHeader title={`Edit ${def.label.toLowerCase()}`} crumbs={crumbs} />
        <Panel title="This record is live">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Published records can&apos;t be edited in place, so students never see a half-checked value. A reviewer must unpublish it first; then edit and send it back for review.
          </p>
          <Link href={recordHref(entity, id)} className="text-sm text-primary hover:underline">
            Back to the record
          </Link>
        </Panel>
      </>
    )

  const options = await getFormOptions(db, await owningUniversityId(db, entity, null, row))
  return (
    <>
      <PageHeader title={`Edit ${def.label.toLowerCase()}`} crumbs={crumbs} description={title} />
      <Panel
        title="Details"
        actions={
          <Link href={`/admin/sources/new?returnTo=${encodeURIComponent(here)}`} className="text-sm text-primary hover:underline">
            Source not listed? Record it first
          </Link>
        }
      >
        <EntityForm entity={entity} mode="update" id={id} values={rowToFormValues(entity, row)} options={options} cancelHref={recordHref(entity, id)} />
      </Panel>
    </>
  )
}
