'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { AccessDeniedError, requireAdminAction } from '@/lib/admin/access'
import { isEntityKey } from '@/lib/admin/entities'
import { formId, formText, type FieldErrors } from '@/lib/admin/forms'
import type { AdminActor, Permission } from '@/lib/admin/roles'
import {
  ACTION_PERMISSION,
  createFxRate,
  createRecord,
  createSource,
  PermissionError,
  setProvisionalListing,
  transitionRecord,
  updateFxProviderTerms,
  updateRankingRights,
  updateRecord,
  WorkflowError,
  type WorkflowAction,
} from '@/lib/admin/workflow'
import { bulkVerify, importRecords, IMPORT_MAX_BYTES, resolveConflict, saveAcademicYear, scanDuplicates } from '@/lib/admin/data-tools'
import { getAdminPool } from '@/lib/db/pool'

// Every action re-authorises on the server (session + active membership + role) before reading
// any input. Next.js additionally rejects server-action POSTs whose Origin doesn't match the host.

export type ActionState = {
  ok: boolean
  message?: string
  fieldErrors?: FieldErrors
  blockers?: string[]
} | null

// blockers on a success: per-item notes for a partly applied bulk action (the applied part is saved).
type Outcome = { redirectTo?: string; message?: string; revalidatePublic?: boolean; blockers?: string[] }

async function run(permission: Permission, work: (actor: AdminActor) => Promise<Outcome>): Promise<ActionState> {
  let outcome: Outcome
  try {
    const actor = await requireAdminAction(permission)
    outcome = await work(actor)
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof PermissionError) return { ok: false, message: error.message }
    if (error instanceof WorkflowError)
      return { ok: false, message: error.message, fieldErrors: error.fieldErrors, blockers: error.blockers }
    console.error('[admin] action failed', error)
    return { ok: false, message: 'Something went wrong. Nothing was saved.' }
  }
  revalidatePath('/admin', 'layout')
  if (outcome.revalidatePublic) revalidatePath('/destinations/[slug]', 'page')
  if (outcome.redirectTo) redirect(outcome.redirectTo)
  return { ok: true, message: outcome.message ?? 'Saved.', ...(outcome.blockers?.length ? { blockers: outcome.blockers } : {}) }
}

function entityFrom(form: FormData) {
  const entity = formText(form, 'entity')
  if (!isEntityKey(entity)) throw new WorkflowError('Unknown record type.')
  return entity
}

function idFrom(form: FormData, name = 'id') {
  const id = formId(form, name)
  if (id == null) throw new WorkflowError('Missing record id.')
  return id
}

export async function createRecordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('data.capture', async (actor) => {
    const entity = entityFrom(form)
    const id = await createRecord(getAdminPool(), actor, entity, form, formId(form, 'parentId'))
    return { redirectTo: `/admin/records/${entity}/${id}` }
  })
}

export async function updateRecordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('data.capture', async (actor) => {
    const entity = entityFrom(form)
    const id = idFrom(form)
    await updateRecord(getAdminPool(), actor, entity, id, form)
    return { redirectTo: `/admin/records/${entity}/${id}` }
  })
}

const WORKFLOW_ACTIONS = Object.keys(ACTION_PERMISSION) as WorkflowAction[]

export async function transitionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const action = formText(form, 'action') as WorkflowAction
  const permission = WORKFLOW_ACTIONS.includes(action) ? ACTION_PERMISSION[action] : 'data.review'
  return run(permission, async (actor) => {
    if (!WORKFLOW_ACTIONS.includes(action)) throw new WorkflowError('Unknown action.')
    await transitionRecord(getAdminPool(), actor, entityFrom(form), idFrom(form), action, form)
    const labels: Record<WorkflowAction, string> = {
      submit_for_review: 'Submitted for review.',
      return_to_draft: 'Returned to draft.',
      verify: 'Verification recorded.',
      publish: 'Published. It is now live wherever its parent records are live.',
      unpublish: 'Unpublished. It no longer appears on the public site.',
    }
    return { message: labels[action], revalidatePublic: action === 'publish' || action === 'unpublish' || action === 'verify' }
  })
}

export async function provisionalListingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('data.review', async (actor) => {
    const show = formText(form, 'show') === '1'
    await setProvisionalListing(getAdminPool(), actor, idFrom(form), show, form)
    return { message: show ? 'Listed publicly while under review (name, website and confirmed city only; no verification badge).' : 'Removed from the public list.', revalidatePublic: true }
  })
}

export async function createSourceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('data.capture', async (actor) => {
    const id = await createSource(getAdminPool(), actor, form)
    const returnTo = formText(form, 'returnTo')
    // Only same-site admin paths are allowed as a return target (no open redirect).
    return { redirectTo: /^\/admin\/[a-z0-9_/\-?=&]*$/i.test(returnTo) ? returnTo : `/admin/sources/${id}` }
  })
}

export async function updateRankingRightsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('rights.manage', async (actor) => {
    await updateRankingRights(getAdminPool(), actor, idFrom(form), form)
    return { message: 'Ranking rights updated.', revalidatePublic: true }
  })
}

export async function updateFxTermsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('rights.manage', async (actor) => {
    await updateFxProviderTerms(getAdminPool(), actor, idFrom(form), form)
    return { message: 'Exchange-rate provider terms updated.', revalidatePublic: true }
  })
}

export async function createFxRateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('data.review', async (actor) => {
    await createFxRate(getAdminPool(), actor, form)
    return { message: 'Exchange rate recorded.', revalidatePublic: true }
  })
}

// ---- Data tools (lib/admin/data-tools.ts) ----

export async function importRecordsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('data.capture', async (actor) => {
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new WorkflowError('Choose a JSON file to import.')
    if (file.size > IMPORT_MAX_BYTES) throw new WorkflowError('The file is larger than 900 KB. Split it into smaller files.')
    const s = await importRecords(getAdminPool(), actor, file.name, await file.text())
    const parts = [
      `${s.universitiesCreated} universities, ${s.coursesCreated} courses, ${s.intakesCreated} intakes and ${s.feesCreated} fees${s.rankingsCreated ? ` and ${s.rankingsCreated} ranks` : ''} created as drafts`,
      `${s.matchedExisting} matched existing records`,
      `${s.conflicts} conflicts to review`,
    ]
    return { message: `Batch #${s.batchId}: ${parts.join('; ')}.${s.notes.length ? ` ${s.notes.length} note(s): ${s.notes.slice(0, 3).join(' ')}` : ''}` }
  })
}

export async function scanDuplicatesAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  return run('data.capture', async (actor) => {
    const added = await scanDuplicates(getAdminPool(), actor)
    return { message: added ? `${added} possible duplicate pair(s) added to the conflict queue.` : 'No new possible duplicates found.' }
  })
}

export async function resolveConflictAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('data.review', async (actor) => {
    await resolveConflict(getAdminPool(), actor, idFrom(form), form)
    return { message: 'Conflict resolved.' }
  })
}

export async function bulkVerifyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('data.bulk_verify', async (actor) => {
    const ids = form.getAll('ids').map((v) => (typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : 0)).filter((n) => n > 0)
    const results = await bulkVerify(getAdminPool(), actor, entityFrom(form), ids, form)
    const refused = results.filter((r) => !r.ok)
    return {
      message: `${results.length - refused.length} verified, ${refused.length} refused. Publishing is a separate step.`,
      blockers: refused.map((r) => `#${r.id}: ${r.message}`),
    }
  })
}

export async function saveAcademicYearAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('data.years', async (actor) => {
    await saveAcademicYear(getAdminPool(), actor, form)
    return { message: 'Academic year saved.' }
  })
}
