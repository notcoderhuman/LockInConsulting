import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const controlClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60 aria-[invalid=true]:border-destructive'

export function Field({
  id,
  label,
  required,
  help,
  errors,
  children,
  className,
}: {
  id: string
  label: string
  required?: boolean
  help?: string
  errors?: string[]
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span className="text-primary" aria-hidden="true">
            {' *'}
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {children}
      {help ? (
        <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">
          {help}
        </p>
      ) : null}
      {errors?.length ? (
        <p id={`${id}-error`} className="text-xs leading-relaxed text-destructive" role="alert">
          {errors.join(' ')}
        </p>
      ) : null}
    </div>
  )
}

export function describedBy(id: string, help?: string, errors?: string[]) {
  return [help ? `${id}-help` : null, errors?.length ? `${id}-error` : null].filter(Boolean).join(' ') || undefined
}

export function FormMessage({ state }: { state: { ok: boolean; message?: string; blockers?: string[] } | null }) {
  if (!state?.message) return null
  return (
    <div
      role={state.ok ? 'status' : 'alert'}
      className={cn(
        'rounded-md border px-3 py-2 text-sm leading-relaxed',
        state.ok ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-destructive/50 bg-destructive/10 text-foreground',
      )}
    >
      <p>{state.message}</p>
      {state.blockers?.length ? (
        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-muted-foreground">
          {state.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
