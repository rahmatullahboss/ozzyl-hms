import { describe, expect, it } from 'vitest';
import dashboardRoutes, { getAccountingIncomeSourceSql, getCashMovementDetailSql } from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

interface KpiBreakdownResponse {
  metric: string;
  title: string;
  total: number;
  period: { startDate: string; endDate: string; label: string };
  sources: Array<{ label: string; amount: number; count: number; direction?: 'in' | 'out' }>;
  totalRows?: number;
  rows: Array<{ id: string; occurredAt: string; sourceType: string; sourceLabel: string; amount: number; invoiceNo?: string | null }>;
}

describe('admin dashboard kpi-breakdown — cash_movement metric', () => {
  it('rejects unsupported metric', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=unsupported');
    expect(res.status).toBe(400);
  });

  it('rejects malformed date', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=cash_movement&date=2026/06/23');
    expect(res.status).toBe(400);
  });

  it('classifies radiology cash rows separately from lab', () => {
    const sql = getCashMovementDetailSql();
    expect(sql).toContain('mdDashboard.kpi.cashMovementSourceRadiology');
    expect(sql).toContain('radiology_item.item_category');
    expect(sql).toContain("IN ('radiology', 'imaging')");
  });

  it('uses cash-only payment rows for physical cash movement', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payments') && lower.includes('group by source_label')) {
          return { results: [] };
        }
        if (lower.includes('union all')) return { results: [] };
        return { results: [{ total: 0, row_count: 0 }] };
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=cash_movement&date=2026-06-23');
    expect(res.status).toBe(200);

    const paymentQueries = mockDB.queries.filter((query) => query.sql.toLowerCase().includes('from payments'));
    expect(paymentQueries.length).toBeGreaterThan(0);
    expect(paymentQueries.every((query) => /lower\(trim\(coalesce\(p\.payment_method,\s*'cash'\)\)\)\s*=\s*'cash'/.test(query.sql.toLowerCase()))).toBe(true);
  });

  it('includes doctor payouts in cash-basis expenses and excludes approved-but-unpaid requests', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from expenses e') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'utilities', amount: 200, row_count: 1 }] };
        }
        if (lower.includes('from expenses e') && lower.includes('order by occurred_at desc')) {
          return { results: [] };
        }
        if (lower.includes('from cash_drawer_movements') && lower.includes('doctor_commission_settlement') && lower.includes('group by')) {
          return { results: [{ source_label: 'Doctor payouts', amount: 300, row_count: 1 }] };
        }
        if (lower.includes('from cash_drawer_movements') && lower.includes('doctor_commission_settlement')) {
          return { results: [] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=accounting_expenses&date=2026-06-23');
    expect(res.status).toBe(200);
    const body = await res.json() as KpiBreakdownResponse;

    expect(body.total).toBe(500);
    expect(body.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'utilities', amount: 200 }),
      expect.objectContaining({ label: 'Doctor payouts', amount: 300 }),
    ]));

    const expenseSql = mockDB.queries.find((query) => query.sql.toLowerCase().includes('from expenses e'))?.sql.toLowerCase() ?? '';
    expect(expenseSql).toContain("coalesce(e.payment_status, 'unpaid') = 'paid'");
    expect(expenseSql).not.toContain("coalesce(e.status, 'approved') = 'approved' or");
  });

  it('calculates accounting profit from the same collection and expense sources', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payments p') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'OPD', amount: 1000, row_count: 1 }] };
        }
        if (lower.includes('from payments p') && lower.includes('order by occurred_at desc')) return { results: [] };
        if (lower.includes('from expenses e') && lower.includes('group by source_label')) {
          return { results: [{ source_label: 'utilities', amount: 200, row_count: 1 }] };
        }
        if (lower.includes('from expenses e') && lower.includes('order by occurred_at desc')) return { results: [] };
        if (lower.includes('from cash_drawer_movements') && lower.includes('doctor_commission_settlement') && lower.includes('group by')) {
          return { results: [{ source_label: 'Doctor payouts', amount: 300, row_count: 1 }] };
        }
        if (lower.includes('from cash_drawer_movements') && lower.includes('doctor_commission_settlement')) return { results: [] };
        if (lower.includes('from emp_cash_transactions') && lower.includes("transaction_type = 'salesreturn'") && lower.includes('group by')) {
          return { results: [{ source_label: 'Sales returns / refunds', amount: 100, row_count: 1 }] };
        }
        if (lower.includes('from emp_cash_transactions') && lower.includes("transaction_type = 'salesreturn'")) return { results: [] };
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=accounting_profit&date=2026-06-23');
    expect(res.status).toBe(200);
    const body = await res.json() as KpiBreakdownResponse;
    expect(body.total).toBe(500);
    expect(body.sources.reduce((sum, source) => sum + source.amount, 0)).toBe(500);
    expect(body.sources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Sales returns / refunds' }),
    ]));
  });

  it('returns service-level cash-in buckets with deposit/expense/payout rows', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        // Bill collection bucket: max(ledger, payment)
        if (lower.includes('from payments p') && lower.includes('as total') && !lower.includes('group by source_label')) {
          return { results: [{ total: 56550, row_count: 2 }] };
        }

        // Bill collection buckets: split same-day bill cash by service head.
        if (lower.includes('cashmovementsourcetest') && lower.includes('group by source_label')) {
          return {
            results: [
              { source_label: 'mdDashboard.kpi.cashMovementSourceVisit', amount: 30000, row_count: 1 },
              { source_label: 'mdDashboard.kpi.cashMovementSourceTest', amount: 26550, row_count: 1 },
            ],
          };
        }

        // Patient deposit bucket
        if (lower.includes("reference_type = 'deposit'") && !lower.includes('union all')) {
          return { results: [{ total: 500, row_count: 1 }] };
        }

        // Cash refund / return bucket
        if (lower.includes("'returndeposit'") && lower.includes('emp_cash_transactions') && !lower.includes('union all')) {
          return { results: [{ total: 500, row_count: 1 }] };
        }

        // Drawer expense bucket
        if (lower.includes("reference_type in ('expense', 'expense_pending')") && !lower.includes('union all')) {
          return { results: [{ total: 300, row_count: 2 }] };
        }

        // Doctor payout bucket
        if (lower.includes('doctor_commission_settlement') && !lower.includes('union all')) {
          return { results: [{ total: 32928, row_count: 4 }] };
        }

        // Detail rows UNION ALL — return 2 sample rows
        if (lower.includes('union all')) {
          return {
            results: [
              {
                id: 'bill-5468',
                occurred_at: '2026-06-23 17:58:27',
                source_type: 'bill',
                source_label: 'mdDashboard.kpi.cashMovementSourceVisit',
                reference_no: 'INV-A-2026-000142',
                counter_name: 'Front Counter',
                user_name: 'Nusrat Jahan Sony',
                amount: 700,
                status: 'posted',
                bill_id: 5468,
                invoice_no: 'INV-A-2026-000142',
                patient_name: 'Rahim Uddin',
                patient_code: 'P-001',
                discount_reference: 'Referral desk',
                discount_reason: 'Campaign',
                service_names: 'Doctor visit bill',
                item_count: 1,
                payment_method: 'cash',
                gross_amount: 1000,
                discount_amount: 100,
                net_amount: 900,
                paid_amount: 700,
                due_amount: 200,
              },
              {
                id: 'deposit-466',
                occurred_at: '2026-06-23 13:54:27',
                source_type: 'deposit',
                source_label: 'mdDashboard.kpi.cashMovementSourceDeposit',
                reference_no: 'DEP-000008',
                counter_name: null,
                user_name: null,
                amount: 500,
                status: 'posted',
              },
              {
                id: 'refund-10',
                occurred_at: '2026-06-23 15:00:00',
                source_type: 'refund',
                source_label: 'mdDashboard.kpi.cashMovementSourceRefund',
                reference_no: 'Discharge refund DRF-000001',
                counter_name: null,
                user_name: 'Nusrat Jahan Sony',
                amount: -500,
                status: 'paid',
              },
            ],
          };
        }

        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=cash_movement&date=2026-06-23');
    expect(res.status).toBe(200);

    const body = await res.json() as KpiBreakdownResponse;
    expect(body.metric).toBe('cash_movement');
    expect(body.title).toBe('Net Cash Movement');
    expect(body.sources).toHaveLength(6);
    expect(body.sources[0].label).toBe('mdDashboard.kpi.cashMovementSourceVisit');
    expect(body.sources[0].amount).toBe(30000);
    expect(body.sources[0].direction).toBe('in');
    expect(body.sources[1].label).toBe('mdDashboard.kpi.cashMovementSourceTest');
    expect(body.sources[1].amount).toBe(26550);
    expect(body.sources[1].direction).toBe('in');
    expect(body.sources[2].label).toBe('mdDashboard.kpi.cashMovementSourceDeposit');
    expect(body.sources[2].amount).toBe(500);
    expect(body.sources[3].label).toBe('mdDashboard.kpi.cashMovementSourceRefund');
    expect(body.sources[3].amount).toBe(-500);
    expect(body.sources[3].direction).toBe('out');
    expect(body.sources[4].label).toBe('mdDashboard.kpi.cashMovementSourceExpense');
    expect(body.sources[4].amount).toBe(-300);
    expect(body.sources[4].direction).toBe('out');
    expect(body.sources[5].label).toBe('mdDashboard.kpi.cashMovementSourcePayout');
    expect(body.sources[5].amount).toBe(-32928);
    expect(body.rows).toHaveLength(3);
    expect(body.rows[0].id).toBe('bill-5468');
    expect(body.rows[0].sourceLabel).toBe('mdDashboard.kpi.cashMovementSourceVisit');
    expect(body.rows[0]).toMatchObject({
      billId: 5468,
      invoiceNo: 'INV-A-2026-000142',
      patientName: 'Rahim Uddin',
      patientCode: 'P-001',
      serviceNames: 'Doctor visit bill',
      paymentMethod: 'cash',
      grossAmount: 1000,
      discountAmount: 100,
      netAmount: 900,
      paidAmount: 700,
      dueAmount: 200,
    });
    expect(body.rows[1].sourceType).toBe('deposit');
    expect(body.rows[2].sourceType).toBe('refund');
    expect(body.rows[2].amount).toBe(-500);
  });

  it('uses the selected range start as the legacy due-collection cutoff', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payments p') && lower.includes('group by source_label')) {
          return { results: [] };
        }
        if (lower.includes('union all')) return { results: [] };
        return { results: [{ total: 0, row_count: 0 }] };
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=cash_movement&preset=custom&startDate=2026-06-01&endDate=2026-06-30');
    expect(res.status).toBe(200);

    const sourceSplitQuery = mockDB.queries.find((query) => {
      const lower = query.sql.toLowerCase();
      return lower.includes('cashmovementsourceduecollection') && lower.includes('group by source_label');
    });
    expect(sourceSplitQuery?.params[0]).toBe('2026-06-01');
    expect(sourceSplitQuery?.sql.toLowerCase()).toContain("coalesce(p.payment_type, 'current') = 'due'");

    const detailQuery = mockDB.queries.find((query) => query.sql.toLowerCase().includes('union all'));
    expect(detailQuery?.params.slice(0, 4)).toEqual(['tenant-1', '2026-06-01', '2026-06-01', '2026-06-30']);
    expect(detailQuery?.sql.toLowerCase()).toContain("coalesce(p.payment_type, 'current') = 'due'");
  });

  it('filters drilldown rows to the selected cash source label', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payments p') && lower.includes('as total') && !lower.includes('group by source_label')) {
          return { results: [{ total: 1000, row_count: 2 }] };
        }
        if (lower.includes('cashmovementsourcetest') && lower.includes('group by source_label')) {
          return {
            results: [
              { source_label: 'mdDashboard.kpi.cashMovementSourceVisit', amount: 600, row_count: 1 },
              { source_label: 'mdDashboard.kpi.cashMovementSourceTest', amount: 400, row_count: 1 },
            ],
          };
        }
        if (lower.includes("reference_type = 'deposit'") && !lower.includes('union all')) {
          return { results: [{ total: 0, row_count: 0 }] };
        }
        if (lower.includes("'returndeposit'") && lower.includes('emp_cash_transactions') && !lower.includes('union all')) {
          return { results: [{ total: 0, row_count: 0 }] };
        }
        if (lower.includes("reference_type in ('expense', 'expense_pending')") && !lower.includes('union all')) {
          return { results: [{ total: 0, row_count: 0 }] };
        }
        if (lower.includes('doctor_commission_settlement') && !lower.includes('union all')) {
          return { results: [{ total: 0, row_count: 0 }] };
        }
        if (lower.includes('union all')) {
          return {
            results: [
              { id: 'bill-visit', occurred_at: '2026-06-23 10:00:00', source_type: 'bill', source_label: 'mdDashboard.kpi.cashMovementSourceVisit', reference_no: 'VISIT-1', amount: 600, status: 'posted' },
              { id: 'bill-test', occurred_at: '2026-06-23 11:00:00', source_type: 'bill', source_label: 'mdDashboard.kpi.cashMovementSourceTest', reference_no: 'TEST-1', amount: 400, status: 'posted' },
            ],
          };
        }
        return null;
      },
    });

    const sourceLabel = encodeURIComponent('mdDashboard.kpi.cashMovementSourceVisit');
    const res = await app.request(`/dashboard/kpi-breakdown?metric=billing_collection&date=2026-06-23&sourceLabel=${sourceLabel}`);
    expect(res.status).toBe(200);

    const body = await res.json() as KpiBreakdownResponse;
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].label).toBe('mdDashboard.kpi.cashMovementSourceVisit');
    expect(body.sources[0].amount).toBe(600);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].id).toBe('bill-visit');
    expect(body.rows[0].sourceLabel).toBe('mdDashboard.kpi.cashMovementSourceVisit');
  });

  it('returns admission-linked invoice rows for the dedicated IPD collection metric', async () => {
    let usedAdmissionJoin = false;
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('join payments p') && lower.includes('b.admission_id is not null') && lower.includes('count(*)') && !lower.includes('order by')) {
          usedAdmissionJoin = true;
          return { results: [{ total: 33900, row_count: 1 }] };
        }
        if (lower.includes('join payments p') && lower.includes('b.admission_id is not null') && lower.includes('order by')) {
          usedAdmissionJoin = true;
          return {
            results: [{
              id: 'ipd-payment-1534',
              occurred_at: '2026-07-16 15:50:49',
              source_type: 'ipd_collection',
              source_label: 'Admission/IPD collection',
              reference_no: 'RCP-001350',
              amount: 33900,
              status: 'paid',
              payment_method: 'cash',
              gross_amount: 35445,
              discount_amount: 1245,
              net_amount: 34200,
              paid_amount: 33900,
              due_amount: 0,
              bill_id: 6548,
              invoice_no: 'BL-000025',
              patient_name: 'Test Patient',
              patient_code: 'PT-001',
              service_names: 'Admission Fee, OT Charge, Medicine, Cabin',
              item_count: 7,
            }],
          };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=ipd_collection&date=2026-07-16');
    expect(res.status).toBe(200);

    const body = await res.json() as KpiBreakdownResponse;
    expect(usedAdmissionJoin).toBe(true);
    expect(body.total).toBe(33900);
    expect(body.totalRows).toBe(1);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      billId: 6548,
      invoiceNo: 'BL-000025',
      sourceType: 'ipd_collection',
      patientName: 'Test Patient',
      patientCode: 'PT-001',
      serviceNames: 'Admission Fee, OT Charge, Medicine, Cabin',
      paymentMethod: 'cash',
      grossAmount: 35445,
      discountAmount: 1245,
      netAmount: 34200,
      paidAmount: 33900,
      dueAmount: 0,
    });
    const ipdSql = mockDB.queries
      .filter((query) => query.sql.toLowerCase().includes('b.admission_id is not null'))
      .map((query) => query.sql)
      .join('\n');
    expect(ipdSql).toContain("'+6 hours'");
  });

  it('filters accounting income drilldown by sourceLabel before returning detail rows', async () => {
    let sawSourceFilterSql = false;
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payments p') && lower.includes('group by source_label')) {
          sawSourceFilterSql = lower.includes(' in (?)');
          return { results: [{ source_label: 'OT', amount: 13700, row_count: 1 }] };
        }
        if (lower.includes('from payments p') && lower.includes('order by pa.occurred_at desc')) {
          sawSourceFilterSql = sawSourceFilterSql && lower.includes(' in (?)');
          return {
            results: [{
              id: 'payment-ot-1',
              occurred_at: '2026-07-07 12:00:00',
              source_type: 'payment',
              source_label: 'OT',
              reference_no: 'PAY-OT-1',
              counter_name: 'Reception',
              user_name: 'Reception',
              amount: 13700,
              status: 'posted',
              bill_id: 10,
              invoice_no: 'INV-OT-1',
              patient_name: 'Patient A',
              patient_code: 'P-1',
              service_names: 'OT package',
            }],
          };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=accounting_income&date=2026-07-07&sourceLabel=OT');
    expect(res.status).toBe(200);

    const body = await res.json() as KpiBreakdownResponse;
    expect(sawSourceFilterSql).toBe(true);
    expect(body.sources).toEqual([{ label: 'OT', amount: 13700, count: 1 }]);
    expect(body.total).toBe(13700);
    expect(body.totalRows).toBe(1);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].sourceLabel).toBe('OT');
    expect(body.rows[0].invoiceNo).toBe('INV-OT-1');
  });
  it('handles empty tenant — no rows, sources present, total 0', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('union all')) {
          return { results: [] };
        }
        // Source buckets all return 0
        if (lower.includes('as total') || lower.includes('as row_count')) {
          return { results: [{ total: 0, row_count: 0 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=cash_movement&date=2026-06-23');
    expect(res.status).toBe(200);

    const body = await res.json() as KpiBreakdownResponse;
    expect(body.sources).toHaveLength(5);
    expect(body.sources.every((s) => s.amount === 0)).toBe(true);
    expect(body.rows).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});

/**
 * Regression: the detail-row UNION query used to reference `payments.status`
 * (no such column) which produced `no such column: p.status` at runtime and
 * a 500 response. The route-level tests above use a `queryOverride` mock that
 * intercepts SQL and never validates columns, so the bug only surfaced in the
 * real D1 database. This test executes the *same* SQL the route runs against
 * an in-memory SQLite with the production schema so any future column drift
 * fails here.
 */
describe('admin dashboard accounting income allocation SQL', () => {
  it('allocates a mixed invoice payment proportionally across active invoice items', () => {
    let sqlite: typeof import('node:sqlite') | undefined;
    try {
      sqlite = require('node:sqlite') as typeof import('node:sqlite');
    } catch {
      return;
    }

    const db = new sqlite.DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE payments (
        id INTEGER PRIMARY KEY,
        bill_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_method TEXT,
        receipt_no TEXT,
        received_by INTEGER,
        counter_session_id INTEGER,
        date TEXT,
        created_at TEXT,
        tenant_id TEXT NOT NULL
      );
      CREATE TABLE bills (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        invoice_no TEXT,
        patient_id INTEGER,
        admission_id INTEGER,
        created_at TEXT,
        total REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        paid REAL DEFAULT 0,
        due REAL DEFAULT 0,
        discount_by_name TEXT,
        referred_by_name TEXT,
        discount_reason TEXT,
        test_bill REAL DEFAULT 0,
        doctor_visit_bill REAL DEFAULT 0,
        admission_bill REAL DEFAULT 0,
        operation_bill REAL DEFAULT 0,
        medicine_bill REAL DEFAULT 0
      );
      CREATE TABLE invoice_items (
        id INTEGER PRIMARY KEY,
        bill_id INTEGER NOT NULL,
        item_category TEXT NOT NULL,
        description TEXT,
        quantity INTEGER DEFAULT 1,
        unit_price REAL DEFAULT 0,
        line_total REAL DEFAULT 0,
        status TEXT DEFAULT 'active',
        tenant_id TEXT NOT NULL
      );
      INSERT INTO bills (id, tenant_id, total, paid, due, test_bill, doctor_visit_bill)
        VALUES (1, 'tenant-1', 100, 100, 0, 60, 40);
      INSERT INTO payments (id, bill_id, amount, payment_method, date, tenant_id)
        VALUES (1, 1, 100, 'cash', '2026-07-10 10:00:00', 'tenant-1');
      INSERT INTO invoice_items (id, bill_id, item_category, description, line_total, tenant_id)
        VALUES (1, 1, 'test', 'CBC', 60, 'tenant-1'),
               (2, 1, 'consultation', 'Doctor visit', 40, 'tenant-1');
    `);

    const rows = db.prepare(getAccountingIncomeSourceSql()).all('tenant-1', '2026-07-10', '2026-07-10') as Array<{ source_label: string; amount: number }>;
    expect(rows).toEqual([
      expect.objectContaining({ source_label: 'Lab', amount: 60 }),
      expect.objectContaining({ source_label: 'OPD', amount: 40 }),
    ]);
    expect(rows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(100);
  });
});

describe('admin dashboard kpi-breakdown — cash_movement SQL schema check', () => {
  // Production schema (extracted from `wrangler d1 execute ... "SELECT sql FROM sqlite_master"`).
  // Keep these CREATE statements in sync with the actual migrations.
  const SCHEMA = `
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT,
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      tenant_id INTEGER NOT NULL,
      settlement_type_id INTEGER,
      receipt_no TEXT,
      received_by INTEGER,
      payment_method TEXT,
      counter_session_id INTEGER,
      type TEXT DEFAULT 'current',
      idempotency_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT,
      patient_id INTEGER,
      tenant_id INTEGER NOT NULL,
      status TEXT,
      total REAL,
      discount REAL,
      paid REAL,
      due REAL,
      discount_by_name TEXT,
      referred_by_name TEXT,
      discount_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      test_bill REAL DEFAULT 0,
      doctor_visit_bill REAL DEFAULT 0,
      admission_bill REAL DEFAULT 0,
      operation_bill REAL DEFAULT 0,
      medicine_bill REAL DEFAULT 0
    );
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      patient_code TEXT,
      tenant_id INTEGER NOT NULL
    );
    CREATE TABLE billing_counters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      counter_name TEXT,
      tenant_id INTEGER NOT NULL
    );
    CREATE TABLE billing_counter_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      counter_id INTEGER,
      tenant_id INTEGER NOT NULL
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      item_category TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      tenant_id INTEGER NOT NULL
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      tenant_id INTEGER NOT NULL
    );
    CREATE TABLE emp_cash_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      employee_id INTEGER,
      transaction_type TEXT,
      amount REAL,
      payment_method TEXT,
      reference_type TEXT,
      transaction_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      description TEXT
    );
    CREATE TABLE cash_drawer_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      movement_type TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      amount REAL,
      payment_method TEXT DEFAULT 'cash',
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      event_type TEXT,
      status TEXT,
      payload_json TEXT,
      event_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Parameter slots mirror the order in `getCashMovementDetailSql.bind(...)`:
  // The payment leg includes the legacy due cutoff before its start/end dates;
  // remaining UNION ALL legs use tenantId + startDate + endDate, followed by pagination.
  const SQL_PARAMS = [
    100, '2026-06-23', '2026-06-23', '2026-06-23',
    100, '2026-06-23', '2026-06-23',
    100, '2026-06-23', '2026-06-23',
    100, '2026-06-23', '2026-06-23',
    100, '2026-06-23', '2026-06-23',
    50, 0,
  ];

  it('does not reference payments.status (which does not exist)', () => {
    // Belt-and-braces string check that survives even on older Node runtimes
    // without node:sqlite. This is the actual regression guard.
    expect(getCashMovementDetailSql()).not.toMatch(/\bp\.status\b/);
  });

  it('executes the detail SQL against the production schema without "no such column" errors', () => {
    let sqlite: typeof import('node:sqlite') | undefined;
    try {
      sqlite = require('node:sqlite') as typeof import('node:sqlite');
    } catch {
      // Older Node — the string check above is the only guard we can offer.
      return;
    }

    const db = new sqlite.DatabaseSync(':memory:');
    db.exec(SCHEMA);

    const sql = getCashMovementDetailSql();
    expect(() => db.prepare(sql).all(...SQL_PARAMS)).not.toThrow();
  });
});
