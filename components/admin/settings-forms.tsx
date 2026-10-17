'use client'

import { Button } from '@/components/ui/button'
import { createFxRateAction, updateFxTermsAction, updateRankingRightsAction } from '@/app/admin/actions'
import { humanize, type FieldOption } from '@/lib/admin/entities'
import { FX_TERMS_STATUSES } from '@/lib/data/validation'
import { RIGHTS_STATUSES, SUPPORTED_CURRENCIES } from '@/lib/data/types'
import { controlClass, Field, FormMessage } from './form-controls'
import { useFormAction } from './use-form-action'

type Values = Record<string, string>

export function RankingRightsForm({ providerId, values }: { providerId: number; values: Values }) {
  const { state, pending, onSubmit } = useFormAction(updateRankingRightsAction)
  const e = state?.fieldErrors ?? {}
  const p = `rr-${providerId}`
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={providerId} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field id={`${p}-status`} label="Reuse rights" required errors={e.rightsStatus} help="Rankings stay hidden unless this is Licensed or Not required.">
          <select id={`${p}-status`} name="rightsStatus" defaultValue={values.rightsStatus} className={controlClass}>
            {RIGHTS_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${p}-ref`} label="Licence reference" errors={e.licenceReference}>
          <input id={`${p}-ref`} name="licenceReference" defaultValue={values.licenceReference} maxLength={200} className={controlClass} />
        </Field>
        <Field id={`${p}-exp`} label="Licence expires" errors={e.licenceExpiresAt}>
          <input id={`${p}-exp`} name="licenceExpiresAt" type="date" defaultValue={values.licenceExpiresAt} className={controlClass} />
        </Field>
        <Field id={`${p}-checked`} label="Rights confirmed on" errors={e.rightsCheckedAt}>
          <input id={`${p}-checked`} name="rightsCheckedAt" type="date" defaultValue={values.rightsCheckedAt} className={controlClass} />
        </Field>
        <Field id={`${p}-scope`} label="What the licence permits" errors={e.licenceScope} className="md:col-span-2">
          <textarea id={`${p}-scope`} name="licenceScope" rows={2} defaultValue={values.licenceScope} className={controlClass} />
        </Field>
        <Field id={`${p}-notes`} label="Notes" errors={e.rightsNotes} className="md:col-span-2">
          <textarea id={`${p}-notes`} name="rightsNotes" rows={2} defaultValue={values.rightsNotes} className={controlClass} />
        </Field>
        <Field id={`${p}-reason`} label="Reason for this change" className="md:col-span-2" help="Stored in the change log.">
          <input id={`${p}-reason`} name="reason" maxLength={500} className={controlClass} />
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Save rights'}
      </Button>
    </form>
  )
}

export function FxTermsForm({ providerId, values }: { providerId: number; values: Values }) {
  const { state, pending, onSubmit } = useFormAction(updateFxTermsAction)
  const e = state?.fieldErrors ?? {}
  const p = `fx-${providerId}`
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={providerId} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field id={`${p}-status`} label="Terms review" required errors={e.termsStatus} help="INR estimates use this provider only once approved.">
          <select id={`${p}-status`} name="termsStatus" defaultValue={values.termsStatus} className={controlClass}>
            {FX_TERMS_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${p}-checked`} label="Terms checked on" errors={e.termsCheckedAt}>
          <input id={`${p}-checked`} name="termsCheckedAt" type="date" defaultValue={values.termsCheckedAt} className={controlClass} />
        </Field>
        <Field id={`${p}-cur`} label="Currencies covered" errors={e.currenciesCovered}>
          <input id={`${p}-cur`} name="currenciesCovered" defaultValue={values.currenciesCovered} placeholder="USD, GBP, EUR…" className={controlClass} />
        </Field>
        <Field id={`${p}-freq`} label="Update frequency" errors={e.updateFrequency}>
          <input id={`${p}-freq`} name="updateFrequency" defaultValue={values.updateFrequency} className={controlClass} />
        </Field>
        <Field id={`${p}-attr`} label="Required attribution" errors={e.attributionText} className="md:col-span-2">
          <input id={`${p}-attr`} name="attributionText" defaultValue={values.attributionText} maxLength={500} className={controlClass} />
        </Field>
        <Field id={`${p}-notes`} label="Notes" errors={e.termsNotes} className="md:col-span-2">
          <textarea id={`${p}-notes`} name="termsNotes" rows={3} defaultValue={values.termsNotes} className={controlClass} />
        </Field>
        <Field id={`${p}-reason`} label="Reason for this change" className="md:col-span-2" help="Stored in the change log.">
          <input id={`${p}-reason`} name="reason" maxLength={500} className={controlClass} />
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Save terms review'}
      </Button>
    </form>
  )
}

export function FxRateForm({ providers, sources, today }: { providers: FieldOption[]; sources: FieldOption[]; today: string }) {
  const { state, pending, onSubmit } = useFormAction(createFxRateAction)
  const e = state?.fieldErrors ?? {}
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 md:grid-cols-3">
        <Field id="r-provider" label="Provider" required errors={e.providerId}>
          <select id="r-provider" name="providerId" className={controlClass}>
            <option value="">Choose…</option>
            {providers.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="r-source" label="Source page" required errors={e.sourceId}>
          <select id="r-source" name="sourceId" className={controlClass}>
            <option value="">Choose…</option>
            {sources.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="r-date" label="Rate date" required errors={e.rateDate}>
          <input id="r-date" name="rateDate" type="date" max={today} defaultValue={today} className={controlClass} />
        </Field>
        <Field id="r-base" label="Currency" required errors={e.baseCurrency}>
          <select id="r-base" name="baseCurrency" className={controlClass}>
            {SUPPORTED_CURRENCIES.filter((c) => c !== 'INR').map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field id="r-rate" label="INR per 1 unit" required errors={e.rate} help="As published, e.g. 83.1245." className="md:col-span-2">
          <input id="r-rate" name="rate" inputMode="decimal" className={controlClass} />
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending || providers.length === 0} className="self-start">
        {pending ? 'Saving…' : 'Record rate'}
      </Button>
    </form>
  )
}
