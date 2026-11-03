'use client'

import { ArrowUpRight, Search } from 'lucide-react'
import { useState } from 'react'
import { controlClass } from '@/components/admin/form-controls'
import type { FaqEntry } from '@/lib/content/faq'
import { searchFaq } from '@/lib/faq-search'
import { formatDate } from '@/lib/i18n'
import { useT } from '@/lib/i18n/client'

/** Searchable, owner-approved FAQ. Each answer is a native <details>, so it opens with Enter or Space. */
export function FaqSearch({ entries }: { entries: readonly FaqEntry[] }) {
  const { t, locale } = useT()
  const [query, setQuery] = useState('')
  const shown = searchFaq(entries, query)
  return (
    <div className="flex flex-col gap-6">
      <div role="search" aria-label={t('faq.search')} className="flex flex-col gap-1.5">
        <label htmlFor="faq-q" className="text-sm font-medium text-foreground">
          {t('faq.searchLabel')}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" aria-hidden />
          <input id="faq-q" type="search" value={query} maxLength={80} onChange={(e) => setQuery(e.target.value)} className={`${controlClass} min-h-11 pl-9 text-base md:text-sm`} />
        </div>
      </div>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {query.trim() ? (shown.length ? t('faq.matches', { n: shown.length, total: entries.length }) : t('faq.noMatch')) : t('faq.count', { n: entries.length })}
      </p>
      {locale !== 'en' && <p className="text-xs text-muted-foreground">{t('faq.answersInEnglish')}</p>}
      {/* Approved answers are published in English only, until a reviewed translation exists. */}
      <ul lang="en" className="flex flex-col gap-3">
        {shown.map((e) => (
          <li key={e.id} id={e.id} className="scroll-mt-24">
            <details className="group rounded-2xl border border-border bg-card open:border-primary/40">
              <summary className="flex min-h-11 cursor-pointer flex-col gap-1 p-5">
                <span className="text-xs uppercase tracking-[0.18em] text-primary">{e.topic}</span>
                <span className="font-serif text-xl leading-snug text-foreground">{e.question}</span>
              </summary>
              <div className="flex flex-col gap-3 border-t border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground">
                {e.answer.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {e.source && (
                  <a href={e.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 self-start text-primary hover:underline hover:underline-offset-4">
                    {e.source.label} <ArrowUpRight className="size-4" aria-hidden />
                    <span className="sr-only">{t('common.opensNewTab')}</span>
                  </a>
                )}
                <p className="text-xs">{t('faq.reviewed', { date: formatDate(locale, e.approvedOn) })}</p>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}
