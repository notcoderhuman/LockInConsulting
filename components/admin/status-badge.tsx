import { PUBLICATION_LABEL, VERIFICATION_LABEL } from '@/lib/admin/describe'
import { cn } from '@/lib/utils'

const PUBLICATION_STYLE: Record<string, string> = {
  draft: 'border-border text-muted-foreground',
  in_review: 'border-primary/50 text-primary',
  published: 'border-primary bg-primary text-primary-foreground',
  unpublished: 'border-destructive/50 text-destructive',
}

const VERIFICATION_STYLE: Record<string, string> = {
  unverified: 'border-border text-muted-foreground',
  verified: 'border-primary/50 text-foreground',
  unavailable: 'border-primary/30 text-muted-foreground',
}

export function PublicationBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', PUBLICATION_STYLE[status])}>
      {PUBLICATION_LABEL[status] ?? status}
    </span>
  )
}

export function VerificationBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap', VERIFICATION_STYLE[status])}>
      {VERIFICATION_LABEL[status] ?? status}
    </span>
  )
}

export function LiveBadge({ live }: { live: boolean | null }) {
  if (live === null) return <span className="text-xs text-muted-foreground">Not shown publicly</span>
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', live ? 'text-primary' : 'text-muted-foreground')}>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', live ? 'bg-primary' : 'bg-muted-foreground/50')} />
      {live ? 'Live on site' : 'Not live'}
    </span>
  )
}
