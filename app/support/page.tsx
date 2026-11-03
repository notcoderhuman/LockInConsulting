import { redirect } from 'next/navigation'
import { authPathFor, CHAT_PATH } from '@/lib/student/next-path'

// The student chat moved to /chat and sign-in to /auth. Old links (notifications, bookmarks,
// an OAuth error page) keep working: a conversation number and an error code are carried over,
// nothing else.
export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const c = Number(one(params.c))
  const error = one(params.error)
  if (error && /^[a-z_]{1,64}$/.test(error)) redirect(authPathFor(CHAT_PATH, { error }))
  redirect(Number.isSafeInteger(c) && c > 0 ? `${CHAT_PATH}?c=${c}` : CHAT_PATH)
}
