import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import {
  assembleFinancialControl,
  type FinancialControlSourceLoaders,
} from '../../../src/services/dashboard/financialControl';
import { createTestApp } from '../helpers/test-app';

function breakdown(total: number, totalRows = 1, sources: Array<{ label: string; amount: number; count: number; direction?: 'in' | 'out' }> = []) {
  return { total, totalRows, sources, rows: [] };
}

function loaders(): FinancialControlSourceLoaders {
  return {
    recognizedIncome: async () => breakdown(1_000, 4),
    approvedExpensePaid: async () => breakdown(200, 2),
    operatingResult: async () => breakdown(800, 6),
    depositReceipts: async () => breakdown(300, 3),
    collectionSplit: async () => ({
      currentInvoiceCollection: 600,
      priorDueCollection: 400,
      totalCollection: 1_000,
      nonCashCollection: 300,
      transactionCount: 8,
    }),
    cashMovement: async () => breakdown(625, 7, [
      { label: 'current invoice cash', amount: 500, count: 2, direction: 'in' },
      { label: 'prior due cash', amount: 200, count: 1, direction: 'in' },
      { label: 'patient deposit cash', amount: 100, count: 1, direction: 'in' },
      { label: 'refund', amount: -50, count: 1, direction: 'out' },
      { label: 'expense', amount: -100, count: 1, direction: 'out' },
      { label: 'doctor payout', amount: -25, count: 1, direction: 'out' },
    ]),
    drawerCash: async () => breakdown(2_400, 2),
    doctorLiability: async () => ({
      earned: 500,
      waiver: 100,
      payable: 400,
      paid: 150,
      outstanding: 250,
      rowCount: 4,
      providerMode: 'legacy',
    }),
  };
}

describe('admin dashboard financial control', () => {
  it('keeps deposits outside recognized income and business result', async () => {
    const result = await assembleFinancialControl({
      period: { startDate: '2026-07-01', endDate: '2026-07-31', label: '2026-07-01 → 2026-07-31' },
      generatedAt: '2026-07-31T12:00:00.000Z',
      loaders: loaders(),
    });

    expect(result.businessPerformance).toMatchObject({
      recognizedIncome: 1_000,
      approvedExpensePaid: 200,
      operatingResult: 800,
      depositReceipts: 300,
      depositTreatment: 'liability_not_revenue',
    });
    expect(result.businessPerformance.reconciliation).toMatchObject({
      status: 'reconciled',
      summaryTotal: 800,
      detailTotal: 800,
    });
  });

  it('separates current invoice, prior-due, and deposit collection', async () => {
    const result = await assembleFinancialControl({
      period: { startDate: '2026-07-01', endDate: '2026-07-31', label: 'July 2026' },
      generatedAt: '2026-07-31T12:00:00.000Z',
      loaders: loaders(),
    });

    expect(result.collectionFlow).toMatchObject({
      currentInvoiceCollection: 600,
      priorDueCollection: 400,
      totalCollection: 1_000,
      depositReceipts: 300,
      depositIncludedInTotalCollection: false,
    });
    expect(result.collectionFlow.reconciliation.status).toBe('reconciled');
  });

  it('excludes non-cash collection from physical drawer cash', async () => {
    const result = await assembleFinancialControl({
      period: { startDate: '2026-07-01', endDate: '2026-07-31', label: 'July 2026' },
      generatedAt: '2026-07-31T12:00:00.000Z',
      loaders: loaders(),
    });

    expect(result.cashCustody).toMatchObject({
      physicalCashIn: 800,
      physicalCashOut: 175,
      netCashMovement: 625,
      nonCashCollection: 300,
      currentDrawerBalance: 2_400,
      currentDrawerTemporalMode: 'current_state',
    });
    expect(result.cashCustody.reconciliation.status).toBe('reconciled');
  });

  it('keeps earned, waiver, payable, paid, and outstanding doctor amounts separate', async () => {
    const result = await assembleFinancialControl({
      period: { startDate: '2026-07-01', endDate: '2026-07-31', label: 'July 2026' },
      generatedAt: '2026-07-31T12:00:00.000Z',
      loaders: loaders(),
    });

    expect(result.doctorLiability).toMatchObject({
      earned: 500,
      waiver: 100,
      payable: 400,
      paid: 150,
      outstanding: 250,
      providerMode: 'legacy',
    });
    expect(result.doctorLiability.reconciliation.status).toBe('reconciled');
  });

  it('returns 400 for an invalid reporting period', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const response = await app.request('/dashboard/financial-control?startDate=2026-07-31&endDate=2026-07-01');
    expect(response.status).toBe(400);
  });
});
