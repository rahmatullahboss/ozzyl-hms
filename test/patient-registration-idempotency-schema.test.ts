import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('patient registration idempotency schema', () => {
  test('adds a tenant-scoped durable registration key to patients', () => {
    const migration = readFileSync('migrations/0540_patient_registration_idempotency.sql', 'utf8');
    expect(migration).toContain('ALTER TABLE patients ADD COLUMN registration_idempotency_key TEXT');
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_registration_idempotency/i);
    expect(migration).toMatch(/ON patients\s*\(tenant_id, registration_idempotency_key\)/i);
    expect(migration).toMatch(/WHERE registration_idempotency_key IS NOT NULL/i);

    const drizzleSchema = readFileSync('src/db/schema/schema.ts', 'utf8');
    expect(drizzleSchema).toContain('registrationIdempotencyKey: text("registration_idempotency_key")');
    expect(drizzleSchema).toContain('uniqueIndex("idx_patients_tenant_registration_idempotency")');

    const tenantSchema = readFileSync('tenant-schema.sql', 'utf8');
    expect(tenantSchema).toContain('registration_idempotency_key TEXT');
    expect(tenantSchema).toContain('idx_patients_tenant_registration_idempotency');
  });
});
