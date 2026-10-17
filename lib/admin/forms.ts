import { z } from 'zod'
import {
  acceptanceRateInput,
  campusInput,
  courseInput,
  intakeInput,
  rankingInput,
  tuitionFeeInput,
  universityInput,
} from '@/lib/data/validation'
import { ENTITIES, type EntityKey, type FieldDef } from './entities'

export type FieldErrors = Record<string, string[] | undefined>

const SCHEMAS: Record<EntityKey, z.ZodType> = {
  university: universityInput,
  campus: campusInput,
  course: courseInput,
  course_intake: intakeInput,
  tuition_fee: tuitionFeeInput,
  acceptance_rate: acceptanceRateInput,
  university_ranking: rankingInput,
}

const ID_KINDS = new Set(['int', 'source', 'campus', 'course', 'ranking_provider'])

function text(form: FormData, name: string): string {
  const v = form.get(name)
  return typeof v === 'string' ? v.trim() : ''
}

function rawValue(field: FieldDef, form: FormData): unknown {
  if (field.kind === 'checkbox') return form.get(field.name) === 'on'
  const s = text(form, field.name)
  if (ID_KINDS.has(field.kind) || field.numeric) return s === '' ? undefined : Number(s)
  if (field.kind === 'decimal') return s === '' ? null : s
  return s === '' ? undefined : s
}

const optionalId = z.number().int().positive().optional()

export type ParsedEntityForm =
  | { ok: true; row: Record<string, string | number | null> }
  | { ok: false; fieldErrors: FieldErrors }

/**
 * Turns submitted form fields into a whitelisted column → value map, validated by the existing
 * zod schemas in lib/data/validation.ts. Unknown form fields are ignored.
 */
export function parseEntityForm(entity: EntityKey, form: FormData, parentId: number | null): ParsedEntityForm {
  const def = ENTITIES[entity]
  const raw: Record<string, unknown> = {}
  for (const f of def.fields) raw[f.name] = rawValue(f, form)
  if (def.parent) raw[def.parent.inputKey] = parentId ?? undefined

  const result = SCHEMAS[entity].safeParse(raw)
  const fieldErrors: FieldErrors = result.success ? {} : { ...z.flattenError(result.error).fieldErrors }

  // Fields the zod schemas don't model (source, campus) are validated as optional ids here.
  const extras: Record<string, unknown> = {}
  for (const f of def.fields) {
    if (f.kind !== 'source' && f.kind !== 'campus') continue
    const parsed = optionalId.safeParse(raw[f.name])
    if (parsed.success) extras[f.name] = parsed.data
    else fieldErrors[f.name] = ['Choose a valid option.']
  }
  if (!result.success || Object.values(fieldErrors).some((e) => e?.length)) return { ok: false, fieldErrors }

  const data = { ...(result.data as Record<string, unknown>), ...extras }
  const row: Record<string, string | number | null> = {}
  for (const f of def.fields) {
    const v = data[f.name]
    row[f.column] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null)
  }
  if (def.parent) row[def.parent.column] = parentId
  // university_rankings.subject is NOT NULL (empty string = overall ranking).
  if (entity === 'university_ranking' && row.subject == null) row.subject = ''
  return { ok: true, row }
}

export function formText(form: FormData, name: string): string {
  return text(form, name)
}

export function formId(form: FormData, name: string): number | null {
  const s = text(form, name)
  if (!/^\d{1,15}$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}
