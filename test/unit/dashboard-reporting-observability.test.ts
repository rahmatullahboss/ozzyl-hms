import { describe, expect, it, vi } from 'vitest';
import { observeDashboardReconciliation } from '../../src/services/dashboard/reportingObservability';

const baseReconciliation = {
  summaryTotal: 1_000,
  detailTotal: 1_000,
  unexplainedDifference: 0,
  tolerance: 0.01,
  isBalanced: true,
  detailRowCount: 8,
  providerMode: 'legacy' as const,
  checkedAt: '2026-07-27T12:00:00.000Z',
  detailGrain: 'one operational payment',
  status: 'reconciled' as const,
  warnings: [],
};

function logger() {
  return { info: vi.fn(), warn: vi.fn() };
}

describe('dashboard reconciliation observability', () => {
  it('logs only allowlisted reporting metadata', () => {
    const target = logger();
    observeDashboardReconciliation({
      logger: target,
      reportKey: 'admin_financial_control',
      contractVersion: '1.0.0',
      period: { startDate: '2026-07-01', endDate: '2026-07-31' },
      dateBasis: 'payment_date',
      durationMs: 42,
      reconciliation: { ...baseReconciliation, status: 'warning', unexplainedDifference: 10, isBalanced: false },
      unsafeContext: {
        patientName: 'Sensitive Patient',
        phoneNumber: '01700000000',
        invoiceDescription: 'Private invoice line',
        clinicalText: 'Sensitive diagnosis',
      },
    } as never);

    expect(target.warn).toHaveBeenCalledTimes(1);
    const [event, payload] = target.warn.mock.calls[0];
    expect(event).toBe('dashboard.reconciliation.warning');
    expect(payload).toEqual({
      reportKey: 'admin_financial_control',
      contractVersion: '1.0.0',
      periodDays: 31,
      dateBasis: 'payment_date',
      durationMs: 42,
      detailRowCount: 8,
      reconciliationStatus: 'warning',
      unexplainedDifference: 10,
      providerMode: 'legacy',
    });
    expect(JSON.stringify(payload)).not.toContain('Sensitive Patient');
    expect(JSON.stringify(payload)).not.toContain('01700000000');
    expect(JSON.stringify(payload)).not.toContain('Private invoice line');
    expect(JSON.stringify(payload)).not.toContain('Sensitive diagnosis');
  });

  it('emits warning logs for non-zero differences and unavailable reconciliation', () => {
    const target = logger();
    observeDashboardReconciliation({
      logger: target,
      reportKey: 'admin_financial_trend',
      contractVersion: '1.0.0',
      period: { startDate: '2026-07-01', endDate: '2026-07-07' },
      dateBasis: 'payment_and_paid_expense_date',
      durationMs: 8,
      reconciliation: { ...baseReconciliation, status: 'warning', unexplainedDifference: -5, isBalanced: false },
    });
    observeDashboardReconciliation({
      logger: target,
      reportKey: 'admin_financial_trend',
      contractVersion: '1.0.0',
      period: { startDate: '2026-07-01', endDate: '2026-07-07' },
      dateBasis: 'payment_and_paid_expense_date',
      durationMs: 8,
      reconciliation: { ...baseReconciliation, status: 'unavailable', detailTotal: null, unexplainedDifference: null, isBalanced: null },
    });

    expect(target.warn).toHaveBeenCalledTimes(2);
    expect(target.warn.mock.calls[0][1]).toMatchObject({ unexplainedDifference: -5, reconciliationStatus: 'warning' });
    expect(target.warn.mock.calls[1][1]).toMatchObject({ unexplainedDifference: null, reconciliationStatus: 'unavailable' });
  });

  it('keeps normal reconciled logging low-volume unless explicitly sampled', () => {
    const target = logger();
    const input = {
      logger: target,
      reportKey: 'admin_payment_methods',
      contractVersion: '1.0.0',
      period: { startDate: '2026-07-01', endDate: '2026-07-01' },
      dateBasis: 'payment_date',
      durationMs: 5,
      reconciliation: baseReconciliation,
    };

    observeDashboardReconciliation(input);
    expect(target.info).not.toHaveBeenCalled();
    expect(target.warn).not.toHaveBeenCalled();

    observeDashboardReconciliation({ ...input, sampleReconciled: true });
    expect(target.info).toHaveBeenCalledWith('dashboard.reconciliation.sample', expect.objectContaining({
      reconciliationStatus: 'reconciled',
      periodDays: 1,
    }));
  });
});
