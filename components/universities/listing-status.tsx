'use client'

import type { ListingSummary } from '@/lib/data/types'
import { useT } from '@/lib/i18n/client'
import { cn } from '@/lib/utils'

const badge = 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide'

/** The same vocabulary as the directory cards: a verified profile vs. a candidate and its identity state. */
export function ListingStatus({ listing }: { listing: Pick<ListingSummary, 'status' | 'category'> }) {
  const { t } = useT()
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('common.status')}>
      {listing.status === 'verified' ? (
        <li className={cn(badge, 'border-primary/60 text-primary')}>{t('status.verified')}</li>
      ) : (
        <>
          <li className={cn(badge, 'border-border text-muted-foreground')}>{t('status.notYetVerified')}</li>
          <li className={cn(badge, 'border-border text-muted-foreground')}>{listing.status === 'checked' ? t('status.websiteChecked') : t('status.identityPending')}</li>
        </>
      )}
      {listing.category === 'other' && <li className={cn(badge, 'border-border text-muted-foreground')}>{t('status.otherType')}</li>}
    </ul>
  )
}
