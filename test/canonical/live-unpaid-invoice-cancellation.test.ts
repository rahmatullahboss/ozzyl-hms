import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { resolveLiveUnpaidInvoiceCancellationProjection } from '../../src/lib/canonical/live-unpaid-invoice-cancellation';

class QueryStatement implements CanonicalPreparedStatement {
  constructor(
    readonly sql: string,
    readonly params: unknown[],
    private readonly rows: Record<string, unknown>[],
  ) {}

  bind(...values: unknown[]): QueryStatement {
    return new QueryStatement(this.sql, values, this.rows);
  }

  async run() {
    return { success: true, meta: { changes: 0 } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.rows[0] as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.rows as T[] };
  }
}

function database(rows: Record<string, unknown>[]): CanonicalBatchDatabase {
  return {
    prepare(sql: string) {
      return new QueryStatement(sql, [], rows);
    },
    async batch() {
      return [];
    },
  };
}

const authority = {
  tenantId: '100',
  legacyBillId: 6917,
  invoiceNumber: 'INV-A-2026-000037',
  totalAmount: 400,
  paidAmount: 0,
  reasonCode: 'approved_unpaid_bill_cancellation',
  cancelledAtUtc: '2026-07-23T05:00:00.000Z',
};

describe('live unpaid invoice cancellation projection', () => {
  it('prefers the live invoice mapping and builds stable command evidence', async () => {
    const rows = [
      {
        canonical_public_id: 'invoice-live',
        invoice_number: authority.invoiceNumber,
        source_type: 'legacy_live_bill',
        total_minor: 40000,
        paid_minor: 0,
      },
      {
        canonical_public_id: 'invoice-live',
        invoice_number: authority.invoiceNumber,
        source_type: 'legacy_bill',
        total_minor: 40000,
        paid_minor: 0,
      },
    ];

    const first = await resolveLiveUnpaidInvoiceCancellationProjection(database(rows), authority);
    const second = await resolveLiveUnpaidInvoiceCancellationProjection(database(rows), authority);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      tenantId: '100',
      invoicePublicId: 'invoice-live',
      reasonCode: 'approved_unpaid_bill_cancellation',
      sourceType: 'legacy_bill_cancellation',
      sourcePublicId: '6917',
      sourceTable: 'bills',
      idempotencyKey: 'canonical:invoice-cancel:6917',
      businessDate: '2026-07-23',
    });
    expect(first.sourceEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.outboxEventPublicId).toMatch(/^outevt_/);
  });

  it('falls back to the numeric legacy bill mapping', async () => {
    const resolved = await resolveLiveUnpaidInvoiceCancellationProjection(database([{
      canonical_public_id: 'invoice-fallback',
      invoice_number: authority.invoiceNumber,
      source_type: 'legacy_bill',
      total_minor: 40000,
      paid_minor: 0,
    }]), authority);

    expect(resolved.invoicePublicId).toBe('invoice-fallback');
  });

  it('changes source evidence when immutable source totals change', async () => {
    const rows = [{
      canonical_public_id: 'invoice-live',
      invoice_number: authority.invoiceNumber,
      source_type: 'legacy_live_bill',
      total_minor: 40000,
      paid_minor: 0,
    }];
    const original = await resolveLiveUnpaidInvoiceCancellationProjection(database(rows), authority);
    const changed = await resolveLiveUnpaidInvoiceCancellationProjection(database([{
      ...rows[0],
      total_minor: 40100,
    }]), {
      ...authority,
      totalAmount: 401,
    });

    expect(changed.sourceEvidenceSha256).not.toBe(original.sourceEvidenceSha256);
  });

  it('rejects paid legacy authority before resolving a mapping', async () => {
    await expect(resolveLiveUnpaidInvoiceCancellationProjection(database([]), {
      ...authority,
      paidAmount: 1,
    })).rejects.toThrow(/must be unpaid/i);
  });

  it('rejects missing, conflicting, or mismatched invoice mappings', async () => {
    await expect(resolveLiveUnpaidInvoiceCancellationProjection(database([]), authority))
      .rejects.toThrow(/mapping not found/i);

    await expect(resolveLiveUnpaidInvoiceCancellationProjection(database([
      {
        canonical_public_id: 'invoice-a',
        invoice_number: authority.invoiceNumber,
        source_type: 'legacy_live_bill',
        total_minor: 40000,
        paid_minor: 0,
      },
      {
        canonical_public_id: 'invoice-b',
        invoice_number: authority.invoiceNumber,
        source_type: 'legacy_bill',
        total_minor: 40000,
        paid_minor: 0,
      },
    ]), authority)).rejects.toThrow(/conflicting/i);

    await expect(resolveLiveUnpaidInvoiceCancellationProjection(database([{
      canonical_public_id: 'invoice-live',
      invoice_number: 'INV-DIFFERENT',
      source_type: 'legacy_live_bill',
      total_minor: 40000,
      paid_minor: 0,
    }]), authority)).rejects.toThrow(/invoice number/i);
  });
});
