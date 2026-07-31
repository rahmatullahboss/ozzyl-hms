import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL('../migrations/0357_ipd_doctor_round_fees.sql', import.meta.url);
const guardMigrationPath = new URL('../migrations/0358_ipd_doctor_round_guards.sql', import.meta.url);
const tenantSchemaPath = new URL('../tenant-schema.sql', import.meta.url);
const drizzleSchemaPath = new URL('../src/db/schema/schema.ts', import.meta.url);

function readIfPresent(path: URL): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('IPD doctor round schema', () => {
  it('adds doctor fee and tenant-scoped idempotent round storage', () => {
    const migration = readIfPresent(migrationPath);

    expect(migration).toContain(
      'ALTER TABLE doctors ADD COLUMN ipd_round_fee INTEGER NOT NULL DEFAULT 0',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS ipd_doctor_rounds');
    expect(migration).toMatch(/idempotency_key\s+TEXT\s+NOT NULL/i);
    expect(migration).toMatch(/UNIQUE\s*\(tenant_id, idempotency_key\)/i);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]+provisional_item_id[\s\S]+WHERE provisional_item_id IS NOT NULL/i,
    );
    expect(migration).toContain('idx_ipd_doctor_rounds_admission_time');
    expect(migration).toContain('idx_ipd_doctor_rounds_doctor_time');
  });

  it('adds runtime guards for doctor-round provisional billing rows', () => {
    const guardMigration = readIfPresent(guardMigrationPath);

    expect(guardMigration).toContain('idx_billing_provisional_doctor_round_ref');
    expect(guardMigration).toContain('trg_doctor_round_provisional_cancel_requires_round');
    expect(guardMigration).toContain('Cancel doctor rounds through the doctor-round cancellation workflow');
  });

  it('keeps the fresh local schema and Drizzle declarations in parity', () => {
    const tenantSchema = readFileSync(tenantSchemaPath, 'utf8');
    const drizzleSchema = readFileSync(drizzleSchemaPath, 'utf8');

    expect(tenantSchema).toContain(
      'ALTER TABLE doctors ADD COLUMN ipd_round_fee INTEGER NOT NULL DEFAULT 0',
    );
    expect(tenantSchema).toContain('CREATE TABLE IF NOT EXISTS ipd_doctor_rounds');
    expect(tenantSchema).toMatch(/UNIQUE\s*\(tenant_id, idempotency_key\)/i);
    expect(tenantSchema).toContain('idx_billing_provisional_doctor_round_ref');
    expect(tenantSchema).toContain('trg_doctor_round_provisional_cancel_requires_round');
    expect(drizzleSchema).toContain('export const ipdDoctorRounds');
    expect(drizzleSchema).toContain('idempotencyKey: text("idempotency_key").notNull()');
  });
});
