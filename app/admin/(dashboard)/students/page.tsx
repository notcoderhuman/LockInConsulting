import type { Metadata } from 'next'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/admin/page-header'
import { requireAdminPage } from '@/lib/admin/access'
import { humanize } from '@/lib/admin/entities'
import { firstParam, formatUtc, positiveInt } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'
import { listStudents, STUDENTS_PAGE_SIZE } from '@/lib/support/conversations'

export const metadata: Metadata = { title: 'Students' }

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdminPage('students.read')
  const page = positiveInt(firstParam((await searchParams).page)) ?? 1
  const { rows, total } = await listStudents(getAdminPool(), actor, { page })
  const pages = Math.max(1, Math.ceil(total / STUDENTS_PAGE_SIZE))

  return (
    <>
      <PageHeader
        title="Students"
        description="Only what support needs: display name, sign-in email, account status and conversations. Student sign-up is closed until the privacy and legal review is complete."
      />
      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{`Students, page ${page} of ${pages}`}</caption>
            <thead className="bg-card">
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">Name</th>
                <th scope="col" className="px-4 py-2 font-medium">Email</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Conversations</th>
                <th scope="col" className="px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link href={`/admin/students/${s.id}`} className="text-foreground hover:text-primary">
                      {s.displayName}
                    </Link>
                  </th>
                  <td className="px-4 py-3 text-muted-foreground">{s.email ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{humanize(s.status)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{s.conversations}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatUtc(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No student accounts. Student sign-up is disabled.</EmptyState>
      )}
      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          {page > 1 ? <Link href={`/admin/students?page=${page - 1}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Previous</Link> : <span />}
          <span className="text-xs text-muted-foreground">{`Page ${page} of ${pages}`}</span>
          {page < pages ? <Link href={`/admin/students?page=${page + 1}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Next</Link> : <span />}
        </nav>
      ) : null}
    </>
  )
}
