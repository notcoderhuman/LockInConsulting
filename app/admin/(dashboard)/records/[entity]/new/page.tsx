import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EntityForm } from '@/components/admin/entity-form'
import { PageHeader, Panel } from '@/components/admin/page-header'
import { requireAdminPage } from '@/lib/admin/access'
import { recordTitle } from '@/lib/admin/describe'
import { ENTITIES, isEntityKey } from '@/lib/admin/entities'
import { getAncestors, getFormOptions, getRecordRow, owningUniversityId } from '@/lib/admin/queries'
import { firstParam, positiveInt, recordHref } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'

export const metadata: Metadata = { title: 'New record' }

export default async function NewRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminPage('data.capture')
  const { entity } = await params
  if (!isEntityKey(entity)) notFound()
  const def = ENTITIES[entity]
  const db = getAdminPool()

  let parentId: number | null = null
  const crumbs = [{ href: '/admin/universities', label: 'University data' }]
  if (def.parent) {
    parentId = positiveInt(firstParam((await searchParams).parent))
    const parent = parentId == null ? null : await getRecordRow(db, def.parent.entity, parentId)
    if (!parent) notFound()
    const ancestors = await getAncestors(db, def.parent.entity, parent)
    for (const a of ancestors) crumbs.push({ href: recordHref(a.entity, a.id), label: a.title })
    crumbs.push({ href: recordHref(def.parent.entity, parentId), label: recordTitle(def.parent.entity, parent) })
  }

  const options = await getFormOptions(db, await owningUniversityId(db, entity, parentId, null))
  const here = `/admin/records/${entity}/new${parentId ? `?parent=${parentId}` : ''}`
  const cancelHref = def.parent && parentId ? recordHref(def.parent.entity, parentId) : '/admin/universities'

  return (
    <>
      <PageHeader title={`New ${def.label.toLowerCase()}`} crumbs={crumbs} description="Copy values exactly as the official source states them. Leave anything the source does not say empty." />
      <Panel
        title="Details"
        actions={
          <Link href={`/admin/sources/new?returnTo=${encodeURIComponent(here)}`} className="text-sm text-primary hover:underline">
            Source not listed? Record it first
          </Link>
        }
      >
        <EntityForm entity={entity} mode="create" parentId={parentId} values={{}} options={options} cancelHref={cancelHref} />
      </Panel>
    </>
  )
}
