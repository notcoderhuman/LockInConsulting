import type { Metadata } from 'next'
import Link from 'next/link'
import { EmptyState, PageHeader, Panel } from '@/components/admin/page-header'
import { FxRateForm, FxTermsForm, RankingRightsForm } from '@/components/admin/settings-forms'
import { requireAdminPage } from '@/lib/admin/access'
import { humanize } from '@/lib/admin/entities'
import { getSettingsData, type Row } from '@/lib/admin/queries'
import { can, ROLE_LABEL, type AdminRole } from '@/lib/admin/roles'
import { formatDate, formatUtc } from '@/lib/admin/view'
import { todayIso } from '@/lib/data/publication'
import { getAdminPool } from '@/lib/db/pool'

export const metadata: Metadata = { title: 'Settings' }

const str = (v: unknown) => (v == null ? '' : String(v))

function Facts({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm leading-relaxed whitespace-pre-line text-foreground">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

function rankingValues(p: Row) {
  return {
    rightsStatus: str(p.rights_status),
    licenceReference: str(p.licence_reference),
    licenceScope: str(p.licence_scope),
    licenceExpiresAt: str(p.licence_expires_at),
    rightsCheckedAt: str(p.rights_checked_at),
    rightsNotes: str(p.rights_notes),
  }
}

function fxValues(p: Row) {
  return {
    termsStatus: str(p.terms_status),
    currenciesCovered: str(p.currencies_covered),
    attributionText: str(p.attribution_text),
    updateFrequency: str(p.update_frequency),
    termsCheckedAt: str(p.terms_checked_at),
    termsNotes: str(p.terms_notes),
  }
}

export default async function SettingsPage() {
  const actor = await requireAdminPage('data.read')
  const { rankingProviders, fxProviders, fxRates, members, fxSources, names } = await getSettingsData(getAdminPool())
  const manageRights = can(actor.role, 'rights.manage')
  const enterRates = can(actor.role, 'data.review')
  const approved = fxProviders.filter((p) => p.terms_status === 'approved')

  return (
    <>
      <PageHeader
        title="Settings"
        description="Data-licensing decisions that control what may be shown publicly. Only the owner can change rights and terms; every change is logged."
      />

      <Panel title="Ranking reuse rights" description="Rankings are hidden from students until the provider's terms permit reuse. QS rankings are not shown without a licence.">
        {rankingProviders.length ? (
          <div className="flex flex-col divide-y divide-border">
            {rankingProviders.map((p) => (
              <article key={String(p.id)} className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-serif text-xl text-foreground">{String(p.name)}</h3>
                  <span className="text-xs font-medium text-primary">{humanize(str(p.rights_status))}</span>
                </div>
                {manageRights ? (
                  <RankingRightsForm providerId={Number(p.id)} values={rankingValues(p)} />
                ) : (
                  <Facts
                    items={[
                      ['Licence reference', str(p.licence_reference)],
                      ['Licence expires', formatDate(p.licence_expires_at)],
                      ['Confirmed on', formatDate(p.rights_checked_at)],
                      ['Notes', str(p.rights_notes)],
                    ]}
                  />
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState>No ranking providers configured.</EmptyState>
        )}
      </Panel>

      <Panel title="Exchange-rate providers" description="Approximate INR conversions are shown only from a provider whose terms the owner has reviewed and approved.">
        {fxProviders.length ? (
          <div className="flex flex-col divide-y divide-border">
            {fxProviders.map((p) => (
              <article key={String(p.id)} className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-serif text-xl text-foreground">{String(p.name)}</h3>
                  <span className="text-xs text-muted-foreground">
                    {`${humanize(str(p.terms_status))}`}
                    {p.terms_reviewed_by ? ` · reviewed by ${names.get(String(p.terms_reviewed_by)) ?? String(p.terms_reviewed_by)}` : ''}
                  </span>
                </div>
                {manageRights ? (
                  <FxTermsForm providerId={Number(p.id)} values={fxValues(p)} />
                ) : (
                  <Facts
                    items={[
                      ['Currencies', str(p.currencies_covered)],
                      ['Attribution', str(p.attribution_text)],
                      ['Checked on', formatDate(p.terms_checked_at)],
                      ['Notes', str(p.terms_notes)],
                    ]}
                  />
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState>No exchange-rate providers configured.</EmptyState>
        )}
      </Panel>

      <Panel title="Exchange rates" description="Entered by hand from the approved provider's published page. Latest 20 shown.">
        {enterRates ? (
          approved.length ? (
            fxSources.length ? (
              <FxRateForm
                providers={approved.map((p) => ({ value: String(p.id), label: String(p.name) }))}
                sources={fxSources.map((s) => ({ value: String(s.id), label: `${s.title} — ${s.publisher}` }))}
                today={todayIso()}
              />
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {'Record the provider’s rate page as a source of type “exchange rate provider” first. '}
                <Link href="/admin/sources/new?type=exchange_rate_provider&returnTo=/admin/settings" className="text-primary hover:underline">
                  Record source
                </Link>
              </p>
            )
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">No provider has approved terms, so rates cannot be entered and INR estimates stay hidden.</p>
          )
        ) : null}
        {fxRates.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Date</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Pair</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Rate</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Provider</th>
                  <th scope="col" className="py-2 font-medium">Entered by</th>
                </tr>
              </thead>
              <tbody>
                {fxRates.map((r) => (
                  <tr key={String(r.id)} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{formatDate(r.rate_date)}</td>
                    <td className="py-2 pr-4 text-foreground">{`${r.base_currency} → ${r.quote_currency}`}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums text-foreground">{String(r.rate)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{str(r.provider_name) || '—'}</td>
                    <td className="py-2 text-muted-foreground">{names.get(str(r.entered_by)) ?? (str(r.entered_by) || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No exchange rates recorded.</EmptyState>
        )}
      </Panel>

      {can(actor.role, 'members.read') ? (
        <Panel title="Admin members" description="Accounts are created and roles changed only with scripts/admin-user.mjs, so access can't be escalated from the browser.">
          {members.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {members.map((m) => (
                <li key={String(m.user_id)} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <span className="block truncate text-sm text-foreground">{String(m.name)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{String(m.email)}</span>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <span className={m.status === 'active' ? 'block font-medium text-primary' : 'block'}>
                      {`${ROLE_LABEL[m.role as AdminRole] ?? str(m.role)} · ${humanize(str(m.status))}`}
                    </span>
                    <span className="block">{`Granted ${formatUtc(m.granted_at)}${m.granted_by ? ` by ${names.get(String(m.granted_by)) ?? String(m.granted_by)}` : ''}`}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No members.</EmptyState>
          )}
        </Panel>
      ) : null}
    </>
  )
}
