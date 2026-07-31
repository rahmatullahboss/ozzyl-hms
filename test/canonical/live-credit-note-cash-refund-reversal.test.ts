import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { resolveLiveCreditNoteCashRefundReversal } from '../../src/lib/canonical/live-credit-note-cash-refund-reversal';

class QueryStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly row: Record<string, unknown> | null,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): QueryStatement {
    return new QueryStatement(this.row, values);
  }

  async run(): Promise<never> {
    throw new Error('run is not used by this resolver test');
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.row as T | null;
  }
}

function database(row: Record<string, unknown> | null): CanonicalBatchDatabase {
  return {
    prepare() {
      return new QueryStatement(row);
    },
    async batch() {
      throw new Error('batch is not used by this resolver test');
    },
  };
}

const REFUND = {
  refund_public_id: 'refund-1',
  credit_note_public_id: 'credit-1',
  invoice_public_id: 'invoice-1',
  amount_minor: 40000,
  status: 'posted',
  legacy_counter_id: 7,
  legacy_counter_session_id: 17,
};

describe('resolveLiveCreditNoteCashRefundReversal', () => {
  it('builds deterministic tenant-scoped command identities from an executed approval refund', async () => {
    const input = {
      tenantId: 'tenant-1',
      refundPublicId: 'refund-1',
      approvalRequestId: 55,
      actorUserId: 601,
      reasonCode: 'approval_rejected',
      reversedAtUtc: '2026-07-26T13:00:00.000Z',
      businessDate: '2026-07-26',
    };

    const first = await resolveLiveCreditNoteCashRefundReversal(database(REFUND), input);
    const second = await resolveLiveCreditNoteCashRefundReversal(database(REFUND), input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      tenantId: 'tenant-1',
      refundPublicId: 'refund-1',
      reasonCode: 'approval_rejected',
      reversedAtUtc: '2026-07-26T13:00:00.000Z',
      businessDate: '2026-07-26',
      actorUserId: 601,
      idempotencyKey: 'legacy_live_credit_note_cash_refund_reversal:55',
    });
    expect(first.reversalPublicId).toMatch(/^crfrv_[0-9A-Z]{26}$/);
    expect(first.outboxEventPublicId).toMatch(/^outevt_[0-9A-Z]{26}$/);
    expect(first.recoveryRequiredEventPublicId).toMatch(/^outevt_[0-9A-Z]{26}$/);
    expect(first.sourceEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when canonical refund authority is absent or no longer posted', async () => {
    const base = {
      tenantId: 'tenant-1',
      refundPublicId: 'refund-1',
      approvalRequestId: 55,
      actorUserId: 601,
      reasonCode: 'approval_rejected',
      reversedAtUtc: '2026-07-26T13:00:00.000Z',
      businessDate: '2026-07-26',
    };

    await expect(resolveLiveCreditNoteCashRefundReversal(database(null), base))
      .rejects.toThrow(/not found/i);
    await expect(resolveLiveCreditNoteCashRefundReversal(database({ ...REFUND, status: 'reversed' }), base))
      .rejects.toThrow(/not posted|already reversed/i);
  });
});
