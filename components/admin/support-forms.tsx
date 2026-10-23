'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  approveAndSendAction,
  editDraftAction,
  eraseStudentAction,
  markConversationReadAction,
  markNotificationsReadAction,
  rejectDraftAction,
  replyAction,
  requestDraftAction,
  returnToDerekAction,
  revokeMemberAction,
  setStatusAction,
  setSupportAccessAction,
  syncReviewNoticesAction,
  takeOverAction,
  updateSupportSettingsAction,
} from '@/app/admin/support-actions'
import { controlClass, describedBy, Field, FormMessage } from './form-controls'
import { useFormAction } from './use-form-action'

const MESSAGE_MAX = 4000

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

/**
 * Human reply composer. The idempotency key is fixed per draft of the reply, so a double click or
 * a retried request is stored once; it changes only after the server confirms the save.
 */
export function ReplyForm({ conversationId, disabled }: { conversationId: number; disabled?: boolean }) {
  const { state, pending, onSubmit } = useFormAction(replyAction)
  const [requestId, setRequestId] = useState(newRequestId)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset()
      setRequestId(newRequestId())
    }
  }, [state])
  const errors = state?.fieldErrors?.body
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="clientRequestId" value={requestId} />
      <Field id="reply-body" label="Reply as yourself" help="Sent under your name with the label “LockIn team”. Plain text only." errors={errors}>
        <textarea
          id="reply-body"
          name="body"
          rows={4}
          required
          maxLength={MESSAGE_MAX}
          disabled={disabled}
          aria-invalid={errors?.length ? true : undefined}
          aria-describedby={describedBy('reply-body', 'x', errors)}
          className={controlClass}
        />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending || disabled} className="self-start">
        {pending ? 'Sending…' : 'Send reply'}
      </Button>
    </form>
  )
}

export function StatusForm({ conversationId, current, options }: { conversationId: number; current: string; options: { value: string; label: string }[] }) {
  const { state, pending, onSubmit } = useFormAction(setStatusAction)
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="status-select" label="Set status">
          <select id="status-select" name="status" defaultValue={options.find((o) => o.value !== current)?.value} className={controlClass}>
            {options
              .filter((o) => o.value !== current)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </select>
        </Field>
        <Field id="status-reason" label="Note (optional)" errors={state?.fieldErrors?.reason}>
          <input id="status-reason" name="reason" maxLength={500} className={controlClass} />
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        Update status
      </Button>
    </form>
  )
}

/** Take the conversation over from Derek, or (reviewers) hand it back explicitly. */
export function HandoverForm({ conversationId, takenOver }: { conversationId: number; takenOver: boolean }) {
  const { state, pending, onSubmit } = useFormAction(takenOver ? returnToDerekAction : takeOverAction)
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="conversationId" value={conversationId} />
      <FormMessage state={state} />
      <Button type="submit" variant="outline" size="sm" disabled={pending} className="self-start">
        {takenOver ? 'Return to Derek' : 'Take over from Derek'}
      </Button>
    </form>
  )
}

export function RequestDraftForm({ conversationId }: { conversationId: number }) {
  const { state, pending, onSubmit } = useFormAction(requestDraftAction)
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <FormMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        {pending ? 'Asking Derek…' : 'Ask Derek for a draft'}
      </Button>
    </form>
  )
}

/** Edit, approve-and-send or reject ONE revision. Every form posts the revision it was rendered with. */
export function DraftReviewForms({ draftId, revision, bodySha256, body }: { draftId: number; revision: number; bodySha256: string; body: string }) {
  const edit = useFormAction(editDraftAction)
  const send = useFormAction(approveAndSendAction)
  const reject = useFormAction(rejectDraftAction)
  const [text, setText] = useState(body)
  // The forms stay mounted across revisions (so confirmations survive); follow the saved text.
  useEffect(() => setText(body), [body])
  const dirty = text !== body
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={edit.onSubmit} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="draftId" value={draftId} />
        <input type="hidden" name="revision" value={revision} />
        <Field id={`draft-${draftId}-body`} label={`Draft text (revision ${revision})`} errors={edit.state?.fieldErrors?.body} help="Saving an edit creates a new revision that must be approved again.">
          <textarea
            id={`draft-${draftId}-body`}
            name="body"
            rows={6}
            maxLength={MESSAGE_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={controlClass}
          />
        </Field>
        <FormMessage state={edit.state} />
        <Button type="submit" variant="outline" disabled={edit.pending || !dirty} className="self-start">
          Save edit as new revision
        </Button>
      </form>

      <form onSubmit={send.onSubmit} className="flex flex-col gap-3">
        <input type="hidden" name="draftId" value={draftId} />
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="bodySha256" value={bodySha256} />
        <p className="text-sm leading-relaxed text-muted-foreground">
          {dirty ? 'Save your edit first: approval applies only to the saved text shown above when the page loaded.' : `Approves exactly revision ${revision} and sends it as “Derek · AI assistant, reviewed by you”.`}
        </p>
        <FormMessage state={send.state} />
        <Button type="submit" disabled={send.pending || dirty} className="self-start">
          {send.pending ? 'Sending…' : 'Approve and send'}
        </Button>
      </form>

      <form onSubmit={reject.onSubmit} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="draftId" value={draftId} />
        <input type="hidden" name="revision" value={revision} />
        <Field id={`draft-${draftId}-reason`} label="Reject with a reason" errors={reject.state?.fieldErrors?.reason}>
          <input id={`draft-${draftId}-reason`} name="reason" maxLength={500} className={controlClass} />
        </Field>
        <FormMessage state={reject.state} />
        <Button type="submit" variant="outline" disabled={reject.pending} className="self-start">
          Reject draft
        </Button>
      </form>
    </div>
  )
}

export function MarkReadForm({ ids, label = 'Mark as read' }: { ids: number[] | 'all'; label?: string }) {
  const { state, pending, onSubmit } = useFormAction(markNotificationsReadAction)
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input type="hidden" name="ids" value={ids === 'all' ? 'all' : ids.join(',')} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {label}
      </Button>
      {state && !state.ok ? <span className="text-xs text-destructive">{state.message}</span> : null}
    </form>
  )
}

export function SupportSettingsForm({ mode, autoReplyEnabled, autoReplyPermitted }: { mode: string; autoReplyEnabled: boolean; autoReplyPermitted: boolean }) {
  const { state, pending, onSubmit } = useFormAction(updateSupportSettingsAction)
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-foreground">Support mode</legend>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="radio" name="mode" value="online" defaultChecked={mode === 'online'} className="mt-1" />
          <span>Online — the team answers. Derek may only prepare drafts for review (when live AI is enabled).</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="radio" name="mode" value="offline" defaultChecked={mode === 'offline'} className="mt-1" />
          <span>Offline — questions wait for the team, unless automatic replies below are enabled and permitted.</span>
        </label>
      </fieldset>
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" name="autoReplyEnabled" value="1" defaultChecked={autoReplyEnabled} disabled={!autoReplyPermitted && !autoReplyEnabled} className="mt-1" />
        <span>
          Send Derek’s low-risk answers automatically while offline, without a person reviewing them.
          {autoReplyPermitted ? '' : ' Not available: see the blockers listed above.'}
        </span>
      </label>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        Save support settings
      </Button>
    </form>
  )
}

export function SupportAccessForm({ userId, enabled }: { userId: string; enabled: boolean }) {
  const { state, pending, onSubmit } = useFormAction(setSupportAccessAction)
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-1">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="enabled" value={enabled ? '0' : '1'} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {enabled ? 'Remove support access' : 'Allow support replies'}
      </Button>
      {state?.message ? <span className={state.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>{state.message}</span> : null}
    </form>
  )
}

export function RevokeMemberForm({ userId, name }: { userId: string; name: string }) {
  const { state, pending, onSubmit } = useFormAction(revokeMemberAction)
  const [armed, setArmed] = useState(false)
  const id = `revoke-${userId}`
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="userId" value={userId} />
      {armed ? <input type="hidden" name="confirm" value="yes" /> : null}
      <Field id={id} label={`Reason for revoking ${name}`} errors={state?.fieldErrors?.reason}>
        <input id={id} name="reason" maxLength={500} className={controlClass} />
      </Field>
      <FormMessage state={state} />
      {armed ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirm revoking ${name}`}>
          <span className="text-xs text-destructive">{`Revoke ${name}? They are signed out at once; only the CLI can grant access again.`}</span>
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            {pending ? 'Revoking…' : 'Confirm revoke'}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setArmed(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setArmed(true)}>
          Revoke access
        </Button>
      )}
    </form>
  )
}

export function EraseStudentForm({ profileId }: { profileId: number }) {
  const { state, pending, onSubmit } = useFormAction(eraseStudentAction)
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="profileId" value={profileId} />
      <Field id="erase-reason" label="Reason (stored in the change log)" required errors={state?.fieldErrors?.reason}>
        <input id="erase-reason" name="reason" maxLength={500} className={controlClass} />
      </Field>
      <Field id="erase-confirm" label="Type ERASE to confirm" required errors={state?.fieldErrors?.confirm}>
        <input id="erase-confirm" name="confirm" autoComplete="off" className={controlClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="destructive" disabled={pending} className="self-start">
        Erase student and all conversations
      </Button>
    </form>
  )
}

/** Marks a conversation read once it is really shown, not when its page is rendered or prefetched. */
export function MarkConversationRead({ conversationId }: { conversationId: number }) {
  useEffect(() => {
    const form = new FormData()
    form.set('conversationId', String(conversationId))
    void markConversationReadAction(null, form)
  }, [conversationId])
  return null
}

/** Creates overdue-review notices (idempotent) from a reviewer's browser, not during a GET render. */
export function SyncReviewNotices() {
  useEffect(() => {
    void syncReviewNoticesAction(null, new FormData())
  }, [])
  return null
}
