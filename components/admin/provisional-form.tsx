'use client'

import { Button } from '@/components/ui/button'
import { provisionalListingAction } from '@/app/admin/actions'
import { controlClass, Field, FormMessage } from './form-controls'
import { useFormAction } from './use-form-action'

// Reviewer control for the identity-only "Not yet verified" public entry (D-043).
export function ProvisionalForm({ id, listed, hasCity }: { id: number; listed: boolean; hasCity: boolean }) {
  const { state, pending, onSubmit } = useFormAction(provisionalListingAction)
  const fid = `prov-${id}-${listed ? 'hide' : 'show'}`
  const help = listed
    ? 'Why it should leave the public list (for example, the website does not match).'
    : 'How you confirmed this is the institution’s official website (opened it, name matches, date).'
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="show" value={listed ? '0' : '1'} />
      <Field id={`${fid}-reason`} label="Reason" required help={help} errors={state?.fieldErrors?.reason}>
        <textarea id={`${fid}-reason`} name="reason" rows={2} required minLength={5} maxLength={500} className={controlClass} />
      </Field>
      {!listed && hasCity && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="cityConfirmed" className="mt-1" />
          The official website states the city
        </label>
      )}
      <FormMessage state={state} />
      <Button type="submit" variant={listed ? 'outline' : 'default'} disabled={pending} className="self-start">
        {listed ? 'Remove from public list' : 'List as “Not yet verified”'}
      </Button>
    </form>
  )
}
