import { describe, expect, it } from 'vitest';
import billingRoutes from '../../../src/routes/tenant/billing';
import depositsRoutes from '../../../src/routes/tenant/deposits';
import { createTestApp } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';

describe('Patient financial report reconciliation surfaces', () => {
  it('returns patient due report summary from due rows', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('FROM bills b') && sql.includes('as outstanding')) {
          return {
            results: [
              { id: 1, patient_id: 10, total_amount: 1000, paid_amount: 250, outstanding: 750 },
              { id: 2, patient_id: 11, total_amount: 500, paid_amount: 500, outstanding: 0 },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/billing/due');

    expect(res.status).toBe(200);
    const body = await res.json() as { bills: unknown[]; summary: { totalBills: number; totalDue: number } };
    expect(body.bills).toHaveLength(2);
    expect(body.summary).toEqual({ totalBills: 2, totalDue: 750 });
  });

  it('binds date and search filters when requesting the due report', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql, params) => {
        if (sql.includes('FROM bills b') && sql.includes('as outstanding')) {
          capturedSql = sql;
          capturedParams = params;
          return { results: [] };
        }
        return null;
      },
    });

    const res = await app.request('/billing/due?from=2026-05-12&to=2026-05-12&search=INV-9');

    expect(res.status).toBe(200);
    expect(capturedSql).toContain('date(b.created_at) >= date(?)');
    expect(capturedSql).toContain('date(b.created_at) <= date(?)');
    expect(capturedSql).toContain('b.invoice_no LIKE ?');
    expect(capturedParams).toEqual([
      TENANT_ID,
      '2026-05-12',
      '2026-05-12',
      '%INV-9%',
      '%INV-9%',
      '%INV-9%',
    ]);
  });

  it('binds patient filters when requesting a patient due report', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql, params) => {
        if (sql.includes('FROM bills b') && sql.includes('as outstanding')) {
          capturedSql = sql;
          capturedParams = params;
          return {
            results: [
              { id: 1, patient_id: 10, total_amount: 1200, paid_amount: 200, outstanding: 1000 },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/billing/due?patient_id=10&startDate=2026-05-01&endDate=2026-05-31');

    expect(res.status).toBe(200);
    const body = await res.json() as { summary: { totalBills: number; totalDue: number } };
    expect(body.summary).toEqual({ totalBills: 1, totalDue: 1000 });
    expect(capturedSql).toContain('b.patient_id = ?');
    expect(capturedParams).toEqual([TENANT_ID, '2026-05-01', '2026-05-31', 10]);
  });

  it('rejects inverted due report date ranges before querying bills', async () => {
    let queried = false;
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('FROM bills b') && sql.includes('as outstanding')) {
          queried = true;
        }
        return null;
      },
    });

    const res = await app.request('/billing/due?from=2026-06-01&to=2026-05-01');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'from date cannot be after to date' });
    expect(queried).toBe(false);
  });

  it('excludes paid bills from due report candidates even when legacy paid totals are inconsistent', async () => {
    let capturedSql = '';
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('FROM bills b') && sql.includes('as outstanding')) {
          capturedSql = sql;
          return { results: [] };
        }
        return null;
      },
    });

    const res = await app.request('/billing/due');

    expect(res.status).toBe(200);
    expect(capturedSql).toContain("'paid'");
    expect(capturedSql).toContain("'cancelled'");
    expect(capturedSql).toContain("'refunded'");
    expect(capturedSql).toContain("'draft'");
  });

  it('returns deposit list summary matching patient advance formula', async () => {
    const { app } = createTestApp({
      route: depositsRoutes,
      routePath: '/deposits',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('SUM(CASE WHEN d.transaction_type')) {
          return {
            first: {
              total_deposits: 1000,
              total_refunds: 200,
              total_adjustments: 300,
            },
          };
        }
        if (sql.includes('FROM billing_deposits d')) {
          return {
            results: [
              { id: 1, patient_id: 10, amount: 1000, transaction_type: 'deposit' },
              { id: 2, patient_id: 10, amount: 300, transaction_type: 'adjustment' },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/deposits');

    expect(res.status).toBe(200);
    const body = await res.json() as { summary: { total_deposits: number; total_refunds: number; total_adjustments: number; balance: number } };
    expect(body.summary).toEqual({
      total_deposits: 1000,
      total_refunds: 200,
      total_adjustments: 300,
      balance: 500,
    });
  });

  it('returns patient-wise advance report with balanced summary totals', async () => {
    const { app } = createTestApp({
      route: depositsRoutes,
      routePath: '/deposits',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('GROUP BY d.patient_id')) {
          return {
            results: [
              {
                patient_id: 10,
                patient_name: 'Rahin',
                patient_code: 'P-001',
                total_deposits: 1000,
                total_refunds: 100,
                total_adjustments: 250,
                balance: 650,
              },
              {
                patient_id: 11,
                patient_name: 'Karim',
                patient_code: 'P-002',
                total_deposits: 500,
                total_refunds: 0,
                total_adjustments: 200,
                balance: 300,
              },
            ],
          };
        }
        if (sql.includes("m.mapping_key = 'patient_deposit_liability'")) {
          return { first: { advance_liability_ledger_total: 950 } };
        }
        return null;
      },
    });

    const res = await app.request('/deposits/advance-report');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      rows: unknown[];
      summary: {
        patient_count: number;
        total_deposits: number;
        total_refunds: number;
        total_adjustments: number;
        balance: number;
      };
    };
    expect(body.rows).toHaveLength(2);
    expect(body.summary).toEqual({
      patient_count: 2,
      total_deposits: 1500,
      total_refunds: 100,
      total_adjustments: 450,
      balance: 950,
      advanceLiabilityLedgerTotal: 950,
      ledgerDifference: 0,
      hasLedgerMismatch: false,
      ledgerStatus: 'balanced',
    });
  });

  it('filters advance report by patient/date and reconciles to the advance liability ledger', async () => {
    let advanceSql = '';
    let advanceParams: unknown[] = [];
    let ledgerSql = '';
    let ledgerParams: unknown[] = [];
    const { app } = createTestApp({
      route: depositsRoutes,
      routePath: '/deposits',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql, params) => {
        if (sql.includes('GROUP BY d.patient_id')) {
          advanceSql = sql;
          advanceParams = params;
          return {
            results: [
              {
                patient_id: 10,
                patient_name: 'Rahin',
                patient_code: 'P-001',
                total_deposits: 1000,
                total_refunds: 100,
                total_adjustments: 250,
                balance: 650,
              },
            ],
          };
        }
        if (sql.includes("m.mapping_key = 'patient_deposit_liability'")) {
          ledgerSql = sql;
          ledgerParams = params;
          return { first: { advance_liability_ledger_total: 650 } };
        }
        return null;
      },
    });

    const res = await app.request('/deposits/advance-report?patient_id=10&startDate=2026-05-01&endDate=2026-05-31');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      summary: {
        patient_count: number;
        total_deposits: number;
        total_refunds: number;
        total_adjustments: number;
        balance: number;
        advanceLiabilityLedgerTotal: number;
        ledgerDifference: number;
        hasLedgerMismatch: boolean;
        ledgerStatus: string;
      };
    };
    expect(body.summary).toEqual({
      patient_count: 1,
      total_deposits: 1000,
      total_refunds: 100,
      total_adjustments: 250,
      balance: 650,
      advanceLiabilityLedgerTotal: 650,
      ledgerDifference: 0,
      hasLedgerMismatch: false,
      ledgerStatus: 'balanced',
    });
    expect(advanceSql).toContain('date(d.created_at) >= date(?)');
    expect(advanceSql).toContain('date(d.created_at) <= date(?)');
    expect(advanceSql).toContain('d.patient_id = ?');
    expect(advanceParams).toEqual([TENANT_ID, '2026-05-01', '2026-05-31', 10, 0]);
    expect(ledgerSql).toContain('accounting_journal_lines');
    expect(ledgerSql).toContain('accounting_posting_events ape');
    expect(ledgerSql).toContain("json_extract(ape.payload_json, '$.patientId') = ?");
    expect(ledgerSql).toContain('date(v.entry_date) >= date(?)');
    expect(ledgerSql).toContain('date(v.entry_date) <= date(?)');
    expect(ledgerParams).toEqual([TENANT_ID, '2026-05-01', '2026-05-31', 10]);
  });

  it('rejects inverted advance report date ranges before querying deposits', async () => {
    let queried = false;
    const { app } = createTestApp({
      route: depositsRoutes,
      routePath: '/deposits',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('GROUP BY d.patient_id')) queried = true;
        return null;
      },
    });

    const res = await app.request('/deposits/advance-report?from=2026-06-01&to=2026-05-01');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'startDate must be on or before endDate' });
    expect(queried).toBe(false);
  });

  it('returns a consolidated patient ledger with running receivable balance', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql) => {
        if (sql.includes('FROM patients') && sql.includes('WHERE id = ?')) {
          return { first: { id: 10, name: 'Rahin', patient_code: 'P-001', mobile: '01700000000' } };
        }
        if (sql.includes('AS opening_balance')) {
          return { first: { opening_balance: 0 } };
        }
        if (sql.includes('patient_ledger_source')) {
          return {
            results: [
              { event_date: '2026-05-12 09:00:00', source_type: 'bill', source_id: 1, reference_no: 'INV-1', description: 'Bill INV-1', debit: 1000, credit: 0 },
              { event_date: '2026-05-12 09:10:00', source_type: 'payment', source_id: 2, reference_no: 'RCT-1', description: 'Payment RCT-1', debit: 0, credit: 250 },
              { event_date: '2026-05-12 09:20:00', source_type: 'deposit_adjustment', source_id: 3, reference_no: 'DAD-1', description: 'Deposit adjustment DAD-1', debit: 0, credit: 100 },
              { event_date: '2026-05-12 09:30:00', source_type: 'credit_note', source_id: 4, reference_no: 'CN-1', description: 'Credit note CN-1', debit: 0, credit: 50 },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/billing/patient/10/ledger');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      opening: number;
      closing: number;
      summary: { totalDebit: number; totalCredit: number; transactionCount: number };
      transactions: Array<{ sourceType: string; debit: number; credit: number; balance: number }>;
    };
    expect(body.opening).toBe(0);
    expect(body.transactions.map((row) => row.balance)).toEqual([1000, 750, 650, 600]);
    expect(body.summary).toEqual({ totalDebit: 1000, totalCredit: 400, transactionCount: 4 });
    expect(body.closing).toBe(600);
  });

  it('includes opening balance before the requested patient ledger date range', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'accountant',
      tenantId: TENANT_ID,
      queryOverride: (sql, params) => {
        if (sql.includes('FROM patients') && sql.includes('WHERE id = ?')) {
          return { first: { id: 10, name: 'Rahin', patient_code: 'P-001' } };
        }
        if (sql.includes('AS opening_balance')) {
          return { first: { opening_balance: 400 } };
        }
        if (sql.includes('patient_ledger_source')) {
          capturedSql = sql;
          capturedParams = params;
          return {
            results: [
              { event_date: '2026-05-13 09:00:00', source_type: 'bill', source_id: 5, reference_no: 'INV-2', description: 'Bill INV-2', debit: 200, credit: 0 },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/billing/patient/10/ledger?from=2026-05-13&to=2026-05-13');

    expect(res.status).toBe(200);
    const body = await res.json() as { opening: number; closing: number; transactions: Array<{ balance: number }> };
    expect(body.opening).toBe(400);
    expect(body.transactions[0]?.balance).toBe(600);
    expect(body.closing).toBe(600);
    expect(capturedSql).toContain('date(event_date) >= date(?)');
    expect(capturedSql).toContain('date(event_date) <= date(?)');
    expect(capturedParams).toEqual([TENANT_ID, 10, '2026-05-13', '2026-05-13']);
  });
});
