import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { controlClass } from '@/components/admin/form-controls'
import { EmptyState, PageHeader } from '@/components/admin/page-header'
import { PublicationBadge, VerificationBadge } from '@/components/admin/status-badge'
import { requireAdminPage } from '@/lib/admin/access'
import { PUBLICATION_LABEL } from '@/lib/admin/describe'
import { listUniversities } from '@/lib/admin/queries'
import { can } from '@/lib/admin/roles'
import { firstParam, recordHref } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'
import { DESTINATIONS } from '@/lib/destinations'

export const metadata: Metadata = { title: 'University data' }

type Search = Promise<Record<string, string | string[] | undefined>>

export default async function UniversitiesPage({ searchParams }: { searchParams: Search }) {
  const actor = await requireAdminPage('data.read')
  const sp = await searchParams
  const destination = firstParam(sp.destination)
  const status = firstParam(sp.status)
  const q = firstParam(sp.q)?.slice(0, 100)
  const filters = {
    destination: DESTINATIONS.some((d) => d.iso2 === destination) ? destination : undefined,
    status: status && status in PUBLICATION_LABEL ? status : undefined,
    q,
  }
  const rows = await listUniversities(getAdminPool(), filters)
  const destName = new Map(DESTINATIONS.map((d) => [d.iso2, d.name]))

  return (
    <>
      <PageHeader
        title="University data"
        description="Capture universities from their official pages, then add campuses, courses, fees, intakes, acceptance rates and rankings."
        actions={
          can(actor.role, 'data.capture') ? (
            <Link href="/admin/records/university/new" className={buttonVariants()}>
              <Plus aria-hidden="true" />
              Add university
            </Link>
          ) : null
        }
      />

      <form role="search" aria-label="Filter universities" className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">Search by name</span>
          <input name="q" type="search" defaultValue={q} className={controlClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm md:w-48">
          <span className="font-medium text-foreground">Destination</span>
          <select name="destination" defaultValue={filters.destination ?? ''} className={controlClass}>
            <option value="">All 11</option>
            {DESTINATIONS.map((d) => (
              <option key={d.iso2} value={d.iso2}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm md:w-44">
          <span className="font-medium text-foreground">Status</span>
          <select name="status" defaultValue={filters.status ?? ''} className={controlClass}>
            <option value="">Any</option>
            {Object.entries(PUBLICATION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Filter
        </button>
      </form>

      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Universities ({rows.length})</caption>
            <thead className="bg-card">
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">University</th>
                <th scope="col" className="px-4 py-3 font-medium">Destination</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Courses</th>
                <th scope="col" className="px-4 py-3 font-medium">Verification</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={String(u.id)} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <Link href={recordHref('university', u.id)} className="text-foreground hover:text-primary">
                      {String(u.name)}
                    </Link>
                    {u.city ? <span className="block text-xs text-muted-foreground">{String(u.city)}</span> : null}
                  </th>
                  <td className="px-4 py-3 text-muted-foreground">{destName.get(String(u.destination_iso2)) ?? String(u.destination_iso2)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{Number(u.course_count)}</td>
                  <td className="px-4 py-3">
                    <VerificationBadge status={String(u.verification_status)} />
                  </td>
                  <td className="px-4 py-3">
                    <PublicationBadge status={String(u.publication_status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>
          {filters.destination || filters.status || filters.q
            ? 'No universities match these filters.'
            : 'No universities have been captured yet. Add the first one from its official website.'}
        </EmptyState>
      )}
    </>
  )
}
