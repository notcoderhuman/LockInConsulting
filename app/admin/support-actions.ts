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
export async function testResearchAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run('support.settings', async () => {
    const key = readGeminiApiKey()
    if (!key) throw new SupportError(400, 'GEMINI_API_KEY is not set in this environment.')
    if (Date.now() - lastResearchTestAt < 45_000) throw new SupportError(429, 'A research test ran less than 45 seconds ago.')
    const { EVAL_QUESTIONS } = await import('@/lib/derek/eval-questions')
    const chosen = EVAL_QUESTIONS.find((q) => q.id === formText(form, 'preset')) ?? EVAL_QUESTIONS[0]
    lastResearchTestAt = Date.now()
    const R = await import('@/lib/derek/research')
    const { GeminiProvider } = await import('@/lib/derek/providers/gemini')
    const { DEREK_INSTRUCTIONS } = await import('@/lib/derek/provider')
    const { analyseQuestion, detectDestinations } = await import('@/lib/derek/guidance')
    const { institutionNames } = await import('@/lib/derek/discovery')
    const { askedQualification, askedLevel } = await import('@/lib/derek/qualification')
    const { researchNote, researchFlags } = await import('@/lib/derek/drafts')
    const { completeAnswer, impossibleScores } = await import('@/lib/derek/completeness')
    const { studentFacingText, tidyDraft } = await import('@/lib/derek/style')
    const host = (u: string) => new URL(u).hostname.replace(/^www\./, '')
    const question = chosen.question
    // The same inputs the student pipeline derives from the question itself (no directory records, no student data).
    const guidance0 = analyseQuestion(question, [])
    const institutions = institutionNames(question)
    const course = askedQualification(question)
    const input = {
      // As in the student pipeline: a comparison of two universities with no topic named compares requirements and fees.
      topics: guidance0.topics.length || institutions.length < 2 ? guidance0.topics : ['entry or language requirements', 'fees or costs'],
      course,
      universities: [],
      universityName: institutions[0] ?? null,
      destinations: detectDestinations(question).map((d) => ({ iso2: d.iso2, name: d.name })),
      level: askedLevel(question),
    }
    const out: string[] = []
    const search = R.searchProviderFrom()
    out.push(`QUESTION (${chosen.id}): ${question}`)
    out.push(`DERIVED: level ${input.level ?? 'not stated'}; universities ${institutions.join(' + ') || 'none'}; kind ${guidance0.kind}; topics ${input.topics.join(', ') || 'none'}; course ${input.course ?? 'none'}; university ${input.universityName ?? 'none'}; destinations ${input.destinations.map((d) => d.iso2).join(', ') || 'none'}\nPRODUCTION WOULD RESEARCH: ${guidance0.kind === 'specific_fact' || institutions.length > 0 ? 'yes' : 'no (general question: answered without research)'}`)
    out.push(`SEARCH PROVIDER: ${search ? 'Tavily (free plan)' : 'none configured (TAVILY_API_KEY not set)'}`)

    const seen: string[] = []
    const calls: string[] = []
    const spy = search
      ? {
          search: async (q: string, sig: AbortSignal, options?: { domains?: string[] }) => {
            const urls = await search.search(q, sig, options)
            seen.push(...urls)
            calls.push(`${options?.domains ? `[only ${options.domains.join(', ')}] ` : ''}${q.slice(0, 90)} -> ${urls.length}: ${[...new Set(urls.map((u) => new URL(u).hostname.replace(/^www\./, '')))].join(', ')}`)
            return urls
          },
        }
      : null
    const result = await R.researchAll((i) => R.researchQuestion({ ...i, search: spy }), input, institutions)
    out.push(`OFFICIAL SITE: ${result.record.official?.[0] ? host(result.record.official[0]) : 'not found'}`)
    out.push(`SEARCH CALLS (${calls.length}, ${seen.length} URLs):\n${calls.map((c) => `  ${c}`).join('\n') || '  none'}`)
    const bySource = new Map<string, typeof result.items>()
    for (const i of result.items) bySource.set(i.sourceUrl, [...(bySource.get(i.sourceUrl) ?? []), i])
    const passageText = (t: string) => t.replace(/^UNVERIFIED[^:]*: from the web page "[^"]*"(?: \([^)]*\))?: /, '').replace(/^UNVERIFIED[^:]*: /, '')
    out.push(`PAGES READ (${result.record.sources.length}) and passages taken (${result.items.length}):`)
    for (const s of result.record.sources) {
      const items = bySource.get(s.url) ?? []
      out.push(`  ${s.url}${s.published ? ` (page dated ${s.published})` : ''}\n${items.map((i, n) => `    [${n + 1}] ${passageText(i.text).slice(0, 230)}`).join('\n') || '    (no readable figure on this page)'}`)
    }
    if (result.record.failure) out.push(`RESEARCH NOTE: ${result.record.failure}`)
    out.push(`SOURCE CONFLICTS: ${result.record.conflicts.join('; ') || 'none'}\nIMPLAUSIBLE FIGURES: ${(result.record.sourceProblems ?? []).join('; ') || 'none'}\nOUTDATED: ${result.record.outdated.join('; ') || 'none'}\nWHAT THE TEAM WOULD BE TOLD: ${researchFlags(result).join(' | ') || 'nothing (no flag)'}`)

    // The answer, built the way the student pipeline builds it, then cleaned and completed.
    const provider = new GeminiProvider({ apiKey: key, dailyDraftLimit: 1 })
    const officialPages = (result.record.official ?? []).slice(0, 2).map((url, i) => ({ ref: `university:official:${i}`, text: `The university's official page: ${url}`, sourceUrl: url, publisher: 'University website', checkedAt: new Date().toISOString().slice(0, 10), unverified: true as const }))
    const evidence = R.capEvidence([...result.items, ...officialPages], 30)
    const analysed = analyseQuestion(question, evidence)
    try {
      const answer = await provider.generate({ question, history: [], evidence, instructions: DEREK_INSTRUCTIONS, guidance: { ...analysed, note: `${analysed.note} ${researchNote(result, institutions.length >= 2)}` } }, { signal: AbortSignal.timeout(40_000) })
      const cleaned = studentFacingText(tidyDraft(answer.text))
      const text = completeAnswer(cleaned, evidence, result.record.sources)
      const added = text.length - cleaned.length
      out.push(`GEMINI ANSWER AS THE STUDENT READS IT (${text.length} characters${answer.uncertain ? '; Derek marked it uncertain' : ''}${answer.incomplete ? '; CUT OFF' : ''}${added > 0 ? `; ${added} characters were added from the evidence to complete it` : ''}):\n${text}`)
      const links = [...text.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1])
      const bare = /(?<!\]\()https?:\/\//.test(text)
      const internal = /UNVERIFIED|not yet checked|From the LockIn directory|\[(?:web|university|course):|\(source:|evidence:/i.test(text)
      const foreign = links.filter((l) => !new Set(evidence.map((e) => e.sourceUrl)).has(l))
      out.push(`CHECKS: ${links.length} clickable link(s) (${[...new Set(links.map(host))].join(', ') || 'none'}); links not from the evidence ${foreign.length ? `PRESENT (${foreign.join(', ')})` : 'none'}; bare addresses ${bare ? 'PRESENT' : 'none'}; internal wording ${internal ? 'PRESENT' : 'none'}; impossible figure repeated: ${impossibleScores(evidence).some((s) => new RegExp(`${s.test}[^.\\n]{0,40}\\b${s.value}\\b`, 'i').test(text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')) && !/error|typo|mistake|unusual/i.test(text)) ? 'YES' : 'no'}`)

      // Which passage supports each sentence that states a fact, and which facts the pages publish that the answer leaves out.
      const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]{4,}|\d+(?:\.\d+)?/g) ?? []).filter((w) => !['that', 'with', 'this', 'from', 'have', 'will', 'their', 'which', 'also'].includes(w)))
      const nums = (s: string) => new Set(s.match(/\d+(?:\.\d+)?/g) ?? [])
      const plain = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      const claims = plain.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 25 && (/\d/.test(s) || /\b(?:degree|bachelor|honours|average|minimum|ielts|toefl|pte|duolingo|gpa|grade|transcript|reference|statement|resume|interview|prerequisite|course|scholarship|deadline|fee|tuition|permit|visa|apply|application|document)\b/i.test(s)))
      out.push('CLAIM SUPPORT:')
      for (const c of claims.slice(0, 16)) {
        const cw = words(c)
        const cn = nums(c)
        let best: { score: number; item: (typeof result.items)[number] } | null = null
        for (const i of result.items) {
          const pw = words(passageText(i.text))
          const pn = nums(passageText(i.text))
          const score = [...cn].filter((n) => pn.has(n)).length * 3 + [...cw].filter((w) => pw.has(w)).length
          if (!best || score > best.score) best = { score, item: i }
        }
        out.push(`  • ${c.slice(0, 190)}\n    ${best && best.score >= 4 ? `← ${best.item.sourceUrl}\n      “${passageText(best.item.text).slice(0, 200)}”` : '← no single passage matches (general wording)'}`)
      }
      const answerNums = nums(plain)
      const missed = new Map<string, string>()
      for (const i of result.items) {
        for (const m of passageText(i.text).matchAll(/[^.\n]{0,80}(?:\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?%|(?:[$€£]|CAD|USD|EUR|GBP|AUD)\s?\d[\d,]*|\bIELTS\b[^.\n]{0,30}\d|\bTOEFL\b[^.\n]{0,30}\d|\bminimum\b[^.\n]{0,60}\d|\b\d\.\d{1,2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}\b)[^.\n]{0,60}/gi)) {
          const n = [...nums(m[0])]
          if (n.length && !n.some((x) => answerNums.has(x)) && missed.size < 10) missed.set(m[0].trim(), i.sourceUrl)
        }
      }
      out.push(`FACTS ON THE PAGES NOT IN THE ANSWER: ${missed.size ? '' : 'none found'}${[...missed].map(([m, u]) => `\n  • “${m.slice(0, 170)}” (${host(u)})`).join('')}`)
    } catch (error) {
      out.push(`GEMINI ANSWER FAILED: ${(error as { code?: string }).code ?? 'error'}`)
    }

    console.info(`[derek:test] research ${chosen.id}: ${result.record.sources.length} pages, ${result.items.length} passages`)
    return { message: out.join('\n\n') }
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
