import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0421_billing_refund_cash_holds.sql', 'utf8');
const tenantSchema = readFileSync('tenant-schema.sql', 'utf8');
const drizzle = readFileSync('src/db/schema/schema.ts', 'utf8');

describe('billing refund cash hold schema', () => {
  it('creates the durable hold table with lifecycle and uniqueness guards', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS billing_refund_cash_holds');
    expect(migration).toMatch(/status\s+TEXT\s+NOT NULL\s+DEFAULT 'held'/);
    expect(migration).toContain("CHECK (status IN ('held', 'consumed', 'released'))");
    expect(migration).toContain('UNIQUE (tenant_id, approval_request_id)');
    expect(migration).toContain('UNIQUE (tenant_id, idempotency_key)');
    expect(migration).toContain('counter_session_id INTEGER NOT NULL');
    expect(migration).toContain('amount REAL NOT NULL CHECK (amount > 0)');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_hold_bill_held');
    expect(migration).toContain('CREATE TRIGGER IF NOT EXISTS trg_refund_hold_validate_before_insert');
    expect(migration).toContain("RAISE(ABORT, 'insufficient counter cash for refund hold')");
  });

  it('mirrors the table in fresh-install and Drizzle schemas', () => {
    expect(tenantSchema).toContain('CREATE TABLE IF NOT EXISTS billing_refund_cash_holds');
    expect(drizzle).toContain('export const billingRefundCashHolds');
    expect(drizzle).toContain('"billing_refund_cash_holds"');
    expect(drizzle).toContain('uniqueIndex("uq_refund_hold_approval")');
    expect(drizzle).toContain('uniqueIndex("uq_refund_hold_idempotency")');
    expect(tenantSchema).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_hold_bill_held');
    expect(tenantSchema).toContain('CREATE TRIGGER IF NOT EXISTS trg_refund_hold_validate_before_insert');
    expect(drizzle).toContain('uniqueIndex("uq_refund_hold_bill_held")');
  });
});
