import { ACTION_LABEL } from '@/lib/admin/describe'
import type { Row } from '@/lib/admin/queries'
import { changedColumns, formatUtc } from '@/lib/admin/view'
import { EmptyState } from './page-header'

export function HistoryList({ rows, names }: { rows: Row[]; names: Map<string, string> }) {
  if (!rows.length) return <EmptyState>No changes recorded yet.</EmptyState>
  return (
    <ol className="flex flex-col divide-y divide-border">
      {rows.map((h) => {
        const changed = h.action === 'update' ? changedColumns(h.before_data, h.after_data) : []
        return (
          <li key={String(h.id)} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{ACTION_LABEL[String(h.action)] ?? String(h.action)}</span>
              <time className="text-xs text-muted-foreground">{formatUtc(h.created_at)}</time>
            </div>
            <span className="text-xs text-muted-foreground">
              {names.get(String(h.actor_id)) ?? String(h.actor_id)}
              {h.actor_role ? ` · ${String(h.actor_role)}` : ''}
            </span>
            {h.reason ? <p className="text-sm leading-relaxed text-muted-foreground">{`“${String(h.reason)}”`}</p> : null}
            {changed.length ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {'Changed: '}
                <span className="font-mono text-foreground/80">{changed.join(', ')}</span>
              </p>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
