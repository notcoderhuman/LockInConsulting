import { STATUS_LABEL, isConversationStatus } from '@/lib/support/state'
import { cn } from '@/lib/utils'

const STYLE: Record<string, string> = {
  open: 'border-primary/50 text-primary',
  awaiting_human_review: 'border-primary bg-primary/10 text-primary',
  awaiting_student_reply: 'border-border text-muted-foreground',
  resolved: 'border-border text-muted-foreground',
  failed: 'border-destructive/60 text-destructive',
}

export function ConversationBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', STYLE[status])}>
      {isConversationStatus(status) ? STATUS_LABEL[status] : status}
    </span>
  )
}

const RISK_STYLE: Record<string, string> = {
  low: 'border-border text-muted-foreground',
  uncertain: 'border-primary/60 text-primary',
  high: 'border-destructive/60 bg-destructive/10 text-destructive',
}

export function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return null
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', RISK_STYLE[risk])}>
      {risk === 'low' ? 'Low risk' : risk === 'high' ? 'High risk' : 'Uncertain'}
    </span>
  )
}
