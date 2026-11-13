import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConversationBadge } from '@/components/admin/conversation-badge'
import { EmptyState, PageHeader, Panel } from '@/components/admin/page-header'
import { EraseStudentForm, RestrictionReviewForm } from '@/components/admin/support-forms'
import { activeRestriction } from '@/lib/derek/abuse'
import { requireAdminPage } from '@/lib/admin/access'
import { humanize } from '@/lib/admin/entities'
import { actorCan } from '@/lib/admin/roles'
import { formatUtc, positiveInt } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'
import { getStudent } from '@/lib/support/conversations'
import { selectRows, SupportError } from '@/lib/support/db'

export const metadata: Metadata = { title: 'Student' }

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminPage('students.read')
  const id = positiveInt((await params).id)
  if (id == null) notFound()
  let student: Awaited<ReturnType<typeof getStudent>>
  try {
    student = await getStudent(getAdminPool(), actor, id)
  } catch (error) {
    if (error instanceof SupportError && error.status === 404) notFound()
    throw error
  }
  const erased = student.status === 'erased'
  const restriction = erased ? null : await activeRestriction(getAdminPool(), id)
  const incidents = erased ? [] : await selectRows(getAdminPool(), 'SELECT id, category, kind, action, reason, evidence, created_at AS createdAt FROM student_abuse_incidents WHERE student_profile_id = ? ORDER BY id DESC LIMIT 25', [id])

  return (
    <>
      <PageHeader title={student.displayName} crumbs={[{ href: '/admin/students', label: 'Students' }]} description={erased ? `Erased ${formatUtc(student.erasedAt)}. No personal data or messages remain.` : undefined} />

      <Panel title="Profile">
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            ['Email', student.email ?? '—'],
            ['Status', humanize(student.status)],
            ['Joined', formatUtc(student.createdAt)],
            ['Age confirmation', student.ageConfirmedAt ? formatUtc(student.ageConfirmedAt) : 'Not recorded: Derek will not draft for this student'],
            ['Privacy notice accepted', student.privacyNoticeVersion ?? 'Not recorded'],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {actorCan(actor, 'support.read') ? (
        <Panel title="Conversations">
          {student.conversations.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {student.conversations.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <Link href={`/admin/inbox/${c.id}`} className="min-w-0 truncate text-sm text-foreground hover:text-primary">{`#${c.id} · ${c.subject}`}</Link>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ConversationBadge status={c.status} />
                    {formatUtc(c.lastMessageAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No conversations.</EmptyState>
          )}
        </Panel>
      ) : null}

      {actorCan(actor, 'support.read') && !erased ? (
        <Panel title="Conduct" description="Requests Derek refused as misuse, and any account restriction. Excerpts are redacted and for staff only.">
          {restriction ? (
            <div className="mb-4 flex flex-col gap-3 rounded-md border border-border p-3">
              <p className="text-sm text-foreground">{`Restricted since ${formatUtc(restriction.createdAt)}: ${restriction.reason} (${restriction.policy}). Notice email: ${restriction.emailSentAt ? 'sent' : restriction.emailError ? `not sent (${restriction.emailError})` : 'pending'}.`}</p>
              {actorCan(actor, 'students.erase') ? <RestrictionReviewForm restrictionId={Number(restriction.id)} emailSent={Boolean(restriction.emailSentAt)} /> : null}
            </div>
          ) : null}
          {incidents.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {incidents.map((i) => (
                <li key={String(i.id)} className="flex flex-col gap-0.5 py-2 text-sm">
                  <span className="text-foreground">{`${formatUtc(i.createdAt)} · category ${i.category} · ${i.kind} · ${i.action}`}</span>
                  <span className="text-xs text-muted-foreground">{`${i.reason}${i.evidence ? ` — “${i.evidence}”` : ''}`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No misuse recorded.</EmptyState>
          )}
        </Panel>
      ) : null}

      {actorCan(actor, 'students.erase') && !erased ? (
        <Panel title="Erase student data" description="Permanently deletes this student’s account, sessions, conversations, Derek drafts and notifications. A tombstone and a change-log entry (without content) remain. This cannot be undone.">
          <EraseStudentForm profileId={student.id} />
        </Panel>
      ) : null}
    </>
  )
}
