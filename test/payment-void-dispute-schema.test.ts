import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0536_executed_pending_payment_void.sql', 'utf8');
const drizzleSchema = readFileSync('src/db/schema/schema.ts', 'utf8');
const tenantSchema = readFileSync('tenant-schema.sql', 'utf8');

describe('executed-pending payment void dispute schema', () => {
  it('defines one tenant-scoped dispute per approval and original payment', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS billing_payment_void_disputes');
    expect(migration).toContain('UNIQUE (tenant_id, approval_request_id)');
    expect(migration).toContain('UNIQUE (tenant_id, payment_id)');
    expect(migration).toContain("status IN ('open','resolved','written_off')");
    expect(migration).toContain('accountable_employee_id INTEGER NOT NULL');
  });

  it('keeps Drizzle and fresh tenant schema aligned with the migration', () => {
    expect(drizzleSchema).toContain('export const billingPaymentVoidDisputes = sqliteTable("billing_payment_void_disputes"');
    expect(drizzleSchema).toContain('uniqueIndex("uq_payment_void_dispute_approval")');
    expect(drizzleSchema).toContain('uniqueIndex("uq_payment_void_dispute_payment")');
    expect(drizzleSchema).toContain("status IN ('open','resolved','written_off')");

    expect(tenantSchema).toContain('CREATE TABLE IF NOT EXISTS billing_payment_void_disputes');
    expect(tenantSchema).toContain('UNIQUE (tenant_id, approval_request_id)');
    expect(tenantSchema).toContain('UNIQUE (tenant_id, payment_id)');
  });
});
