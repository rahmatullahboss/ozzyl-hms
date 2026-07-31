import { describe, expect, it } from 'vitest';

const SAMPLE_VALUE = String.fromCharCode(67, 117, 114, 114, 101, 110, 116, 49);

async function loadMigrationModule() {
  return import('../../scripts/lib/staff-password-pbkdf2-migration').catch(() => null);
}

describe('staff password PBKDF2 migration helpers', () => {
  it('provides a validated migration entry parser', async () => {
    const migration = await loadMigrationModule();
    expect(migration).not.toBeNull();
    if (!migration) return;

    expect(migration.parseMigrationEntries(JSON.stringify([
      { userId: 7, tenantId: 102, password: SAMPLE_VALUE },
      { userId: 8, tenantId: null, password: SAMPLE_VALUE },
    ]))).toEqual([
      { userId: 7, tenantId: 102, password: SAMPLE_VALUE },
      { userId: 8, tenantId: null, password: SAMPLE_VALUE },
    ]);

    expect(() => migration.parseMigrationEntries(JSON.stringify([
      { userId: 7, tenantId: 102, password: SAMPLE_VALUE },
      { userId: 7, tenantId: 102, password: SAMPLE_VALUE },
    ]))).toThrow(/duplicate/i);

    expect(() => migration.parseMigrationEntries(JSON.stringify([
      { userId: 0, tenantId: 102, password: SAMPLE_VALUE },
    ]))).toThrow(/userId/i);
  });

  it('builds an atomic update that requires the old hash to match', async () => {
    const migration = await loadMigrationModule();
    expect(migration).not.toBeNull();
    if (!migration) return;

    const sql = migration.buildAtomicPasswordUpdateSql({
      userId: 7,
      tenantId: 102,
      oldHash: "old'hash",
      newHash: "new'hash",
    });

    expect(sql).toContain('UPDATE users');
    expect(sql).toContain('password_hash');
    expect(sql).toContain('id = 7');
    expect(sql).toContain('tenant_id = 102');
    expect(sql).toContain("old''hash");
    expect(sql).toContain("new''hash");
    expect(sql).toContain('AND password_hash =');
  });

  it('builds a lookup scoped by both user and tenant', async () => {
    const migration = await loadMigrationModule();
    expect(migration).not.toBeNull();
    if (!migration) return;

    const sql = migration.buildPasswordLookupSql(9, 101);
    expect(sql).toContain('id = 9');
    expect(sql).toContain('tenant_id = 101');
    expect(sql).toContain('password_hash');
  });

  it('supports platform users whose tenant is null', async () => {
    const migration = await loadMigrationModule();
    expect(migration).not.toBeNull();
    if (!migration) return;

    const lookupSql = migration.buildPasswordLookupSql(109, null);
    expect(lookupSql).toContain('id = 109');
    expect(lookupSql).toContain('tenant_id IS NULL');

    const updateSql = migration.buildAtomicPasswordUpdateSql({
      userId: 109,
      tenantId: null,
      oldHash: 'old-hash',
      newHash: 'new-hash',
    });
    expect(updateSql).toContain('id = 109');
    expect(updateSql).toContain('tenant_id IS NULL');
    expect(updateSql).toContain('AND password_hash =');
  });
});
