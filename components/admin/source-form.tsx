'use client'

import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { createSourceAction } from '@/app/admin/actions'
import { humanize } from '@/lib/admin/entities'
import { SOURCE_TYPES } from '@/lib/data/types'
import { controlClass, Field, FormMessage } from './form-controls'
import { useFormAction } from './use-form-action'

export function SourceForm({ today, returnTo, defaultType }: { today: string; returnTo?: string; defaultType?: string }) {
  const { state, pending, onSubmit } = useFormAction(createSourceAction)
  const e = state?.fieldErrors ?? {}
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <div className="grid gap-5 md:grid-cols-2">
        <Field id="s-url" label="Page URL" required errors={e.url} help="The exact official page, using https." className="md:col-span-2">
          <input id="s-url" name="url" type="url" required placeholder="https://" className={controlClass} />
        </Field>
        <Field id="s-title" label="Page title" required errors={e.title}>
          <input id="s-title" name="title" required maxLength={300} className={controlClass} />
        </Field>
        <Field id="s-publisher" label="Publisher" required errors={e.publisher} help="The organisation that publishes the page.">
          <input id="s-publisher" name="publisher" required maxLength={200} className={controlClass} />
        </Field>
        <Field id="s-type" label="Source type" required errors={e.sourceType}>
          <select id="s-type" name="sourceType" required defaultValue={defaultType ?? ''} className={controlClass}>
            <option value="">Choose…</option>
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="s-retrieved" label="Retrieved on" required errors={e.retrievedAt}>
          <input id="s-retrieved" name="retrievedAt" type="date" max={today} defaultValue={today} required className={controlClass} />
        </Field>
        <Field id="s-notes" label="Notes" errors={e.notes} className="md:col-span-2">
          <textarea id="s-notes" name="notes" rows={3} maxLength={5000} className={controlClass} />
        </Field>
      </div>
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Record source'}
        </Button>
        <Link href={returnTo ?? '/admin/sources'} className={buttonVariants({ variant: 'ghost' })}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
