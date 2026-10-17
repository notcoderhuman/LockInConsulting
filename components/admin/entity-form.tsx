'use client'

import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { createRecordAction, updateRecordAction } from '@/app/admin/actions'
import { ENTITIES, type EntityKey, type FieldDef, type FieldOption } from '@/lib/admin/entities'
import { controlClass, describedBy, Field, FormMessage } from './form-controls'
import { useFormAction } from './use-form-action'

export type PickerOptions = Record<'source' | 'ranking_provider' | 'campus' | 'course', FieldOption[]>

function Control({ field, value, errors, options }: { field: FieldDef; value: string; errors?: string[]; options: PickerOptions }) {
  const id = `f-${field.name}`
  const common = {
    id,
    name: field.name,
    'aria-invalid': errors?.length ? true : undefined,
    'aria-describedby': describedBy(id, field.help, errors),
  }
  switch (field.kind) {
    case 'textarea':
      return <textarea {...common} rows={4} defaultValue={value} required={field.required} className={controlClass} />
    case 'checkbox':
      return (
        <input
          {...common}
          type="checkbox"
          defaultChecked={value === '1' || value === 'true'}
          className="size-4 accent-primary"
        />
      )
    case 'select':
    case 'source':
    case 'campus':
    case 'course':
    case 'ranking_provider': {
      const list = field.kind === 'select' ? (field.options ?? []) : options[field.kind]
      return (
        <select {...common} defaultValue={value} required={field.required} className={controlClass}>
          <option value="">{field.required ? 'Choose…' : 'None'}</option>
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    }
    default: {
      const type = field.kind === 'url' ? 'url' : field.kind === 'date' ? 'date' : 'text'
      const inputMode = field.kind === 'int' ? 'numeric' : field.kind === 'decimal' ? 'decimal' : undefined
      return (
        <input
          {...common}
          type={type}
          inputMode={inputMode}
          defaultValue={value}
          placeholder={field.placeholder}
          required={field.required}
          className={controlClass}
        />
      )
    }
  }
}

export function EntityForm({
  entity,
  mode,
  id,
  parentId,
  values,
  options,
  cancelHref,
}: {
  entity: EntityKey
  mode: 'create' | 'update'
  id?: number
  parentId?: number | null
  values: Record<string, string>
  options: PickerOptions
  cancelHref: string
}) {
  const def = ENTITIES[entity]
  const { state, pending, onSubmit } = useFormAction(mode === 'create' ? createRecordAction : updateRecordAction)
  const errors = state?.fieldErrors ?? {}

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="entity" value={entity} />
      {id != null ? <input type="hidden" name="id" value={id} /> : null}
      {parentId != null ? <input type="hidden" name="parentId" value={parentId} /> : null}

      <div className="grid gap-5 md:grid-cols-2">
        {def.fields.map((field) => (
          <Field
            key={field.name}
            id={`f-${field.name}`}
            label={field.label}
            required={field.required}
            help={field.help}
            errors={errors[field.name]}
            className={field.kind === 'textarea' ? 'md:col-span-2' : field.kind === 'checkbox' ? 'flex-row-reverse items-center justify-end gap-3' : undefined}
          >
            <Control field={field} value={values[field.name] ?? ''} errors={errors[field.name]} options={options} />
          </Field>
        ))}
      </div>

      <FormMessage state={state} />

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? `Save draft ${def.label.toLowerCase()}` : 'Save changes'}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: 'ghost' })}>
          Cancel
        </Link>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {mode === 'create'
            ? 'New records are saved as unverified drafts. Nothing appears publicly until a reviewer publishes it.'
            : 'Saving clears the existing verification. A reviewer must verify the record again.'}
        </p>
      </div>
    </form>
  )
}
