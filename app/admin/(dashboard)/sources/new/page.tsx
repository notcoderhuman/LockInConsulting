import type { Metadata } from 'next'
import { PageHeader, Panel } from '@/components/admin/page-header'
import { SourceForm } from '@/components/admin/source-form'
import { requireAdminPage } from '@/lib/admin/access'
import { firstParam } from '@/lib/admin/view'
import { todayIso } from '@/lib/data/publication'
import { SOURCE_TYPES } from '@/lib/data/types'

export const metadata: Metadata = { title: 'Record source' }

const SAFE_RETURN = /^\/admin\/[a-z0-9_/\-?=&]*$/i

export default async function NewSourcePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('data.capture')
  const sp = await searchParams
  const returnTo = firstParam(sp.returnTo)
  const type = firstParam(sp.type)
  return (
    <>
      <PageHeader
        title="Record a source"
        crumbs={[{ href: '/admin/sources', label: 'Data sources' }]}
        description="Only official pages: the university itself, a government body or regulator, or a licensed provider. Do not cite aggregators."
      />
      <Panel title="Source">
        <SourceForm
          today={todayIso()}
          returnTo={returnTo && SAFE_RETURN.test(returnTo) ? returnTo : undefined}
          defaultType={type && (SOURCE_TYPES as readonly string[]).includes(type) ? type : undefined}
        />
      </Panel>
    </>
  )
}
