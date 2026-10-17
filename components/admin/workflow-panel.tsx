'use client'

import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { transitionAction, type ActionState } from '@/app/admin/actions'
import type { FieldOption } from '@/lib/admin/entities'
import type { WorkflowAction } from '@/lib/admin/workflow'
import { controlClass, describedBy, Field, FormMessage } from './form-controls'

// One action state for the whole panel: a successful transition usually removes the form that
// triggered it, so the confirmation has to live above the individual forms.
interface Shared {
  entity: string
  id: number
  pending: boolean
  errorFor: (action: WorkflowAction) => ActionState
  submit: (action: WorkflowAction, event: FormEvent<HTMLFormElement>) => void
}

function ActionForm({ shared, action, children, noValidate }: { shared: Shared; action: WorkflowAction; children: ReactNode; noValidate?: boolean }) {
  return (
    <form onSubmit={(e) => shared.submit(action, e)} className="flex flex-col gap-3" noValidate={noValidate}>
      <input type="hidden" name="entity" value={shared.entity} />
      <input type="hidden" name="id" value={shared.id} />
      <input type="hidden" name="action" value={action} />
      {children}
      <FormMessage state={shared.errorFor(action)} />
    </form>
  )
}

function SimpleAction({ shared, action, label, description, disabled }: { shared: Shared; action: WorkflowAction; label: string; description: string; disabled?: boolean }) {
  return (
    <ActionForm shared={shared} action={action}>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      <Button type="submit" disabled={shared.pending || disabled} className="self-start">
        {label}
      </Button>
    </ActionForm>
  )
}

function ReasonAction({ shared, action, label, description }: { shared: Shared; action: WorkflowAction; label: string; description: string }) {
  const fid = `reason-${action}`
  const errors = shared.errorFor(action)?.fieldErrors?.reason
  return (
    <ActionForm shared={shared} action={action}>
      <Field id={fid} label="Reason" required help={description} errors={errors}>
        <textarea
          id={fid}
          name="reason"
          rows={2}
          required
          minLength={5}
          maxLength={500}
          aria-invalid={errors?.length ? true : undefined}
          aria-describedby={describedBy(fid, description, errors)}
          className={controlClass}
        />
      </Field>
      <Button type="submit" variant="outline" disabled={shared.pending} className="self-start">
        {label}
      </Button>
    </ActionForm>
  )
}

function VerifyAction({ shared, allowUnavailable, sources, defaultSourceId, today, defaultReviewDue, reverify }: {
  shared: Shared
  allowUnavailable: boolean
  sources: FieldOption[]
  defaultSourceId: string
  today: string
  defaultReviewDue: string
  reverify: boolean
}) {
  const e = shared.errorFor('verify')?.fieldErrors ?? {}
  return (
    <ActionForm shared={shared} action="verify" noValidate>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {reverify
          ? 'Re-check the source and record a new review date. The record stays live.'
          : 'Confirm every value against the source. Your name and the date are recorded.'}
      </p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Field id="v-status" label="Outcome" required errors={e.verificationStatus}>
          <select id="v-status" name="verificationStatus" defaultValue="verified" className={controlClass}>
            <option value="verified">Values match the source</option>
            {allowUnavailable ? <option value="unavailable">Source confirms it is not published</option> : null}
          </select>
        </Field>
        <Field id="v-source" label="Source checked" required errors={e.sourceId}>
          <select id="v-source" name="sourceId" defaultValue={defaultSourceId} className={controlClass} aria-invalid={e.sourceId?.length ? true : undefined}>
            <option value="">Choose…</option>
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="v-checked" label="Checked on" required errors={e.checkedAt}>
          <input id="v-checked" name="checkedAt" type="date" max={today} defaultValue={today} className={controlClass} />
        </Field>
        <Field id="v-due" label="Review again by" required errors={e.reviewDueAt}>
          <input id="v-due" name="reviewDueAt" type="date" min={today} defaultValue={defaultReviewDue} className={controlClass} />
        </Field>
        <Field id="v-notes" label="Notes" className="md:col-span-2 lg:col-span-1 xl:col-span-2" errors={e.notes}>
          <textarea id="v-notes" name="notes" rows={2} maxLength={5000} className={controlClass} />
        </Field>
      </div>
      <Button type="submit" disabled={shared.pending} className="self-start">
        {reverify ? 'Record re-verification' : 'Record verification'}
      </Button>
    </ActionForm>
  )
}

export function WorkflowPanel({
  entity,
  id,
  status,
  version,
  actions,
  blockers,
  allowUnavailable,
  sources,
  defaultSourceId,
  today,
  defaultReviewDue,
}: {
  entity: string
  id: number
  status: string
  /** Changes whenever the record changes; resets the forms after a successful transition. */
  version: string
  actions: WorkflowAction[]
  blockers: string[]
  allowUnavailable: boolean
  sources: FieldOption[]
  defaultSourceId: string
  today: string
  defaultReviewDue: string
}) {
  const [state, dispatch, pending] = useActionState(transitionAction, null)
  const [last, setLast] = useState<WorkflowAction | null>(null)

  const shared: Shared = {
    entity,
    id,
    pending,
    errorFor: (action) => (state && !state.ok && last === action ? state : null),
    submit: (action, event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      setLast(action)
      startTransition(() => dispatch(data))
    },
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-live="polite">
        {pending ? <p className="text-sm text-muted-foreground">Working…</p> : null}
        {!pending && state?.ok && state.message ? (
          <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm leading-relaxed text-foreground">{state.message}</p>
        ) : null}
      </div>
      {actions.length ? (
        <div key={version} className="flex flex-col divide-y divide-border">
          {actions.includes('submit_for_review') ? (
            <div className="pb-5 last:pb-0">
              <SimpleAction
                shared={shared}
                action="submit_for_review"
                label="Submit for review"
                description="Hand this record to a reviewer. You can still edit it, which returns it to draft."
              />
            </div>
          ) : null}
          {actions.includes('verify') ? (
            <div className="py-5 first:pt-0">
              <VerifyAction
                shared={shared}
                allowUnavailable={allowUnavailable}
                sources={sources}
                defaultSourceId={defaultSourceId}
                today={today}
                defaultReviewDue={defaultReviewDue}
                reverify={status === 'published'}
              />
            </div>
          ) : null}
          {actions.includes('publish') ? (
            <div className="py-5">
              <SimpleAction
                shared={shared}
                action="publish"
                label="Publish"
                disabled={blockers.length > 0}
                description={blockers.length ? 'Resolve the blockers listed above before publishing.' : 'All checks pass. Publishing makes this record visible to students.'}
              />
            </div>
          ) : null}
          {actions.includes('return_to_draft') ? (
            <div className="py-5 last:pb-0">
              <ReasonAction shared={shared} action="return_to_draft" label="Return to draft" description="Tell the editor what needs fixing. Stored in the change log." />
            </div>
          ) : null}
          {actions.includes('unpublish') ? (
            <div className="pt-5">
              <ReasonAction shared={shared} action="unpublish" label="Unpublish" description="Removes it from the public site immediately. Stored on the record and in the change log." />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {status === 'in_review' || status === 'published'
            ? 'A reviewer or owner takes the next step on this record.'
            : 'No workflow actions are available to your role for this record.'}
        </p>
      )}
    </div>
  )
}
