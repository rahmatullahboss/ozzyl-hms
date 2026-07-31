import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { resolveLivePaymentReversalProjection } from '../../src/lib/canonical/live-payment-reversal-projection';

class QueryStatement implements CanonicalPreparedStatement {
  constructor(
    readonly sql: string,
    readonly params: unknown[],
    private readonly row: Record<string, unknown> | null,
  ) {}

  bind(...values: unknown[]): QueryStatement {
    return new QueryStatement(this.sql, values, this.row);
  }

  async run() {
    return { success: true, meta: { changes: 0 } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.row as T | null;
  }
}

function database(row: Record<string, unknown> | null): CanonicalBatchDatabase {
  return {
    prepare(sql: string) {
      return new QueryStatement(sql, [], row);
    },
    async batch() {
      return [];
    },
  };
}

const authority = {
  tenantId: '100',
  paymentId: 501,
  billId: 701,
  paymentReceiptNo: 'RCP-501',
  reversalReceiptNo: 'RVR-9001',
  amount: 1250,
  paymentMethod: 'cash',
  reason: 'Approved correction',
  reversedAtUtc: '2026-07-21T01:00:00.000Z',
};

describe('live payment reversal projection resolver', () => {
  it('resolves one mapped receipt, captured tender and active allocation', async () => {
    const input = await resolveLivePaymentReversalProjection(database({
      receipt_public_id: 'payrcpt_abc',
      tender_public_id: 'paytndr_abc',
      allocation_public_id: 'payalloc_abc',
      tender_type: 'cash',
      tender_count: 1,
      allocation_count: 1,
    }), authority);

    expect(input).toMatchObject({
      tenantId: '100',
      receiptPublicId: 'payrcpt_abc',
      tenderPublicId: 'paytndr_abc',
      allocationPublicId: 'payalloc_abc',
      amountMinor: 125_000,
      reasonCode: 'Approved correction',
      sourceType: 'legacy_live_refund',
      sourcePublicId: 'RVR-9001',
      sourceTable: 'payments',
      idempotencyKey: 'legacy_live_refund:RVR-9001',
    });
    expect(input.reversalPublicId).toMatch(/^payrev_/);
    expect(input.refundPublicId).toMatch(/^refund_/);
    expect(input.outboxEventPublicId).toMatch(/^outevt_/);
    expect(input.cashCustodyEventPublicId).toMatch(/^outevt_/);
  });

  it('does not create cash custody evidence for non-cash tenders', async () => {
    const input = await resolveLivePaymentReversalProjection(database({
      receipt_public_id: 'payrcpt_card',
      tender_public_id: 'paytndr_card',
      allocation_public_id: 'payalloc_card',
      tender_type: 'card',
      tender_count: 1,
      allocation_count: 1,
    }), { ...authority, paymentMethod: 'card' });

    expect(input.cashCustodyEventPublicId).toBeNull();
  });

  it('rejects missing canonical payment authority', async () => {
    await expect(resolveLivePaymentReversalProjection(database(null), authority))
      .rejects.toThrow(/mapping not found/i);
  });

  it('rejects ambiguous tenders or allocations before mutation', async () => {
    await expect(resolveLivePaymentReversalProjection(database({
      receipt_public_id: 'payrcpt_abc',
      tender_public_id: 'paytndr_abc',
      allocation_public_id: 'payalloc_abc',
      tender_type: 'cash',
      tender_count: 2,
      allocation_count: 1,
    }), authority)).rejects.toThrow(/exactly one captured tender/i);

    await expect(resolveLivePaymentReversalProjection(database({
      receipt_public_id: 'payrcpt_abc',
      tender_public_id: 'paytndr_abc',
      allocation_public_id: 'payalloc_abc',
      tender_type: 'cash',
      tender_count: 1,
      allocation_count: 2,
    }), authority)).rejects.toThrow(/exactly one active allocation/i);
  });
});
