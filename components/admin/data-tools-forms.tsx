'use client'

import { Button } from '@/components/ui/button'
import { bulkVerifyAction, importRecordsAction, resolveConflictAction, saveAcademicYearAction, scanDuplicatesAction } from '@/app/admin/actions'
import { controlClass, Field, FormMessage } from './form-controls'
import { useFormAction } from './use-form-action'

export function ImportForm() {
  const { state, pending, onSubmit } = useFormAction(importRecordsAction)
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field id="imp-file" label="Import file (JSON)" required help="Format lockin-import@1, up to 900 KB. Every record is created as an unverified draft; existing records are never changed.">
        <input id="imp-file" name="file" type="file" accept="application/json,.json" required className={controlClass} />
      </Field>
      <FormMessage state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Importing…' : 'Import as drafts'}
        </Button>
      </div>
    </form>
  )
}

export function ScanDuplicatesForm() {
  const { state, pending, onSubmit } = useFormAction(scanDuplicatesAction)
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Scanning…' : 'Scan for possible duplicates'}
        </Button>
      </div>
    </form>
  )
}

const OUTCOME_LABEL: Record<string, string> = {
  kept_current: 'Keep the current value',
  accepted_proposed: 'Accept the proposed value (record returns to unverified)',
  not_duplicate: 'Not a duplicate',
  duplicate_confirmed: 'Confirmed duplicate (unpublish or merge separately)',
  dismissed: 'Dismiss',
}

export function ResolveConflictForm({ id, kind }: { id: number; kind: 'duplicate' | 'field_value' }) {
  const { state, pending, onSubmit } = useFormAction(resolveConflictAction)
  const e = state?.fieldErrors ?? {}
  const outcomes = kind === 'duplicate' ? ['not_duplicate', 'duplicate_confirmed', 'dismissed'] : ['kept_current', 'accepted_proposed', 'dismissed']
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-3 md:grid-cols-2">
        <Field id={`rc-${id}-outcome`} label="Decision" required errors={e.outcome}>
          <select id={`rc-${id}-outcome`} name="outcome" required defaultValue="" className={controlClass}>
            <option value="" disabled>
              Choose…
            </option>
            {outcomes.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`rc-${id}-note`} label="Reason" required errors={e.note} help="Stored in the change log.">
          <input id={`rc-${id}-note`} name="note" required maxLength={1000} className={controlClass} />
        </Field>
      </div>
      <FormMessage state={state} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Resolve'}
        </Button>
      </div>
    </form>
  )
}

export interface BulkItem {
  id: number
  label: string
  sourceUrl: string | null
  sourceTitle: string | null
  sourceType: string | null
}

export function BulkVerifyForm({ entity, items, today, defaultDue }: { entity: string; items: BulkItem[]; today: string; defaultDue: string }) {
  const { state, pending, onSubmit } = useFormAction(bulkVerifyAction)
  const e = state?.fieldErrors ?? {}
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="entity" value={entity} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">Records awaiting review — open each source before ticking it</legend>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-3 py-2.5">
              <input id={`bv-${i.id}`} type="checkbox" name="ids" value={i.id} disabled={!i.sourceUrl} className="mt-1" />
              <label htmlFor={`bv-${i.id}`} className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="text-foreground">{i.label}</span>
                {i.sourceUrl ? (
                  <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-primary hover:underline">
                    {i.sourceTitle ?? i.sourceUrl} ({i.sourceType?.replace(/_/g, ' ')})<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span className="text-xs text-destructive">No source recorded — cannot be verified</span>
                )}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="grid gap-4 md:grid-cols-3">
        <Field id="bv-checked" label="Checked against the source on" required errors={e.checkedAt}>
          <input id="bv-checked" name="checkedAt" type="date" max={today} defaultValue={today} required className={controlClass} />
        </Field>
        <Field id="bv-due" label="Review due" required errors={e.reviewDueAt}>
          <input id="bv-due" name="reviewDueAt" type="date" min={today} defaultValue={defaultDue} required className={controlClass} />
        </Field>
        <Field id="bv-notes" label="Notes" errors={e.notes}>
          <input id="bv-notes" name="notes" maxLength={500} className={controlClass} />
        </Field>
      </div>
      <FormMessage state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Verifying…' : 'Verify selected records'}
        </Button>
      </div>
    </form>
  )
}

export function AcademicYearForm() {
  const { state, pending, onSubmit } = useFormAction(saveAcademicYearAction)
  const e = state?.fieldErrors ?? {}
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 md:grid-cols-3">
        <Field id="ay-code" label="Academic year" required errors={e.code} help="e.g. 2026-2027. Saving an existing year updates it.">
          <input id="ay-code" name="code" required pattern="\d{4}-\d{4}" placeholder="2026-2027" className={controlClass} />
        </Field>
        <Field id="ay-start" label="Starts on" required errors={e.startsOn}>
          <input id="ay-start" name="startsOn" type="date" required className={controlClass} />
        </Field>
        <Field id="ay-end" label="Ends on" required errors={e.endsOn}>
          <input id="ay-end" name="endsOn" type="date" required className={controlClass} />
        </Field>
        <Field id="ay-notes" label="Notes" errors={e.notes} className="md:col-span-2">
          <input id="ay-notes" name="notes" maxLength={500} className={controlClass} />
        </Field>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" name="isCurrent" />
          Current academic year
        </label>
      </div>
      <FormMessage state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save academic year'}
        </Button>
      </div>
    </form>
  )
}
