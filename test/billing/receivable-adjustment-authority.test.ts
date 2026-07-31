import { describe, expect, it } from 'vitest';
import { applyReceivableAdjustment } from '../../src/services/billing/receivableAdjustment/authority';
import { getTodayGMT6 } from '../../src/lib/date-utils';
import {
  baseAdjustmentInput,
  createReceivableAdjustmentHarness,
  seedCanonicalInvoice,
  seedLegacyBill,
  setReceivableMode,
} from './receivable-adjustment-harness';

function scalar(sqlite: ReturnType<typeof createReceivableAdjustmentHarness>['sqlite'], sql: string): number {
  return Number((sqlite.prepare(sql).get() as { value: number }).value);
}

describe('receivable adjustment authority', () => {
  it('routes legacy authority and returns the original successful result on replay', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedLegacyBill(sqlite);
    setReceivableMode(sqlite, 'legacy');
    const input = baseAdjustmentInput(db);

    const first = await applyReceivableAdjustment(input as never);
    const second = await applyReceivableAdjustment(input as never);

    expect(first).toMatchObject({ authorityMode: 'legacy', previousDueMinor: 8000, newDueMinor: 5000 });
    expect(second).toEqual(first);
    await expect(applyReceivableAdjustment(baseAdjustmentInput(db, {
      amountMinor: 2000,
    }) as never)).rejects.toThrow(/different receivable adjustment/i);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(1);
    expect(scalar(sqlite, `SELECT COUNT(*) value FROM billing_mutation_idempotency_keys WHERE status='completed'`)).toBe(1);
  });

  it('rejects a mismatched legacy and canonical source pair before reserving mutation state', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedLegacyBill(sqlite);
    seedCanonicalInvoice(sqlite, { legacyBillId: 88 });
    setReceivableMode(sqlite, 'legacy');

    await expect(applyReceivableAdjustment(baseAdjustmentInput(db, {
      source: {
        sourceType: 'invoice',
        legacyBillId: 77,
        canonicalInvoicePublicId: 'inv-public-77',
      },
    }) as never)).rejects.toThrow(/not found.*active authority|source/i);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM billing_mutation_idempotency_keys')).toBe(0);
  });

  it('uses canonical authority without mutating the legacy invoice', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedLegacyBill(sqlite);
    seedCanonicalInvoice(sqlite, { legacyBillId: 77 });
    setReceivableMode(sqlite, 'canonical');

    const result = await applyReceivableAdjustment(baseAdjustmentInput(db) as never);

    expect(result).toMatchObject({ authorityMode: 'canonical', previousDueMinor: 8000, newDueMinor: 5000 });
    expect(sqlite.prepare(`SELECT total, paid, due FROM bills WHERE tenant_id='tenant-a' AND id=77`).get())
      .toEqual({ total: 100, paid: 20, due: 80 });
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM canonical_credit_notes')).toBe(1);
  });

  it('keeps legacy authority in shadow mode while recording canonical evidence', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedLegacyBill(sqlite);
    seedCanonicalInvoice(sqlite, { legacyBillId: 77 });
    setReceivableMode(sqlite, 'shadow');

    const result = await applyReceivableAdjustment(baseAdjustmentInput(db, {
      source: {
        sourceType: 'invoice',
        legacyBillId: 77,
        canonicalInvoicePublicId: 'inv-public-77',
      },
    }) as never);

    expect(result).toMatchObject({ authorityMode: 'shadow', previousDueMinor: 8000, newDueMinor: 5000 });
    expect(sqlite.prepare(`SELECT total, paid, due FROM bills WHERE tenant_id='tenant-a' AND id=77`).get())
      .toEqual({ total: 70, paid: 20, due: 50 });
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(1);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM canonical_credit_notes')).toBe(1);
  });

  it('does not roll back the legacy shadow result when canonical evidence fails', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedLegacyBill(sqlite);
    seedCanonicalInvoice(sqlite, { legacyBillId: 77, status: 'reversed' });
    setReceivableMode(sqlite, 'shadow');

    const result = await applyReceivableAdjustment(baseAdjustmentInput(db, {
      source: {
        sourceType: 'invoice',
        legacyBillId: 77,
        canonicalInvoicePublicId: 'inv-public-77',
      },
    }) as never);

    expect(result).toMatchObject({ authorityMode: 'shadow', previousDueMinor: 8000, newDueMinor: 5000 });
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(1);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM canonical_credit_notes')).toBe(0);
    expect(scalar(sqlite, `SELECT COUNT(*) value FROM canonical_processing_issues WHERE issue_code='RECEIVABLE_ADJUSTMENT_SHADOW_FAILED'`)).toBe(1);
  });

  it('blocks new adjustments in a closed accounting period without creating financial evidence', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedLegacyBill(sqlite);
    setReceivableMode(sqlite, 'legacy');
    const today = getTodayGMT6();
    const period = today.slice(0, 7);
    sqlite.prepare(`
      INSERT INTO fiscal_years (tenant_id, start_date, end_date, is_active, is_closed)
      VALUES ('tenant-a', '2026-01-01', '2026-12-31', 1, 0)
    `).run();
    sqlite.prepare(`
      INSERT INTO accounting_period_closes (tenant_id, fiscal_year_id, period_name, status)
      VALUES ('tenant-a', 1, ?, 'closed')
    `).run(period);

    const input = baseAdjustmentInput(db);
    await expect(applyReceivableAdjustment(input as never))
      .rejects.toThrow(/accounting period.*closed/i);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM accounting_posting_events')).toBe(0);

    sqlite.prepare(`DELETE FROM accounting_period_closes WHERE tenant_id='tenant-a'`).run();
    await expect(applyReceivableAdjustment(input as never)).resolves.toMatchObject({
      authorityMode: 'legacy',
      newDueMinor: 5000,
    });
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(1);
  });

  it('fails closed for unavailable canonical authority and validates all money/source inputs', async () => {
    const unavailable = createReceivableAdjustmentHarness({ canonical: false });
    unavailable.sqlite.exec(`
      CREATE TABLE canonical_feature_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        flag_key TEXT NOT NULL,
        domain TEXT NOT NULL,
        mode TEXT NOT NULL,
        is_enabled INTEGER NOT NULL,
        UNIQUE(tenant_id, flag_key)
      );
    `);
    unavailable.sqlite.prepare(`
      INSERT INTO canonical_feature_flags (tenant_id, flag_key, domain, mode, is_enabled)
      VALUES ('tenant-a', 'billing.receivables', 'billing', 'canonical', 1)
    `).run();
    seedLegacyBill(unavailable.sqlite);
    await expect(applyReceivableAdjustment(baseAdjustmentInput(unavailable.db) as never))
      .rejects.toMatchObject({ name: 'ReceivableAuthorityConfigurationError' });

    const validation = createReceivableAdjustmentHarness();
    seedLegacyBill(validation.sqlite);
    for (const overrides of [
      { amountMinor: 0 },
      { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
      { currencyCode: 'bdt' },
      { reasonCode: ' ' },
      { actorId: 0 },
      { sourceRequestId: 0 },
      { idempotencyKey: ' ' },
      { source: { sourceType: 'invoice' } },
    ]) {
      await expect(applyReceivableAdjustment(baseAdjustmentInput(validation.db, overrides) as never)).rejects.toThrow();
    }
    expect(scalar(validation.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);
  });
});
