import { formatIsoDate } from '@/lib/data/money'
import type { SourceRef } from '@/lib/data/types'

export function SourceCitation({ source }: { source: SourceRef }) {
  return (
    <span className="text-xs text-muted-foreground">
      Source:{' '}
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-4 hover:text-foreground">
        {source.publisher}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>{' '}
      · checked {formatIsoDate(source.checkedAt)}
    </span>
  )
}
