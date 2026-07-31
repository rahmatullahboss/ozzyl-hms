import { describe, expect, it } from 'vitest';
import { applyCanonicalReceivableAdjustment } from '../../src/services/billing/receivableAdjustment/canonicalCreditNote';
import {
  baseAdjustmentInput,
  createReceivableAdjustmentHarness,
  seedCanonicalInvoice,
} from './receivable-adjustment-harness';

function scalar(sqlite: ReturnType<typeof createReceivableAdjustmentHarness>['sqlite'], sql: string): number {
  return Number((sqlite.prepare(sql).get() as { value: number }).value);
}

describe('canonical receivable adjustment', () => {
  it('posts immutable credit-note evidence and guarded net-due projection without rewriting invoice total', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedCanonicalInvoice(sqlite);

    const result = await applyCanonicalReceivableAdjustment(baseAdjustmentInput(db, {
      source: { sourceType: 'invoice', canonicalInvoicePublicId: 'inv-public-77' },
    }) as never);

    expect(result).toMatchObject({
      authorityMode: 'canonical',
      previousDueMinor: 8000,
      newDueMinor: 5000,
      appliedAmountMinor: 3000,
      currencyCode: 'BDT',
      canonicalCreditNotePublicId: expect.any(String),
    });
    expect(sqlite.prepare(`
      SELECT total_minor, paid_minor, due_minor, credited_minor, net_due_minor
      FROM canonical_invoices
      WHERE tenant_id='tenant-a' AND invoice_public_id='inv-public-77'
    `).get()).toEqual({
      total_minor: 10000,
      paid_minor: 2000,
      due_minor: 8000,
      credited_minor: 3000,
      net_due_minor: 5000,
    });
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM canonical_credit_notes')).toBe(1);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM canonical_credit_note_lines')).toBe(1);
    expect(scalar(sqlite, `SELECT COUNT(*) value FROM canonical_outbox_events WHERE event_type='canonical.credit_note.posted'`)).toBe(1);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);
  });

  it('rejects terminal, over-due, currency, missing-source, and cross-tenant adjustments', async () => {
    const terminal = createReceivableAdjustmentHarness();
    seedCanonicalInvoice(terminal.sqlite, { status: 'reversed' });
    await expect(applyCanonicalReceivableAdjustment(baseAdjustmentInput(terminal.db, {
      source: { sourceType: 'invoice', canonicalInvoicePublicId: 'inv-public-77' },
    }) as never)).rejects.toThrow(/posted|open|reversed/i);

    const overDue = createReceivableAdjustmentHarness();
    seedCanonicalInvoice(overDue.sqlite);
    await expect(applyCanonicalReceivableAdjustment(baseAdjustmentInput(overDue.db, {
      source: { sourceType: 'invoice', canonicalInvoicePublicId: 'inv-public-77' },
      amountMinor: 8001,
    }) as never)).rejects.toThrow(/exceeds.*due|outstanding/i);

    const currency = createReceivableAdjustmentHarness();
    seedCanonicalInvoice(currency.sqlite);
    await expect(applyCanonicalReceivableAdjustment(baseAdjustmentInput(currency.db, {
      source: { sourceType: 'invoice', canonicalInvoicePublicId: 'inv-public-77' },
      currencyCode: 'USD',
    }) as never)).rejects.toThrow(/currency/i);

    const missing = createReceivableAdjustmentHarness();
    await expect(applyCanonicalReceivableAdjustment(baseAdjustmentInput(missing.db, {
      source: { sourceType: 'invoice', canonicalInvoicePublicId: 'missing' },
    }) as never)).rejects.toThrow(/not found/i);

    const tenant = createReceivableAdjustmentHarness();
    seedCanonicalInvoice(tenant.sqlite, { tenantId: 'tenant-b' });
    await expect(applyCanonicalReceivableAdjustment(baseAdjustmentInput(tenant.db, {
      source: { sourceType: 'invoice', canonicalInvoicePublicId: 'inv-public-77' },
    }) as never)).rejects.toThrow(/not found/i);
  });

  it('rejects a canonical invoice paired with a different legacy bill mapping', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedCanonicalInvoice(sqlite, { legacyBillId: 88 });

    await expect(applyCanonicalReceivableAdjustment(baseAdjustmentInput(db, {
      source: {
        sourceType: 'invoice',
        legacyBillId: 77,
        canonicalInvoicePublicId: 'inv-public-77',
      },
    }) as never)).rejects.toThrow(/mapping|legacy bill|source/i);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM canonical_credit_notes')).toBe(0);
  });

  it('returns the original canonical result for the same idempotency key', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedCanonicalInvoice(sqlite);
    const input = baseAdjustmentInput(db, {
      source: { sourceType: 'invoice', canonicalInvoicePublicId: 'inv-public-77' },
    });

    const first = await applyCanonicalReceivableAdjustment(input as never);
    const second = await applyCanonicalReceivableAdjustment(input as never);

    expect(second).toEqual(first);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM canonical_credit_notes')).toBe(1);
    expect(scalar(sqlite, 'SELECT COUNT(*) value FROM canonical_credit_note_lines')).toBe(1);
  });
});
