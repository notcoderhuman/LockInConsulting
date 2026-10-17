import { BILLING_PERIOD_LABEL, FEE_CATEGORY_LABEL } from '@/lib/data/labels'
import { formatInr, formatIsoDate, formatMoney } from '@/lib/data/money'
import type { PublicTuitionFee } from '@/lib/data/types'
import { DataStatusBadge } from './data-status-badge'
import { SourceCitation } from './source-citation'

export function TuitionFee({ fee }: { fee: PublicTuitionFee }) {
  if (fee.status === 'unavailable' || fee.amount == null) {
    return (
      <div className="flex flex-col gap-1">
        <DataStatusBadge state="unavailable" className="self-start" />
        <SourceCitation source={fee.source} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-foreground">
        <span className="font-medium">{formatMoney(fee.amount, fee.currency)}</span>{' '}
        <span className="text-muted-foreground">
          {BILLING_PERIOD_LABEL[fee.billingPeriod]}
          {fee.academicYear ? ` · ${fee.academicYear}` : ''}
          {' · '}
          {FEE_CATEGORY_LABEL[fee.category]}
        </span>
      </p>
      {fee.inr ? (
        <p className="text-xs text-muted-foreground">
          {'≈ '}
          {formatInr(fee.inr.amountInr)} at {fee.inr.rate} INR/{fee.currency}, rate dated {formatIsoDate(fee.inr.rateDate)} (
          <a href={fee.inr.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-4">
            {fee.inr.sourceTitle}
          </a>
          {fee.inr.attributionText ? ` · ${fee.inr.attributionText}` : ''}
          )
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">INR estimate unavailable: no current exchange rate on file.</p>
      )}
      {fee.validTo && <p className="text-xs text-muted-foreground">Valid until {formatIsoDate(fee.validTo)}</p>}
      <SourceCitation source={fee.source} />
    </div>
  )
}
