import { ENTITIES, type EntityKey, type FieldDef } from './entities'

type R = Record<string, unknown>

export const recordHref = (entity: EntityKey, id: unknown) => `/admin/records/${entity}/${id}`

export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** Current DB values → the string defaults the capture form expects, keyed by input name. */
export function rowToFormValues(entity: EntityKey, row: R | null): Record<string, string> {
  const values: Record<string, string> = {}
  if (!row) return values
  for (const f of ENTITIES[entity].fields) {
    const v = row[f.column]
    values[f.name] = v == null ? '' : f.kind === 'checkbox' ? (Number(v) ? '1' : '') : String(v)
  }
  return values
}

/** Read-only display of a field value. `lookups` resolves ids (sources, campuses…) to labels. */
export function displayValue(field: FieldDef, row: R, lookups: Partial<Record<string, Map<string, string>>> = {}): string {
  const v = row[field.column]
  if (field.kind === 'checkbox') return Number(v) ? 'Yes' : 'No'
  if (v == null || v === '') return '—'
  if (field.kind === 'select') return field.options?.find((o) => o.value === String(v))?.label ?? String(v)
  const lookup = lookups[field.kind]
  if (lookup) return lookup.get(String(v)) ?? `#${v}`
  return String(v)
}

/** "2026-10-15 09:12:03.123" (UTC, from the DB) → "15 Oct 2026, 09:12 UTC". */
export function formatUtc(value: unknown): string {
  if (value == null) return '—'
  const d = new Date(`${String(value).replace(' ', 'T')}Z`)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`
}

export function formatDate(value: unknown): string {
  if (value == null || value === '') return '—'
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function parseJson(value: unknown): R | null {
  if (value == null) return null
  if (typeof value === 'object') return value as R
  try {
    return JSON.parse(String(value)) as R
  } catch {
    return null
  }
}

const IGNORED = new Set(['updated_at', 'created_at'])

/** Column names whose value differs between the before/after snapshots of a log entry. */
export function changedColumns(before: unknown, after: unknown): string[] {
  const a = parseJson(before) ?? {}
  const b = parseJson(after) ?? {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((k) => !IGNORED.has(k) && JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v?.trim() || undefined
}

export function positiveInt(value: string | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null
  const n = Number(value)
  return n > 0 ? n : null
}
