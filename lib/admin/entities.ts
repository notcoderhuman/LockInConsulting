import { DESTINATIONS } from '@/lib/destinations'
import {
  APPLICANT_SCOPES,
  BILLING_PERIODS,
  FEE_CATEGORIES,
  QUALIFICATIONS,
  STUDY_LEVELS,
  STUDY_MODES,
  SUPPORTED_CURRENCIES,
} from '@/lib/data/types'
import type { LogEntityType } from './audit'

// Describes every workflow entity once: its table, parent, public view and capture form.
// Table and column names come only from here, never from user input.

export type EntityKey =
  | 'university'
  | 'campus'
  | 'course'
  | 'course_intake'
  | 'tuition_fee'
  | 'acceptance_rate'
  | 'university_ranking'

export type FieldKind = 'text' | 'textarea' | 'url' | 'int' | 'decimal' | 'date' | 'select' | 'checkbox' | 'source' | 'campus' | 'course' | 'ranking_provider'

export interface FieldOption {
  value: string
  label: string
}

export interface FieldDef {
  /** Key in the zod input object. */
  name: string
  /** Base-table column. */
  column: string
  label: string
  kind: FieldKind
  required?: boolean
  options?: FieldOption[]
  help?: string
  placeholder?: string
  /** Select whose option values are numbers. */
  numeric?: boolean
}

export interface EntityDef {
  key: EntityKey
  logType: LogEntityType
  table: string
  label: string
  plural: string
  parent: { entity: EntityKey; column: string; inputKey: string } | null
  children: EntityKey[]
  /** null = no public read surface yet (campuses are not shown publicly). */
  publicView: string | null
  /** Fees and acceptance rates may be published as "not publicly available". */
  allowUnavailable: boolean
  /** Column that must be empty when unavailable and present when verified. */
  valueColumn: string | null
  fields: FieldDef[]
}

const opts = (values: readonly string[], label: (v: string) => string = humanize): FieldOption[] =>
  values.map((v) => ({ value: v, label: label(v) }))

export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const SOURCE_FIELD: FieldDef = {
  name: 'sourceId',
  column: 'source_id',
  label: 'Source',
  kind: 'source',
  help: 'The official page this record comes from. Required before it can be verified.',
}

export const ENTITIES: Record<EntityKey, EntityDef> = {
  university: {
    key: 'university',
    logType: 'university',
    table: 'universities',
    label: 'University',
    plural: 'Universities',
    parent: null,
    children: ['campus', 'course', 'acceptance_rate', 'university_ranking'],
    publicView: 'public_universities',
    allowUnavailable: false,
    valueColumn: null,
    fields: [
      { name: 'name', column: 'name', label: 'Official name', kind: 'text', required: true },
      { name: 'slug', column: 'slug', label: 'URL slug', kind: 'text', required: true, help: 'Lowercase letters, numbers and hyphens.', placeholder: 'university-of-example' },
      {
        name: 'destinationIso2',
        column: 'destination_iso2',
        label: 'Destination',
        kind: 'select',
        required: true,
        options: DESTINATIONS.map((d) => ({ value: d.iso2, label: d.name })),
      },
      { name: 'officialWebsite', column: 'official_website', label: 'Official website', kind: 'url', help: 'Required before publishing.' },
      { name: 'city', column: 'city', label: 'City', kind: 'text' },
      { name: 'subRegion', column: 'sub_region', label: 'Sub-region', kind: 'text', help: 'e.g. Dubai within the UAE.' },
      { name: 'institutionType', column: 'institution_type', label: 'Institution type', kind: 'select', options: opts(['unknown', 'public', 'private']) },
      SOURCE_FIELD,
    ],
  },
  campus: {
    key: 'campus',
    logType: 'campus',
    table: 'campuses',
    label: 'Campus',
    plural: 'Campuses',
    parent: { entity: 'university', column: 'university_id', inputKey: 'universityId' },
    children: [],
    publicView: null,
    allowUnavailable: false,
    valueColumn: null,
    fields: [
      { name: 'name', column: 'name', label: 'Campus name', kind: 'text', required: true },
      { name: 'city', column: 'city', label: 'City', kind: 'text' },
      { name: 'subRegion', column: 'sub_region', label: 'Sub-region', kind: 'text' },
      { name: 'isMain', column: 'is_main', label: 'Main campus', kind: 'checkbox' },
      SOURCE_FIELD,
    ],
  },
  course: {
    key: 'course',
    logType: 'course',
    table: 'courses',
    label: 'Course',
    plural: 'Courses',
    parent: { entity: 'university', column: 'university_id', inputKey: 'universityId' },
    children: ['course_intake', 'tuition_fee'],
    publicView: 'public_courses',
    allowUnavailable: false,
    valueColumn: null,
    fields: [
      { name: 'name', column: 'name', label: 'Course name', kind: 'text', required: true },
      { name: 'slug', column: 'slug', label: 'URL slug', kind: 'text', required: true },
      { name: 'studyLevel', column: 'study_level', label: 'Study level', kind: 'select', required: true, options: opts(STUDY_LEVELS, (v) => (v === 'UG' ? 'Undergraduate' : 'Postgraduate')) },
      { name: 'qualification', column: 'qualification', label: 'Qualification', kind: 'select', required: true, options: opts(QUALIFICATIONS) },
      { name: 'campusId', column: 'campus_id', label: 'Campus', kind: 'campus' },
      { name: 'durationMonths', column: 'duration_months', label: 'Duration (months)', kind: 'int' },
      { name: 'studyMode', column: 'study_mode', label: 'Study mode', kind: 'select', options: opts(STUDY_MODES) },
      { name: 'teachingLanguage', column: 'teaching_language', label: 'Teaching language', kind: 'text' },
      { name: 'entryRequirements', column: 'entry_requirements', label: 'Entry requirements', kind: 'textarea', help: 'Copy the wording from the source. Do not paraphrase.' },
      { name: 'languageRequirements', column: 'language_requirements', label: 'Language requirements', kind: 'textarea' },
      { name: 'courseUrl', column: 'course_url', label: 'Course page', kind: 'url' },
      SOURCE_FIELD,
    ],
  },
  course_intake: {
    key: 'course_intake',
    logType: 'course_intake',
    table: 'course_intakes',
    label: 'Intake',
    plural: 'Intakes',
    parent: { entity: 'course', column: 'course_id', inputKey: 'courseId' },
    children: [],
    publicView: 'public_course_intakes',
    allowUnavailable: false,
    valueColumn: null,
    fields: [
      { name: 'month', column: 'intake_month', label: 'Intake month', kind: 'select', numeric: true, required: true, options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) },
      { name: 'year', column: 'intake_year', label: 'Intake year', kind: 'int' },
      { name: 'applicationDeadline', column: 'application_deadline', label: 'Application deadline', kind: 'date' },
      SOURCE_FIELD,
    ],
  },
  tuition_fee: {
    key: 'tuition_fee',
    logType: 'tuition_fee',
    table: 'tuition_fees',
    label: 'Tuition fee',
    plural: 'Tuition fees',
    parent: { entity: 'course', column: 'course_id', inputKey: 'courseId' },
    children: [],
    publicView: 'public_tuition_fees',
    allowUnavailable: true,
    valueColumn: 'amount',
    fields: [
      { name: 'category', column: 'fee_category', label: 'Fee category', kind: 'select', required: true, options: opts(FEE_CATEGORIES) },
      { name: 'amount', column: 'amount', label: 'Amount (original currency)', kind: 'decimal', help: 'Leave empty only if the source says the fee is not published.' },
      { name: 'currency', column: 'currency', label: 'Currency', kind: 'select', required: true, options: opts(SUPPORTED_CURRENCIES, (v) => v) },
      { name: 'billingPeriod', column: 'billing_period', label: 'Billing period', kind: 'select', required: true, options: opts(BILLING_PERIODS) },
      { name: 'academicYear', column: 'academic_year', label: 'Academic year', kind: 'text', placeholder: '2026-2027', help: 'A verified fee needs an academic year or a valid-to date.' },
      { name: 'validFrom', column: 'valid_from', label: 'Valid from', kind: 'date' },
      { name: 'validTo', column: 'valid_to', label: 'Valid to', kind: 'date' },
      { name: 'notes', column: 'fee_notes', label: 'Notes', kind: 'textarea' },
      SOURCE_FIELD,
    ],
  },
  acceptance_rate: {
    key: 'acceptance_rate',
    logType: 'acceptance_rate',
    table: 'acceptance_rates',
    label: 'Acceptance rate',
    plural: 'Acceptance rates',
    parent: { entity: 'university', column: 'university_id', inputKey: 'universityId' },
    children: [],
    publicView: 'public_acceptance_rates',
    allowUnavailable: true,
    valueColumn: 'rate_percent',
    fields: [
      { name: 'ratePercent', column: 'rate_percent', label: 'Rate (%)', kind: 'decimal', help: 'Leave empty only if the university does not publish one.' },
      { name: 'definition', column: 'definition', label: 'Definition (as stated by the source)', kind: 'textarea', required: true, help: 'e.g. "Offers divided by completed applications".' },
      { name: 'scope', column: 'applicant_scope', label: 'Applicant scope', kind: 'select', required: true, options: opts(APPLICANT_SCOPES) },
      { name: 'courseId', column: 'course_id', label: 'Course (programme-level rates)', kind: 'course' },
      { name: 'cohortLabel', column: 'cohort_label', label: 'Cohort', kind: 'text', required: true, placeholder: 'Fall 2025 entry' },
      SOURCE_FIELD,
    ],
  },
  university_ranking: {
    key: 'university_ranking',
    logType: 'university_ranking',
    table: 'university_rankings',
    label: 'Ranking',
    plural: 'Rankings',
    parent: { entity: 'university', column: 'university_id', inputKey: 'universityId' },
    children: [],
    publicView: 'public_university_rankings',
    allowUnavailable: false,
    valueColumn: null,
    fields: [
      { name: 'providerId', column: 'provider_id', label: 'Ranking provider', kind: 'ranking_provider', required: true, help: 'Rankings stay hidden until the provider’s reuse rights are confirmed in Settings.' },
      { name: 'year', column: 'ranking_year', label: 'Ranking year', kind: 'int', required: true },
      { name: 'edition', column: 'edition', label: 'Edition', kind: 'text' },
      { name: 'subject', column: 'subject', label: 'Subject (empty = overall)', kind: 'text' },
      { name: 'position', column: 'rank_position', label: 'Exact position', kind: 'int' },
      { name: 'bandLow', column: 'rank_band_low', label: 'Band low', kind: 'int' },
      { name: 'bandHigh', column: 'rank_band_high', label: 'Band high', kind: 'int' },
      SOURCE_FIELD,
    ],
  },
}

export const ENTITY_KEYS = Object.keys(ENTITIES) as EntityKey[]

export function isEntityKey(value: string): value is EntityKey {
  return Object.prototype.hasOwnProperty.call(ENTITIES, value)
}

export const MONTH_NAMES = MONTHS
