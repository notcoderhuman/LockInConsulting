'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { DEFAULT_LOCALE, HTML_LANG, LOCALE_COOKIE, translator, type Locale } from './index'

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE)
const LanguageSwitchContext = createContext(false)

/** Set once in the root layout from the server's reading of the cookie and of HINDI_UI_ENABLED. */
export function LocaleProvider({ locale, languageSwitch = false, children }: { locale: Locale; languageSwitch?: boolean; children: ReactNode }) {
  return (
    <LocaleContext.Provider value={locale}>
      <LanguageSwitchContext.Provider value={languageSwitch}>{children}</LanguageSwitchContext.Provider>
    </LocaleContext.Provider>
  )
}

export function useLocale(): Locale {
  return useContext(LocaleContext)
}

/** Whether the header offers the language switch (off until the Hindi strings are approved). */
export function useLanguageSwitch(): boolean {
  return useContext(LanguageSwitchContext)
}

/** Outside a provider (tests, isolated renders) this is English. */
export function useT() {
  const locale = useLocale()
  return useMemo(() => ({ locale, t: translator(locale), lang: HTML_LANG[locale] }), [locale])
}

/**
 * Stores the choice in a first-party cookie for a year: kept in this browser only, never sent anywhere
 * but this site, and read by the server so the next page renders in that language from the start.
 */
export function rememberLocale(locale: Locale): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
  document.documentElement.lang = HTML_LANG[locale]
}
