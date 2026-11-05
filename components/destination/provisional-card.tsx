'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { ProvisionalUniversity } from '@/lib/data/types'
import { formatDate } from '@/lib/i18n'
import { useT } from '@/lib/i18n/client'

const badge = 'inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium tracking-wide text-muted-foreground'

/**
 * A candidate listed before review (D-043, D-044). It can only render what ProvisionalUniversity carries:
 * the name, and only once the official website was checked, that website, the check date and (when the
 * website names it) the city. A pending entry shows its name and labels alone.
 */
export function ProvisionalCard({ university, href, titleAs: Title = 'h3' }: { university: ProvisionalUniversity; href?: string; titleAs?: 'h1' | 'h3' }) {
  const { t, locale, lang } = useT()
  const checked = university.identityStatus === 'checked' ? university.officialWebsite : null
  return (
    // lang: this card can sit on a page that is still published in English.
    <article lang={lang} aria-labelledby={`uni-${university.id}`} className="rounded-2xl border border-dashed border-border bg-card p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          {/* No verification or identity-check badge publicly (owner decision, 5 Nov 2026); the body text below still says what was checked. */}
          <ul className="flex flex-wrap gap-1.5" aria-label={t('common.status')}>
            {university.category === 'other' && <li className={badge}>{t('status.otherType')}</li>}
            {/* Ranking-licence wording: English only until a reviewed translation is approved. */}
            <li className={badge} lang="en">
              QS eligibility pending verification
            </li>
          </ul>
          <Title id={`uni-${university.id}`} className={`mt-1 font-serif ${Title === 'h1' ? 'text-3xl md:text-5xl' : 'text-2xl'} leading-snug text-foreground`} translate="no">
            {href ? <Link href={href} className="hover:text-primary">{university.name}</Link> : university.name}
          </Title>
          {checked && university.city && (
            <p className="text-sm text-muted-foreground" translate="no">
              {university.city}
            </p>
          )}
          {checked && university.identityCheckedAt && (
            <p className="text-xs text-muted-foreground">{t('card.checkedOn', { date: formatDate(locale, university.identityCheckedAt) })}</p>
          )}
        </div>
        {checked && (
          <a
            href={checked}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-full border border-primary/50 px-4 text-sm text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            {t('common.officialWebsite')} <ArrowUpRight className="size-4" aria-hidden />
            <span className="sr-only">{t('common.opensNewTab')}</span>
          </a>
        )}
      </header>
      <p className="mt-4 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
        {checked ? t('card.bodyChecked') : t('card.bodyPending')}
      </p>
    </article>
  )
}
