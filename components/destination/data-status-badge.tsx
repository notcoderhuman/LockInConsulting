import type { DisplayState } from '@/lib/data/publication'
import { cn } from '@/lib/utils'

export const DISPLAY_STATE_LABEL: Record<DisplayState, string> = {
  verified: 'Verified',
  unverified: 'Pending verification',
  expired: 'Expired — re-checking',
  unavailable: 'Not publicly available',
  unpublished: 'Unpublished',
}

export const DISPLAY_STATE_DESCRIPTION: Record<DisplayState, string> = {
  verified: 'Checked against the cited official source on the date shown, and inside its review window.',
  unverified: 'Collected but not yet checked by a reviewer. Never shown as a figure.',
  expired: 'Its review date or fee validity has passed. Hidden until someone re-checks the source.',
  unavailable: 'A reviewer checked the official source and it does not publish this figure.',
  unpublished: 'Held back by an administrator, for example while ranking rights are unconfirmed.',
}

const STYLE: Record<DisplayState, string> = {
  verified: 'border-primary/60 text-primary',
  unverified: 'border-border text-muted-foreground',
  expired: 'border-destructive/50 text-destructive',
  unavailable: 'border-dashed border-muted-foreground/50 text-muted-foreground',
  unpublished: 'border-border text-muted-foreground',
}

export function DataStatusBadge({ state, className }: { state: DisplayState; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide',
        STYLE[state],
        className,
      )}
    >
      {DISPLAY_STATE_LABEL[state]}
    </span>
  )
}
