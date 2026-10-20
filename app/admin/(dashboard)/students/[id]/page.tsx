import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConversationBadge } from '@/components/admin/conversation-badge'
import { EmptyState, PageHeader, Panel } from '@/components/admin/page-header'
import { EraseStudentForm } from '@/components/admin/support-forms'
import { requireAdminPage } from '@/lib/admin/access'
import { humanize } from '@/lib/admin/entities'
import { actorCan } from '@/lib/admin/roles'
import { formatUtc, positiveInt } from '@/lib/admin/view'
import { getAdminPool } from '@/lib/db/pool'
import { getStudent } from '@/lib/support/conversations'
import { SupportError } from '@/lib/support/db'

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

  return (
    <>
      <PageHeader title={student.displayName} crumbs={[{ href: '/admin/students', label: 'Students' }]} description={erased ? `Erased ${formatUtc(student.erasedAt)}. No personal data or messages remain.` : undefined} />

      <Panel title="Profile">
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            ['Email', student.email ?? '—'],
            ['Status', humanize(student.status)],
            ['Joined', formatUtc(student.createdAt)],
            ['Age confirmation', student.ageConfirmedAt ? formatUtc(student.ageConfirmedAt) : 'Not recorded (flow not built; legal review pending)'],
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

      {actorCan(actor, 'students.erase') && !erased ? (
        <Panel title="Erase student data" description="Permanently deletes this student’s account, sessions, conversations, Derek drafts and notifications. A tombstone and a change-log entry (without content) remain. This cannot be undone.">
          <EraseStudentForm profileId={student.id} />
        </Panel>
      ) : null}
    </>
  )
}
