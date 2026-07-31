import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('MFA registration schema repair', () => {
  it('adds an idempotent forward migration without replaying the users column alteration', () => {
    const sql = read('migrations/0553_mfa_registration_schema_repair.sql');

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+mfa_registrations/i);
    expect(sql).toMatch(/tenant_id\s+TEXT\s+NOT NULL/i);
    expect(sql).toMatch(/user_id\s+INTEGER\s+NOT NULL/i);
    expect(sql).toMatch(/mfa_type\s+TEXT\s+NOT NULL\s+DEFAULT\s+'totp'/i);
    expect(sql).toMatch(/secret\s+TEXT\s+NOT NULL/i);
    expect(sql).toMatch(/recovery_codes\s+TEXT/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS\s+idx_mfa_user/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS\s+idx_mfa_tenant/i);
    expect(sql).not.toMatch(/ALTER TABLE\s+users\s+ADD COLUMN\s+mfa_enabled/i);
  });

  it('keeps fresh-install SQL and Drizzle schema aligned with the repaired table', () => {
    const tenantSchema = read('tenant-schema.sql');
    const drizzleSchema = read('src/db/schema/schema.ts');

    expect(tenantSchema).toMatch(/CREATE TABLE IF NOT EXISTS\s+mfa_registrations/i);
    expect(tenantSchema).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS\s+idx_mfa_user/i);
    expect(drizzleSchema).toMatch(/export const mfaRegistrations\s*=\s*sqliteTable\("mfa_registrations"/);
    expect(drizzleSchema).toMatch(/uniqueIndex\("idx_mfa_user"\)/);
    expect(drizzleSchema).toMatch(/index\("idx_mfa_tenant"\)/);
  });
});
