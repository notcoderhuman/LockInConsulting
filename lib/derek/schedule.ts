import 'server-only'
import { after } from 'next/server'
import { getAdminPool } from '@/lib/db/pool'
import { getDerekStatus } from './config'
import { prepareDerekDraft } from './drafts'

// Starts Derek's draft worker after the student's response has been sent, so the student never
// waits on the AI provider and a provider failure can never lose their (already saved) message.
// A no-op while Derek is disabled, which is the default.

export function scheduleDerekDraft(conversationId: number, triggerMessageId: number | null): void {
  if (triggerMessageId == null || getDerekStatus().state !== 'ready') return
  const run = () =>
    prepareDerekDraft(getAdminPool(), conversationId, triggerMessageId).catch((error) => {
      console.error('[derek] worker failed', error instanceof Error ? error.name : 'unknown error')
    })
  try {
    after(run)
  } catch {
    // Outside a request scope (scripts/tests): run detached.
    void run()
  }
}
