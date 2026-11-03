import 'server-only'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, LOCALE_COOKIE, toLocale, translator, type Locale } from './index'

/**
 * Hindi stays off until a fluent reviewer approves its strings (docs/HINDI-REVIEW.md). While off, the
 * switch is hidden and a stale `lockin-lang` cookie is ignored, so no draft Hindi reaches a reader.
 */
export const hindiEnabled = (): boolean => process.env.HINDI_UI_ENABLED === 'true'

/** The reader's language from their preference cookie; English outside a request (tests, build). */
export async function getLocale(): Promise<Locale> {
  if (!hindiEnabled()) return DEFAULT_LOCALE
  try {
    return toLocale((await cookies()).get(LOCALE_COOKIE)?.value)
  } catch {
    return DEFAULT_LOCALE
  }
}

export async function getT() {
  const locale = await getLocale()
  return { locale, t: translator(locale) }
}
