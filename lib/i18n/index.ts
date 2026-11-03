import { en, type MessageKey } from './en'
import { hi } from './hi'

export type { MessageKey }
export const LOCALES = ['en', 'hi'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
/** First-party preference cookie, read on the server so the first paint is already in the chosen language. */
export const LOCALE_COOKIE = 'lockin-lang'
/** The value for <html lang> and lang="" attributes. */
export const HTML_LANG: Record<Locale, string> = { en: 'en-IN', hi: 'hi-IN' }

const DICTIONARIES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, hi }

export const toLocale = (value: string | null | undefined): Locale => (value === 'hi' ? 'hi' : DEFAULT_LOCALE)

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

/** A translator for one locale. Any key the locale lacks falls back to English, never to the raw key. */
export function translator(locale: Locale): Translate {
  return (key, vars) => {
    const text = DICTIONARIES[locale][key] ?? en[key]
    return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text
  }
}

/** 26 Oct 2026 / 26 अक्टूबर 2026 (Hindi short months read as clipped). ISO dates are calendar dates, so formatted in UTC. */
export function formatDate(locale: Locale, iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return locale === 'hi'
    ? new Intl.DateTimeFormat('hi-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}
