import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { resolveLiveCreditNoteProjection } from '../../src/lib/canonical/live-credit-note-projection';

class QueryStatement implements CanonicalPreparedStatement {
  constructor(private readonly row: Record<string, unknown> | null) {}
  bind(): QueryStatement { return this; }
  async run() { return { success: true, meta: { changes: 0 } }; }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return this.row as T | null; }
}

function database(row: Record<string, unknown> | null): CanonicalBatchDatabase {
  return {
    prepare() { return new QueryStatement(row); },
    async batch() { return []; },
  };
}

const authority = {
  tenantId: '100',
  creditNoteId: 61,
  creditNoteNo: 'CN-61',
  billId: 71,
  billInvoiceNo: 'INV-71',
  reason: 'Approved item return',
  issuedAtUtc: '2026-07-21T02:30:00.000Z',
  cashRefund: 0,
  lines: [
    { invoiceItemId: 801, amount: 300, reason: 'Returned item' },
    { invoiceItemId: 802, amount: 200, reason: 'Cancelled service' },
  ],
};

describe('live credit note projection resolver', () => {
  it('resolves the mapped canonical invoice and deterministic credit lines', async () => {
    const input = await resolveLiveCreditNoteProjection(database({
      canonical_public_id: 'inv-canonical-71',
    }), authority);

    expect(input).toMatchObject({
      tenantId: '100',
      creditNoteNumber: 'CN-61',
      invoicePublicId: 'inv-canonical-71',
      reasonCode: 'Approved item return',
      sourceType: 'legacy_live_credit_note',
      sourcePublicId: 'CN-61',
      sourceTable: 'billing_credit_notes',
      idempotencyKey: 'legacy_live_credit_note:CN-61',
    });
    expect(input.creditNotePublicId).toMatch(/^crnote_/);
    expect(input.outboxEventPublicId).toMatch(/^outevt_/);
    expect(input.lines).toEqual([
      expect.objectContaining({ invoiceLinePublicId: null, amountMinor: 30_000, reasonCode: 'Returned item' }),
      expect.objectContaining({ invoiceLinePublicId: null, amountMinor: 20_000, reasonCode: 'Cancelled service' }),
    ]);
    expect(input.lines[0].creditLinePublicId).toMatch(/^crline_/);
  });

  it('resolves a pre-insert held credit note without a generated legacy row id', async () => {
    const { creditNoteId: _creditNoteId, ...preInsertAuthority } = authority;
    const input = await resolveLiveCreditNoteProjection(database({
      canonical_public_id: 'inv-canonical-held',
    }), preInsertAuthority);

    expect(input.invoicePublicId).toBe('inv-canonical-held');
    expect(input.creditNoteNumber).toBe('CN-61');
  });

  it('rejects cash refunds until reversal and credit are one aggregate command', async () => {
    await expect(resolveLiveCreditNoteProjection(database({
      canonical_public_id: 'inv-canonical-71',
    }), { ...authority, cashRefund: 100 }))
      .rejects.toThrow(/atomic payment reversal and credit note/i);
  });

  it('rejects missing invoice mapping and empty lines', async () => {
    await expect(resolveLiveCreditNoteProjection(database(null), authority))
      .rejects.toThrow(/invoice mapping not found/i);
    await expect(resolveLiveCreditNoteProjection(database({
      canonical_public_id: 'inv-canonical-71',
    }), { ...authority, lines: [] }))
      .rejects.toThrow(/at least one line/i);
  });
});
