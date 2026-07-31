import { describe, expect, it } from 'vitest';
import { buildDashboardReconciliation } from '../../src/lib/dashboard/reconciliation';

describe('admin dashboard reconciliation', () => {
  const checkedAt = '2026-07-27T12:00:00.000Z';

  it('marks exact totals as balanced', () => {
    expect(buildDashboardReconciliation({
      summaryTotal: 1000,
      detailTotal: 1000,
      detailRowCount: 4,
      checkedAt,
    })).toMatchObject({
      unexplainedDifference: 0,
      isBalanced: true,
      detailRowCount: 4,
    });
  });

  it('normalizes sub-cent floating noise within tolerance', () => {
    const result = buildDashboardReconciliation({
      summaryTotal: 100,
      detailTotal: 99.999999,
      detailRowCount: 2,
      checkedAt,
    });

    expect(result.unexplainedDifference).toBe(0);
    expect(result.isBalanced).toBe(true);
  });

  it('exposes a non-zero unexplained difference', () => {
    const result = buildDashboardReconciliation({
      summaryTotal: 1000,
      detailTotal: 990,
      detailRowCount: 9,
      checkedAt,
    });

    expect(result.unexplainedDifference).toBe(10);
    expect(result.isBalanced).toBe(false);
  });

  it('represents unavailable detail totals without pretending they balance', () => {
    expect(buildDashboardReconciliation({
      summaryTotal: 1000,
      detailTotal: null,
      detailRowCount: 0,
      checkedAt,
    })).toMatchObject({
      detailTotal: null,
      unexplainedDifference: null,
      isBalanced: null,
    });
  });

  it('uses the full matching row count and total independently of page size', () => {
    const result = buildDashboardReconciliation({
      summaryTotal: 2500,
      detailTotal: 2500,
      detailRowCount: 125,
      currentPageRowCount: 25,
      checkedAt,
      providerMode: 'canonical_preferred',
    });

    expect(result.detailRowCount).toBe(125);
    expect(result).not.toHaveProperty('currentPageRowCount');
    expect(result.providerMode).toBe('canonical_preferred');
  });
});
