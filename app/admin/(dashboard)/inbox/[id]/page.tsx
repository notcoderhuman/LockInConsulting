import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConversationBadge, RiskBadge } from '@/components/admin/conversation-badge'
import { EmptyState, PageHeader, Panel } from '@/components/admin/page-header'
import { DraftReviewForms, ReplyForm, RequestDraftForm, StatusForm } from '@/components/admin/support-forms'
import { requireAdminPage } from '@/lib/admin/access'
import { actorCan } from '@/lib/admin/roles'
import { firstParam, formatUtc, positiveInt } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'
import { getDerekStatus } from '@/lib/derek/config'
import { listDrafts } from '@/lib/derek/drafts'
import { getConversationForStaff, markStaffRead } from '@/lib/support/conversations'
import { SupportError } from '@/lib/support/db'
import { STAFF_SETTABLE, STATUS_LABEL } from '@/lib/support/state'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Conversation' }

const DRAFT_STATUS: Record<string, string> = {
  generating: 'Derek is drafting…',
  ready: 'Awaiting review',
  sent: 'Sent',
  rejected: 'Rejected',
  superseded: 'Superseded by a human reply',
  failed: 'Failed',
}

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdminPage('support.read')
  const id = positiveInt((await params).id)
  if (id == null) notFound()
  const before = positiveInt(firstParam((await searchParams).before))
  const db = getAdminPool()

  let data: Awaited<ReturnType<typeof getConversationForStaff>>
  try {
    data = await getConversationForStaff(db, actor, id, { before })
  } catch (error) {
    if (error instanceof SupportError && error.status === 404) notFound()
    throw error
  }
  // Opening the latest page marks the conversation (and its notifications) read for staff.
  if (!before) await markStaffRead(db, actor, id)

  const { conversation: c, messages, hasMore, events } = data
  const canReply = actorCan(actor, 'support.reply')
  const canReviewAi = actorCan(actor, 'support.review_ai')
  const drafts = await listDrafts(db, actor, id)
  const derek = getDerekStatus()
  const last = messages[messages.length - 1]
  const awaitingAnswer = !before && last?.authorKind === 'student'
  const openDraft = drafts.some((d) => d.status === 'ready' || d.status === 'generating')

  return (
    <>
      <PageHeader
        title={`#${c.id} · ${c.subject}`}
        crumbs={[{ href: '/admin/inbox', label: 'Live Inbox' }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ConversationBadge status={c.status} />
            <span>
              {'Student: '}
              {actorCan(actor, 'students.read') ? (
                <Link href={`/admin/students/${c.studentProfileId}`} className="text-primary hover:underline">
                  {c.studentName}
                </Link>
              ) : (
                c.studentName
              )}
              {c.studentActive ? '' : ' (account not active)'}
            </span>
            <span>{`· started ${formatUtc(c.createdAt)}`}</span>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-3">
          <Panel title="Messages">
            {hasMore ? (
              <Link href={`/admin/inbox/${id}?before=${messages[0].id}`} className="self-start text-sm text-primary hover:underline">
                Load older messages
              </Link>
            ) : null}
            {before ? (
              <Link href={`/admin/inbox/${id}`} className="self-start text-sm text-primary hover:underline">
                Back to latest
              </Link>
            ) : null}
            {messages.length ? (
              <ol className="flex flex-col gap-3">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      'flex flex-col gap-1 rounded-lg border px-4 py-3',
                      m.authorKind === 'student' ? 'border-border bg-background' : m.authorKind === 'derek' ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
                    )}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <span className={m.authorKind === 'student' ? 'font-medium text-foreground' : 'font-medium text-primary'}>{m.label}</span>
                      <time className="text-muted-foreground">{formatUtc(m.createdAt)}</time>
                    </div>
                    {/* Plain text: React escapes it; no HTML is ever rendered from a message. */}
                    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">{m.body}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState>No messages.</EmptyState>
            )}
          </Panel>

          {canReply ? (
            <Panel title="Reply">
              <ReplyForm conversationId={id} disabled={!c.studentActive} />
            </Panel>
          ) : null}
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel
            title="Derek"
            description={
              derek.state === 'ready'
                ? `Live AI is enabled (provider: ${derek.providerId}). Drafts need review before they reach the student.`
                : derek.reasons.join(' ')
            }
          >
            {canReviewAi && derek.state === 'ready' && awaitingAnswer && !openDraft ? <RequestDraftForm conversationId={id} /> : null}
            {drafts.length ? (
              <ul className="flex flex-col gap-4">
                {drafts.map((d) => (
                  <li key={d.id} className="flex flex-col gap-3 border-t border-border pt-4 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-foreground">{`Draft #${d.id}`}</span>
                      <span className="text-muted-foreground">{DRAFT_STATUS[d.status] ?? d.status}</span>
                      <RiskBadge risk={d.risk} />
                    </div>
                    {d.riskReasons.length ? (
                      <ul className="list-disc pl-5 text-xs leading-relaxed text-muted-foreground">
                        {d.riskReasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    ) : null}
                    {d.status === 'ready' && canReviewAi && d.body && d.bodySha256 ? (
                      <DraftReviewForms key={`${d.id}-${d.revision}`} draftId={d.id} revision={d.revision} bodySha256={d.bodySha256} body={d.body} />
                    ) : d.body ? (
                      <p className="rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{d.body}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {[
                        `${d.provider}${d.model ? ` · ${d.model}` : ''}`,
                        `attempts ${d.usage.attempts}`,
                        d.usage.latencyMs != null ? `${d.usage.latencyMs} ms` : null,
                        d.usage.inputTokens != null ? `tokens in/out ${d.usage.inputTokens}/${d.usage.outputTokens ?? '—'}` : null,
                        d.errorCode ? `error: ${d.errorCode}` : null,
                        d.editedByName ? `edited by ${d.editedByName}` : null,
                        d.evidenceRefs.length ? `evidence: ${d.evidenceRefs.join(', ')}` : 'no directory evidence',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>No Derek drafts for this conversation.</EmptyState>
            )}
          </Panel>

          {canReply ? (
            <Panel title="Status">
              <StatusForm conversationId={id} current={c.status} options={STAFF_SETTABLE.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
            </Panel>
          ) : null}

          <Panel title="History" description="Latest 20 status changes.">
            {events.length ? (
              <ol className="flex flex-col gap-2 text-xs">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5">
                    <span className="text-foreground">
                      {`${e.from ? `${STATUS_LABEL[e.from as keyof typeof STATUS_LABEL] ?? e.from} → ` : ''}${STATUS_LABEL[e.to as keyof typeof STATUS_LABEL] ?? e.to}`}
                    </span>
                    <span className="text-muted-foreground">
                      {`${e.actorKind === 'staff' ? (e.actorName ?? 'Team member') : e.actorKind === 'derek' ? 'Derek' : e.actorKind === 'student' ? 'Student' : 'System'} · ${formatUtc(e.createdAt)}${e.reason ? ` · ${e.reason}` : ''}`}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState>No history.</EmptyState>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}
