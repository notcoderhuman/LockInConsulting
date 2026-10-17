import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REQUIRED_MIGRATIONS } from '@/lib/db/schema-version'
import { classifyVersion, redactGrant } from '../scripts/db-capabilities.mjs'

describe('schema version gate', () => {
  it('requires exactly the migrations shipped in db/migrations', () => {
    const files = readdirSync(path.join(__dirname, '..', 'db', 'migrations'))
      .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
      .sort()
    expect([...REQUIRED_MIGRATIONS]).toEqual(files)
  })
})

describe('database engine classification', () => {
  it.each([
    ['8.4.9', 'MySQL 8.4.9', true, true],
    ['8.0.19', 'MySQL 8.0.19', true, false],
    ['8.0.15', 'MySQL 8.0.15', false, false],
    ['5.7.44-log', 'MySQL 5.7.44', false, false],
    ['10.5.29-MariaDB', 'MariaDB 10.5.29', true, true],
    ['11.8.3-MariaDB-log', 'MariaDB 11.8.3', true, false],
    ['10.4.34-MariaDB', 'MariaDB 10.4.34', false, false],
  ])('%s', (raw, label, supported, tested) => {
    expect(classifyVersion(raw)).toMatchObject({ label, supported, tested })
  })

  it('redacts password hashes from SHOW GRANTS output', () => {
    expect(redactGrant("GRANT USAGE ON *.* TO `u`@`h` IDENTIFIED BY PASSWORD '*E53A440CDD24'")).not.toContain('E53A440CDD24')
    expect(redactGrant("GRANT USAGE ON *.* TO `u`@`h` IDENTIFIED VIA mysql_native_password USING '*ABCDEF'")).not.toContain('ABCDEF')
  })
})
