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
import { mailer } from '@/lib/mail'
import { readGeminiApiKey } from '@/lib/derek/config'
import { GEMINI_ENDPOINT, GEMINI_MODEL } from '@/lib/derek/providers/gemini'
import { mailConfigured } from '@/lib/identity/policy'
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
      seenUpToId: formText(form, 'seenUpToId'),
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
    await updateSupportSettings(getAdminPool(), actor, { autoReplyEnabled: formText(form, 'autoReplyEnabled') === '1' })
    return { message: 'Support settings saved.' }
  })
}

let lastTestEmailAt = 0

/** Owner-only SMTP check: one plain email to the owner's own sign-in address, at most once a minute. */
export async function sendTestEmailAction(): Promise<ActionState> {
  return run('support.settings', async (actor) => {
    if (!mailConfigured()) throw new SupportError(400, 'Outgoing mail is not configured (SMTP_HOST, SMTP_USER, SMTP_PASSWORD and MAIL_FROM).')
    if (Date.now() - lastTestEmailAt < 60_000) throw new SupportError(429, 'A test email was sent less than a minute ago.')
    lastTestEmailAt = Date.now()
    try {
      await mailer.send({
        to: actor.email,
        subject: 'LockIn Consulting test email',
        text: `This is a test of LockIn Consulting's outgoing email, sent from Admin settings at ${new Date().toISOString()}.
No action is needed.`,
      })
    } catch (error) {
      // Only nodemailer's code and SMTP status reach the log and the page: never the host, user or password.
      const e = error as { code?: unknown; responseCode?: unknown }
      const detail = [e.code, e.responseCode].filter((v) => typeof v === 'string' || typeof v === 'number').join(' ') || 'unknown'
      console.error(`[mail:test] failed: ${detail}`)
      throw new SupportError(503, `The mail server refused or could not be reached (${detail}).`)
    }
    console.info(`[mail:test] accepted by the SMTP server for owner ${actor.userId}`)
    return { message: `Accepted by the mail server for ${actor.email}. Check that inbox, including spam.` }
  })
}

let lastGeminiTestAt = 0

/**
 * Owner-only Gemini connectivity check: one fixed synthetic prompt (no student data) to the approved
 * model, at most once a minute. Reports only HTTP status, Google's error status and the model version.
 */
export async function testGeminiAction(): Promise<ActionState> {
  return run('support.settings', async () => {
    const key = readGeminiApiKey()
    if (!key) throw new SupportError(400, 'GEMINI_API_KEY is not set in this environment.')
    if (Date.now() - lastGeminiTestAt < 60_000) throw new SupportError(429, 'A Gemini test ran less than a minute ago.')
    lastGeminiTestAt = Date.now()
    const started = Date.now()
    let res: Response
    try {
      res = await fetch(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }], generationConfig: { maxOutputTokens: 16, temperature: 0 } }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new SupportError(503, `Gemini could not be reached (${error instanceof Error ? error.name : 'network error'}).`)
    }
    const body = (await res.json().catch(() => null)) as { modelVersion?: string; error?: { status?: string } } | null
    const ms = Date.now() - started
    console.info(`[derek:test] gemini ${res.status} ${body?.error?.status ?? ''} ${ms}ms`)
    if (!res.ok) throw new SupportError(503, `Gemini refused the request: HTTP ${res.status}${body?.error?.status ? ` ${body.error.status}` : ''}.`)
    return { message: `Gemini answered in ${ms} ms (model ${body?.modelVersion ?? GEMINI_MODEL}).` }
  })
}

export async function reviewRestrictionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('students.erase', async (actor) => {
    const id = formId(form, 'restrictionId')
    const decision = formText(form, 'decision')
    const note = formText(form, 'note').trim()
    if (id == null || (decision !== 'lift' && decision !== 'uphold')) throw new SupportError(400, 'Choose a decision.')
    if (note.length < 3) throw new SupportError(400, 'Write a short note for the record.', { note: ['Write a short note for the record.'] })
    const { reviewRestriction } = await import('@/lib/derek/abuse')
    await reviewRestriction(getAdminPool(), id, actor.email, decision, note).catch((e) => {
      throw new SupportError(409, e instanceof Error ? e.message : 'Could not record the review.')
    })
    revalidatePath('/admin/students')
    return { message: decision === 'lift' ? 'Restriction lifted. The student can use the chat again.' : 'Review recorded. The restriction stays.' }
  })
}

export async function resendRestrictionEmailAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('students.erase', async () => {
    const id = formId(form, 'restrictionId')
    if (id == null) throw new SupportError(400, 'Missing restriction.')
    const { sendRestrictionEmail } = await import('@/lib/derek/abuse')
    const result = await sendRestrictionEmail(getAdminPool(), id)
    if (result === 'failed') throw new SupportError(503, 'The email could not be sent. Check the mail settings and try again.')
    return { message: result === 'sent' ? 'Notice email sent.' : 'The notice email was already sent.' }
  })
}

let lastGroundingTestAt = 0

/**
 * Owner-only diagnostic: does Google Search grounding work on THIS API key's free tier, for the configured model and for the 2.5 Flash models
 * Google lists with free grounding? One fixed public question (no student data) per model, at most once a minute. Reports only HTTP status,
 * Google's error text, and whether grounded results and Search Suggestions came back. Nothing is stored, crawled or reused.
 */
export async function testGroundingAction(): Promise<ActionState> {
  return run('support.settings', async () => {
    const key = readGeminiApiKey()
    if (!key) throw new SupportError(400, 'GEMINI_API_KEY is not set in this environment.')
    if (Date.now() - lastGroundingTestAt < 60_000) throw new SupportError(429, 'A grounding test ran less than a minute ago.')
    lastGroundingTestAt = Date.now()
    const report: string[] = []
    for (const model of [GEMINI_MODEL, 'gemini-2.5-flash-lite', 'gemini-2.5-flash']) {
      try {
        const res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'What are the entry requirements for the Master of Data Science at the University of Waterloo?' }] }],
            tools: [{ google_search: {} }],
            generationConfig: { maxOutputTokens: 400, temperature: 0.2 },
          }),
          signal: AbortSignal.timeout(30_000),
        })
        const body = (await res.json().catch(() => null)) as {
          error?: { status?: string; message?: string }
          candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: unknown[]; webSearchQueries?: unknown[]; searchEntryPoint?: { renderedContent?: string } } }[]
        } | null
        if (!res.ok) {
          report.push(`${model}: HTTP ${res.status} ${body?.error?.status ?? ''} — ${(body?.error?.message ?? '').slice(0, 160)}`)
          continue
        }
        const c = body?.candidates?.[0]
        const g = c?.groundingMetadata
        const text = (c?.content?.parts ?? []).map((p) => p.text ?? '').join('')
        report.push(`${model}: HTTP 200; answer ${text.length} chars; grounded sources ${g?.groundingChunks?.length ?? 0}; searches ${g?.webSearchQueries?.length ?? 0}; Search Suggestions ${g?.searchEntryPoint?.renderedContent ? `${g.searchEntryPoint.renderedContent.length} chars` : 'none'}`)
      } catch (error) {
        report.push(`${model}: ${error instanceof Error ? error.name : 'error'}`)
      }
    }
    console.info(`[derek:test] grounding ${report.join(' | ')}`)
    return { message: report.join(' · ') }
  })
}

let lastResearchTestAt = 0

/**
 * Owner-only live check of Derek's internet research with a real university absent from LockIn's directory: finds its official site (ROR/Wikidata),
 * reads its pages (sitemap, links, web search when configured), extracts passages, has Gemini answer from them, and checks the failure path.
 * Sends only a public university name and topic to the search service. Reports counts and host names. At most once a minute.
 */
export async function testResearchAction(): Promise<ActionState> {
  return run('support.settings', async () => {
    const key = readGeminiApiKey()
    if (!key) throw new SupportError(400, 'GEMINI_API_KEY is not set in this environment.')
    if (Date.now() - lastResearchTestAt < 60_000) throw new SupportError(429, 'A research test ran less than a minute ago.')
    lastResearchTestAt = Date.now()
    const R = await import('@/lib/derek/research')
    const { GeminiProvider } = await import('@/lib/derek/providers/gemini')
    const { DEREK_INSTRUCTIONS } = await import('@/lib/derek/provider')
    const host = (u: string) => new URL(u).hostname.replace(/^www\./, '')
    const input = { topics: ['entry or language requirements'], course: 'Master of Data Science', universities: [], universityName: 'University of Waterloo', destinations: [{ iso2: 'CA', name: 'Canada' }] }
    const report: string[] = []
    const search = R.searchProviderFrom()
    report.push(`Search provider: ${search ? 'Tavily (free plan)' : 'none configured (TAVILY_API_KEY not set): official-site discovery only'}`)

    // 1-3. A university LockIn does not list: its official site is found, programme pages are read, requirement passages extracted.
    const seen: string[] = []
    const spy = search ? { search: async (q: string, sig: AbortSignal) => { const urls = await search.search(q, sig); seen.push(...urls); return urls } } : null
    const result = await R.researchQuestion({ ...input, search: spy })
    const where = (u: string) => `${new URL(u).hostname.replace(/^www\./, '')}${new URL(u).pathname.slice(0, 70)}`
    report.push(`Search returned ${seen.length}: ${seen.slice(0, 6).map(where).join(', ') || 'none'}`)
    report.push(`Read: ${result.record.sources.slice(0, 8).map((x) => where(x.url)).join(', ') || 'none'}`)
    const hosts = [...new Set(result.record.sources.map((x) => host(x.url)))]
    report.push(`Official site: ${result.record.official?.[0] ? host(result.record.official[0]) : 'not found'}`)
    report.push(`Pages read: ${result.record.sources.length} (${hosts.slice(0, 3).join(', ') || 'none'}); passages extracted: ${result.items.length}`)
    if (result.record.failure) report.push(`Research note: ${result.record.failure}`)

    // 4. Gemini writes a natural answer from those pages, with source links.
    if (result.items.length) {
      const provider = new GeminiProvider({ apiKey: key, dailyDraftLimit: 1 })
      try {
        const answer = await provider.generate(
          { question: 'What are the entry requirements for the Master of Data Science at University of Waterloo?', history: [], evidence: result.items.slice(0, 12), instructions: DEREK_INSTRUCTIONS, guidance: undefined } as never,
          { signal: AbortSignal.timeout(30_000) },
        )
        const links = [...answer.text.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].length
        report.push(`Gemini answer: ${answer.text.length} characters, ${links} source link(s). Start: “${answer.text.replace(/\s+/g, ' ').slice(0, 220)}”`)
      } catch (error) {
        report.push(`Gemini answer failed: ${(error as { code?: string }).code ?? 'error'}`)
      }
    }

    // 5. Search failure: the same question with a search service that fails still ends in an honest result, never invented pages.
    const broken = await R.researchQuestion({ ...input, universityName: 'Nowhere Example University', search: { search: async () => Promise.reject(new Error('down')) } })
    report.push(`With the search failing: ${broken.items.length} passage(s), note “${broken.record.failure ?? 'none'}”`)
    console.info(`[derek:test] research ${report.join(' | ')}`)
    return { message: report.join(' · ') }
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
