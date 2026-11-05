'use client'

import type { ListingSummary } from '@/lib/data/types'
import { useT } from '@/lib/i18n/client'
import { cn } from '@/lib/utils'

const badge = 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide'

/**
 * Listing labels. Verification and identity-check status are not shown publicly (owner decision, 5 Nov 2026);
 * they stay in the database and the admin. Only the institution-type note remains.
 */
export function ListingStatus({ listing }: { listing: Pick<ListingSummary, 'category'> }) {
  const { t } = useT()
  if (listing.category !== 'other') return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('common.status')}>
      <li className={cn(badge, 'border-border text-muted-foreground')}>{t('status.otherType')}</li>
    </ul>
  )
}
