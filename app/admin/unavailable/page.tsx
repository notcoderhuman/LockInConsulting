import type { Metadata } from 'next'
import Link from 'next/link'
import { GateCard } from '@/components/admin/gate-card'
import { getAdminConfigStatus } from '@/lib/admin/config'

export const metadata: Metadata = { title: 'Unavailable' }
export const dynamic = 'force-dynamic'

export default function UnavailablePage() {
  const status = getAdminConfigStatus()
  return (
    <GateCard title="The admin area is unavailable">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {status.ok
          ? 'The database or session service could not be reached. Nothing has been changed. Try again shortly.'
          : 'The admin area is switched off until its configuration is complete. It fails closed rather than running without protection.'}
      </p>
      {!status.ok ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-muted-foreground">
          {/* Problems name missing settings only; values are never shown. */}
          {status.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <Link href="/" className="text-sm text-primary hover:underline">
        Back to the public site
      </Link>
    </GateCard>
  )
}
