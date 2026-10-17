import type { InrConversion, IsoDate } from './types'

/** A stored INR rate older than this is not shown, rather than presenting a stale conversion. */
export const MAX_FX_RATE_AGE_DAYS = 7

export interface StoredFxRate {
  rate: string
  rateDate: IsoDate
  sourceTitle: string
  sourceUrl: string
  providerName?: string
  attributionText?: string
}

const DAY_MS = 86_400_000

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** Approximate INR value, rounded to whole rupees. Returns null if there's no fresh rate. */
export function convertToInr(
  amount: string | null,
  currency: string,
  fx: StoredFxRate | undefined,
  today: IsoDate,
  maxAgeDays = MAX_FX_RATE_AGE_DAYS,
): InrConversion | null {
  if (amount == null || currency === 'INR' || !fx) return null
  const age = daysBetween(fx.rateDate, today)
  if (age < 0 || age > maxAgeDays) return null
  const value = Number(amount) * Number(fx.rate)
  if (!Number.isFinite(value) || value <= 0) return null
  return {
    amountInr: Math.round(value),
    rate: fx.rate,
    rateDate: fx.rateDate,
    sourceTitle: fx.sourceTitle,
    sourceUrl: fx.sourceUrl,
    ...(fx.providerName ? { providerName: fx.providerName } : {}),
    ...(fx.attributionText ? { attributionText: fx.attributionText } : {}),
  }
}

export function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(Number(amount))
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
}

export function formatIsoDate(date: IsoDate): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )
}
