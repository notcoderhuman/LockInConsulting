'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { AccessDeniedError, requireAdminAction } from '@/lib/admin/access'
import { formId, formText } from '@/lib/admin/forms'
import { getReviewQueue } from '@/lib/admin/queries'
import type { AdminActor, Permission } from '@/lib/admin/roles'
import { recordHref } from '@/lib/admin/view'
import { revokeMember, setSupportAccess } from '@/lib/admin/team'
import { getAdminPool } from '@/lib/db/pool'
import { approveAndSendDraft, editDraft, rejectDraft, requestDraftForConversation } from '@/lib/derek/drafts'
import { eraseStudent, markStaffRead, returnToDerek, setConversationStatus, staffReply, takeOverConversation } from '@/lib/support/conversations'
import { SupportError } from '@/lib/support/db'
import { markNotificationsRead, staffViewer, syncOverdueReviewNotifications } from '@/lib/support/notifications'
import { updateSupportSettings } from '@/lib/support/settings'
import type { ActionState } from './actions'

// Live Inbox, Derek review, notifications, team and student actions. Like app/admin/actions.ts,
// each one re-authorises (session + active membership + role/delegation) BEFORE reading input,
// and the lib function it calls checks the permission again. Next.js rejects server-action POSTs
// whose Origin does not match the host.

type Outcome = { message?: string; redirectTo?: string }

async function run(permission: Permission, work: (actor: AdminActor) => Promise<Outcome | void>): Promise<ActionState> {
  let outcome: Outcome | void
  try {
    const actor = await requireAdminAction(permission)
    outcome = await work(actor)
  } catch (error) {
    if (error instanceof AccessDeniedError) return { ok: false, message: error.message }
    if (error instanceof SupportError) return { ok: false, message: error.message, fieldErrors: error.fieldErrors }
    console.error('[admin] support action failed', error instanceof Error ? error.name : 'unknown error')
    return { ok: false, message: 'Something went wrong. Nothing was saved.' }
  }
  revalidatePath('/admin', 'layout')
  if (outcome?.redirectTo) redirect(outcome.redirectTo)
  return { ok: true, message: outcome?.message ?? 'Saved.' }
}

function conversationId(form: FormData) {
  const id = formId(form, 'conversationId')
  if (id == null) throw new SupportError(400, 'Missing conversation.')
  return id
}

function draftId(form: FormData) {
  const id = formId(form, 'draftId')
  if (id == null) throw new SupportError(400, 'Missing draft.')
  return id
}

export async function replyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.reply', async (actor) => {
    const { duplicate } = await staffReply(getAdminPool(), actor, conversationId(form), {
      body: form.get('body'),
      clientRequestId: formText(form, 'clientRequestId'),
    })
    return { message: duplicate ? 'This reply was already sent.' : 'Reply sent and saved.' }
  })
}

export async function takeOverAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.reply', async (actor) => {
    await takeOverConversation(getAdminPool(), actor, conversationId(form))
    return { message: 'You have taken over. Derek will not draft or send anything here until it is returned.' }
  })
}

export async function returnToDerekAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.review_ai', async (actor) => {
    await returnToDerek(getAdminPool(), actor, conversationId(form))
    return { message: 'Returned to Derek.' }
  })
}

export async function setStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.reply', async (actor) => {
    await setConversationStatus(getAdminPool(), actor, conversationId(form), formText(form, 'status'), formText(form, 'reason'))
    return { message: 'Status updated.' }
  })
}

export async function requestDraftAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.review_ai', async (actor) => {
    const outcome = await requestDraftForConversation(getAdminPool(), actor, conversationId(form))
    if (outcome.state === 'failed') return { message: `Derek could not draft a reply (${outcome.code}). Please answer this one yourself.` }
    return { message: 'Derek prepared a draft. Review it below before sending.' }
  })
}

export async function editDraftAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.review_ai', async (actor) => {
    const revision = await editDraft(getAdminPool(), actor, draftId(form), { body: form.get('body'), revision: formText(form, 'revision') })
    return { message: `Saved as revision ${revision}. Any earlier approval no longer applies.` }
  })
}

export async function approveAndSendAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.review_ai', async (actor) => {
    await approveAndSendDraft(getAdminPool(), actor, draftId(form), { revision: formText(form, 'revision'), bodySha256: formText(form, 'bodySha256') })
    return { message: 'Approved and sent. It is labelled as Derek’s reply, reviewed by you.' }
  })
}

export async function rejectDraftAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.review_ai', async (actor) => {
    await rejectDraft(getAdminPool(), actor, draftId(form), { revision: formText(form, 'revision'), reason: formText(form, 'reason') })
    return { message: 'Draft rejected. The question is back in the queue for a human reply.' }
  })
}

export async function markNotificationsReadAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('data.read', async (actor) => {
    const raw = formText(form, 'ids')
    const ids = raw === 'all' ? 'all' : raw.split(',').map(Number).filter(Number.isSafeInteger)
    await markNotificationsRead(getAdminPool(), staffViewer(actor), ids)
    return { message: 'Marked as read.' }
  })
}

export async function updateSupportSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.settings', async (actor) => {
    await updateSupportSettings(getAdminPool(), actor, { mode: formText(form, 'mode'), autoReplyEnabled: formText(form, 'autoReplyEnabled') === '1' })
    return { message: 'Support settings saved.' }
  })
}

export async function setSupportAccessAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('members.manage', async (actor) => {
    const enabled = formText(form, 'enabled') === '1'
    await setSupportAccess(getAdminPool(), actor, formText(form, 'userId'), enabled)
    return { message: enabled ? 'Support access granted.' : 'Support access removed.' }
  })
}

export async function revokeMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('members.manage', async (actor) => {
    if (formText(form, 'confirm') !== 'yes') throw new SupportError(400, 'Confirm that you want to revoke this member.')
    await revokeMember(getAdminPool(), actor, formText(form, 'userId'), formText(form, 'reason'))
    // The form disappears once the member is revoked, so the confirmation is shown by the page.
    return { redirectTo: '/admin/team?notice=revoked' }
  })
}

export async function eraseStudentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('students.erase', async (actor) => {
    const id = formId(form, 'profileId')
    if (id == null) throw new SupportError(400, 'Missing student.')
    if (formText(form, 'confirm') !== 'ERASE') throw new SupportError(400, 'Type ERASE to confirm.', { confirm: ['Type ERASE to confirm.'] })
    await eraseStudent(getAdminPool(), actor, id, formText(form, 'reason'))
    return { redirectTo: `/admin/students/${id}` }
  })
}

// Called by the browser after a page has mounted, never during a GET render or a prefetch.
export async function markConversationReadAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.read', async (actor) => {
    await markStaffRead(getAdminPool(), actor, conversationId(form))
    return { message: 'Marked as read.' }
  })
}

export async function syncReviewNoticesAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  return run('data.review', async () => {
    const db = getAdminPool()
    const overdue = (await getReviewQueue(db)).filter((q) => q.reason === 'expired')
    await syncOverdueReviewNotifications(db, overdue.map((q) => ({ entity: q.entity, id: q.id, title: q.title, reviewDueAt: q.reviewDueAt, validTo: q.validTo, href: recordHref(q.entity, q.id) })))
    return { message: 'Review notices up to date.' }
  })
}
