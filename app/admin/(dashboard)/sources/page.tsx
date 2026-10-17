import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { controlClass } from '@/components/admin/form-controls'
import { EmptyState, PageHeader } from '@/components/admin/page-header'
import { requireAdminPage } from '@/lib/admin/access'
import { humanize } from '@/lib/admin/entities'
import { listSources } from '@/lib/admin/queries'
import { can } from '@/lib/admin/roles'
import { firstParam, formatDate } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'

export const metadata: Metadata = { title: 'Data sources' }

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdminPage('data.read')
  const q = firstParam((await searchParams).q)?.slice(0, 100)
  const rows = await listSources(getAdminPool(), q)

  return (
    <>
      <PageHeader
        title="Data sources"
        description="Every official page a value was copied from. Each source records who added it and when it was retrieved."
        actions={
          can(actor.role, 'data.capture') ? (
            <Link href="/admin/sources/new" className={buttonVariants()}>
              <Plus aria-hidden="true" />
              Record source
            </Link>
          ) : null
        }
      />
      <form role="search" aria-label="Search sources" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">Search title, publisher or URL</span>
          <input name="q" type="search" defaultValue={q} className={controlClass} />
        </label>
        <button type="submit" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Search
        </button>
      </form>

      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Sources ({rows.length})</caption>
            <thead className="bg-card">
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">Page</th>
                <th scope="col" className="px-4 py-3 font-medium">Type</th>
                <th scope="col" className="px-4 py-3 font-medium">Retrieved</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Cited by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={String(s.id)} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link href={`/admin/sources/${s.id}`} className="text-foreground hover:text-primary">
                      {String(s.title)}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{String(s.publisher)}</span>
                  </th>
                  <td className="px-4 py-3 text-muted-foreground">{humanize(String(s.source_type))}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(s.retrieved_at)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{Number(s.citation_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>{q ? 'No sources match that search.' : 'No sources recorded yet.'}</EmptyState>
      )}
    </>
  )
}
