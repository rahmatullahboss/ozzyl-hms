import { describe, expect, it } from 'vitest';
import {
  buildFinancialReconciliation,
} from '../../src/lib/dashboard/reconciliation';

describe('financial reconciliation contract', () => {
  const checkedAt = '2026-07-27T12:00:00.000Z';

  it('marks exact and sub-cent differences as reconciled', () => {
    expect(buildFinancialReconciliation({
      summaryTotal: 1000,
      detailTotal: 1000,
      detailRowCount: 4,
      detailGrain: 'one row per payment',
      checkedAt,
    })).toMatchObject({
      status: 'reconciled',
      unexplainedDifference: 0,
      detailGrain: 'one row per payment',
      warnings: [],
    });

    expect(buildFinancialReconciliation({
      summaryTotal: 100,
      detailTotal: 99.999999,
      detailRowCount: 1,
      detailGrain: 'one row per payment',
      checkedAt,
    }).status).toBe('reconciled');
  });

  it('returns warning with the exact unexplained difference', () => {
    expect(buildFinancialReconciliation({
      summaryTotal: 1000,
      detailTotal: 990,
      detailRowCount: 9,
      detailGrain: 'one row per invoice',
      checkedAt,
    })).toMatchObject({
      status: 'warning',
      unexplainedDifference: 10,
      warnings: ['Summary and detail totals differ by BDT 10.00.'],
    });
  });

  it('returns unavailable instead of pretending missing detail balances', () => {
    expect(buildFinancialReconciliation({
      summaryTotal: 1000,
      detailTotal: null,
      detailRowCount: 0,
      detailGrain: 'one row per settlement',
      checkedAt,
      unavailableReason: 'Settlement allocation source unavailable.',
    })).toMatchObject({
      status: 'unavailable',
      detailTotal: null,
      unexplainedDifference: null,
      isBalanced: null,
      warnings: ['Settlement allocation source unavailable.'],
    });
  });

  it('treats an empty zero result as reconciled', () => {
    expect(buildFinancialReconciliation({
      summaryTotal: 0,
      detailTotal: 0,
      detailRowCount: 0,
      detailGrain: 'one row per invoice',
      checkedAt,
    })).toMatchObject({
      status: 'reconciled',
      detailRowCount: 0,
      isBalanced: true,
    });
  });

  it('preserves provider mode and checked timestamp from the base contract', () => {
    expect(buildFinancialReconciliation({
      summaryTotal: 500,
      detailTotal: 500,
      detailRowCount: 2,
      detailGrain: 'one row per canonical posting',
      providerMode: 'canonical_preferred',
      checkedAt,
    })).toMatchObject({
      providerMode: 'canonical_preferred',
      checkedAt,
    });
  });
});
