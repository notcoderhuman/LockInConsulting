import { describe, expect, it } from 'vitest'
import { canonicalJson, computeRowHash, GENESIS_HASH } from '@/lib/admin/audit'
import { getAdminConfigStatus } from '@/lib/admin/config'
import { ENTITIES, ENTITY_KEYS, isEntityKey } from '@/lib/admin/entities'
import { parseEntityForm } from '@/lib/admin/forms'
import { actorCan, ADMIN_ROLES, can, type Permission } from '@/lib/admin/roles'
import { availableActions } from '@/lib/admin/workflow'

const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

describe('role permissions', () => {
  const matrix: Record<Permission, Record<(typeof ADMIN_ROLES)[number], boolean>> = {
    'data.read': { editor: true, reviewer: true, owner: true },
    'data.capture': { editor: true, reviewer: true, owner: true },
    'data.review': { editor: false, reviewer: true, owner: true },
    'rights.manage': { editor: false, reviewer: false, owner: true },
    'members.read': { editor: false, reviewer: false, owner: true },
    'support.read': { editor: false, reviewer: true, owner: true },
    'support.reply': { editor: false, reviewer: true, owner: true },
    'support.review_ai': { editor: false, reviewer: true, owner: true },
    'students.read': { editor: false, reviewer: true, owner: true },
    'members.manage': { editor: false, reviewer: false, owner: true },
    'support.settings': { editor: false, reviewer: false, owner: true },
    'students.erase': { editor: false, reviewer: false, owner: true },
  }
  it.each(Object.entries(matrix))('%s', (permission, expected) => {
    for (const role of ADMIN_ROLES) expect(can(role, permission as Permission)).toBe(expected[role])
  })
  it('lets an owner delegate only reading and replying to an individual editor', () => {
    const editor = { role: 'editor' as const, supportEnabled: true }
    expect(actorCan(editor, 'support.read')).toBe(true)
    expect(actorCan(editor, 'support.reply')).toBe(true)
    for (const p of ['support.review_ai', 'students.read', 'members.manage', 'support.settings', 'students.erase', 'data.review'] as Permission[])
      expect(actorCan(editor, p)).toBe(false)
    expect(actorCan({ role: 'editor', supportEnabled: false }, 'support.read')).toBe(false)
    expect(actorCan({ role: 'editor' }, 'support.read')).toBe(false)
    // The flag means nothing for a reviewer: it can neither add nor remove role permissions.
    expect(actorCan({ role: 'reviewer', supportEnabled: false }, 'support.review_ai')).toBe(true)
    expect(actorCan({ role: 'reviewer', supportEnabled: true }, 'support.settings')).toBe(false)
    expect(actorCan(null, 'support.read')).toBe(false)
  })
  it('grants nothing to missing or unknown roles', () => {
    expect(can(null, 'data.read')).toBe(false)
    expect(can(undefined, 'data.read')).toBe(false)
    expect(can('admin' as never, 'data.read')).toBe(false)
  })
})

describe('admin configuration fails closed', () => {
  const good = {
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'mysql://u:p@h/db',
    BETTER_AUTH_URL: 'https://lockin.example',
    NODE_ENV: 'production',
  }
  it('accepts a complete production configuration', () => {
    expect(getAdminConfigStatus(good)).toEqual({ ok: true, baseURL: 'https://lockin.example' })
  })
  it.each([
    ['no secret', { BETTER_AUTH_SECRET: undefined }],
    ['short secret', { BETTER_AUTH_SECRET: 'too-short' }],
    ['no database', { DATABASE_URL: undefined }],
    ['no base URL', { BETTER_AUTH_URL: undefined }],
    ['http base URL in production', { BETTER_AUTH_URL: 'http://lockin.example' }],
    ['kill switch', { ADMIN_DISABLED: 'true' }],
  ])('rejects %s', (_label, override) => {
    expect(getAdminConfigStatus({ ...good, ...override }).ok).toBe(false)
  })
  it('allows http only for localhost', () => {
    expect(getAdminConfigStatus({ ...good, BETTER_AUTH_URL: 'http://localhost:3210' }).ok).toBe(true)
  })
})

describe('audit hashing', () => {
  const entry = {
    entityType: 'university' as const,
    entityId: 7,
    action: 'publish' as const,
    actorId: 'u1',
    actorRole: 'reviewer' as const,
    reason: null,
    before: { b: 1, a: 'x' },
    after: { a: 'x', b: 2 },
  }
  it('serialises keys in a stable order', () => {
    expect(canonicalJson({ b: 1, a: { d: null, c: [2, 1] } })).toBe('{"a":{"c":[2,1],"d":null},"b":1}')
  })
  it('is deterministic and sensitive to every field and to the previous hash', () => {
    const h = computeRowHash(GENESIS_HASH, entry, '2026-10-15 10:00:00.000')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(computeRowHash(GENESIS_HASH, { ...entry, before: { a: 'x', b: 1 } }, '2026-10-15 10:00:00.000')).toBe(h)
    expect(computeRowHash(GENESIS_HASH, { ...entry, reason: 'x' }, '2026-10-15 10:00:00.000')).not.toBe(h)
    expect(computeRowHash(GENESIS_HASH, entry, '2026-10-15 10:00:00.001')).not.toBe(h)
    expect(computeRowHash('f'.repeat(64), entry, '2026-10-15 10:00:00.000')).not.toBe(h)
  })
})

describe('entity forms', () => {
  it('only maps whitelisted columns, ignoring injected form fields', () => {
    const r = parseEntityForm('university', form({ name: 'U', slug: 'u', destinationIso2: 'DE', publication_status: 'published', 'id; DROP': 'x' }), null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Object.keys(r.row).sort()).toEqual(ENTITIES.university.fields.map((f) => f.column).sort())
      expect(r.row).not.toHaveProperty('publication_status')
    }
  })
  it('reports field errors from the shared zod schemas', () => {
    const r = parseEntityForm('course', form({ name: 'X', slug: 'x', studyLevel: 'UG', qualification: 'doctorate' }), 1)
    expect(r).toMatchObject({ ok: false, fieldErrors: { qualification: expect.any(Array) } })
    const bad = parseEntityForm('university', form({ name: 'U', slug: 'u', destinationIso2: 'FR', officialWebsite: 'http://x' }), null)
    expect(bad).toMatchObject({ ok: false, fieldErrors: { destinationIso2: expect.any(Array), officialWebsite: expect.any(Array) } })
  })
  it('rejects non-numeric ids', () => {
    const r = parseEntityForm('university', form({ name: 'U', slug: 'u', destinationIso2: 'DE', sourceId: '1 OR 1=1' }), null)
    expect(r).toMatchObject({ ok: false, fieldErrors: { sourceId: expect.any(Array) } })
  })
  it('has a known entity key per registry entry and rejects prototype keys', () => {
    for (const k of ENTITY_KEYS) expect(isEntityKey(k)).toBe(true)
    expect(isEntityKey('constructor')).toBe(false)
  })
})

describe('workflow buttons', () => {
  it('offer reviewer actions only to reviewers and owners', () => {
    expect(availableActions({ publication_status: 'in_review' }, 'editor')).toEqual([])
    expect(availableActions({ publication_status: 'in_review' }, 'reviewer')).toEqual(['verify', 'publish', 'return_to_draft'])
    expect(availableActions({ publication_status: 'draft' }, 'editor')).toEqual(['submit_for_review'])
    expect(availableActions({ publication_status: 'published' }, 'owner')).toEqual(['verify', 'unpublish'])
  })
})
