import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { getExecutiveCommissionBreakdown, getExecutiveCommissionTotals } from '../../src/lib/executive-commission-analytics';
import { getDoctorPerformance, getDoctorPerformanceDetails } from '../../src/lib/executive-doctor-analytics';
import { getExpenseAnalysis } from '../../src/lib/executive-expense-analytics';
import { getIncomeServiceAnalysis } from '../../src/lib/executive-income-analytics';
import { getReagentReconciliation } from '../../src/lib/executive-reagent-analytics';
import { getTestPerformance, getTestPerformanceDetails } from '../../src/lib/executive-test-analytics';
import type { ExecutiveDashboardPeriod } from '../../src/lib/executive-dashboard-period';
import { authMiddleware } from '../../src/middleware/auth';
import dashboardRoutes from '../../src/routes/tenant/dashboard';
import type { Env, Variables } from '../../src/types';
import { createTestApp } from './helpers/test-app';

type SqliteValue = string | number | bigint | null | Uint8Array;
type CapturedStatement = { sql: string; params: SqliteValue[] };

class SqliteD1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    private readonly params: SqliteValue[] = [],
    private readonly captured: CapturedStatement[] = [],
  ) {}

  bind(...params: unknown[]): SqliteD1PreparedStatement {
    return new SqliteD1PreparedStatement(
      this.database,
      this.sql,
      params.map((value) => (value === undefined ? null : value)) as SqliteValue[],
      this.captured,
    );
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: object }> {
    this.captured.push({ sql: this.sql, params: [...this.params] });
    const rows = this.database.prepare(this.sql).all(...this.params) as T[];
    return { results: rows, success: true, meta: {} };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number; duration: number } }> {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }
}

function createD1(database: DatabaseSync, captured: CapturedStatement[]): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1PreparedStatement(database, sql, [], captured);
    },
    batch: async (statements: SqliteD1PreparedStatement[]) => Promise.all(
      statements.map((statement) => statement.all()),
    ),
    exec: async (sql: string) => {
      database.exec(sql);
      return { count: 0, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

const PERIOD: ExecutiveDashboardPeriod = {
  startDate: '2026-07-12',
  endDate: '2026-07-12',
  label: '2026-07-12',
  preset: 'custom',
};

function createHarness(): { sqlite: DatabaseSync; d1: D1Database; captured: CapturedStatement[] } {
  const sqlite = new DatabaseSync(':memory:');
  const captured: CapturedStatement[] = [];
  sqlite.exec(`
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE users (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT,
      role TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE patients (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT,
      patient_code TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE doctors (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT,
      user_id INTEGER,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE visits (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER,
      patient_id INTEGER,
      visit_date TEXT,
      status TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE bills (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      invoice_no TEXT,
      patient_id INTEGER,
      visit_id INTEGER,
      admission_id INTEGER,
      referring_doctor_id INTEGER,
      status TEXT,
      total REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      paid REAL DEFAULT 0,
      due REAL DEFAULT 0,
      test_bill REAL DEFAULT 0,
      doctor_visit_bill REAL DEFAULT 0,
      admission_bill REAL DEFAULT 0,
      operation_bill REAL DEFAULT 0,
      medicine_bill REAL DEFAULT 0,
      discount_by_name TEXT,
      referred_by_name TEXT,
      discount_reason TEXT,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE invoice_items (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      item_category TEXT,
      description TEXT,
      reference_id INTEGER,
      quantity INTEGER DEFAULT 1,
      unit_price REAL DEFAULT 0,
      line_total REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE payments (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER,
      amount REAL NOT NULL,
      payment_method TEXT,
      receipt_no TEXT,
      received_by INTEGER,
      counter_session_id INTEGER,
      date TEXT,
      created_at TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE billing_deposits (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER,
      counter_id INTEGER,
      created_by INTEGER,
      amount REAL NOT NULL,
      transaction_type TEXT,
      deposit_receipt_no TEXT,
      created_at TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE billing_service_items (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_code TEXT,
      price REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE lab_orders (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER,
      bill_id INTEGER,
      ordered_by INTEGER,
      order_date TEXT,
      created_at TEXT,
      ordering_clinician_doctor_id INTEGER,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE lab_test_catalog (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      code TEXT,
      name TEXT,
      billing_service_item_id INTEGER,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE lab_order_items (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      lab_order_id INTEGER NOT NULL,
      lab_test_id INTEGER NOT NULL,
      test_name TEXT,
      accession_no TEXT,
      status TEXT,
      result_status TEXT,
      completed_at TEXT,
      verified_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER,
      patient_id INTEGER,
      bill_id INTEGER,
      lab_order_item_id INTEGER,
      lab_test_id INTEGER,
      source_type TEXT,
      incentive_type TEXT,
      commission_amount REAL DEFAULT 0,
      earned_commission_amount REAL DEFAULT 0,
      gross_amount REAL DEFAULT 0,
      commission_base_amount REAL DEFAULT 0,
      performer_reserve_amount REAL DEFAULT 0,
      commission_rate_bps INTEGER DEFAULT 0,
      commission_flat_amount REAL DEFAULT 0,
      doctor_waiver_amount REAL DEFAULT 0,
      payable_commission_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      reversed_amount REAL DEFAULT 0,
      clawback_amount REAL DEFAULT 0,
      settlement_id INTEGER,
      waiver_reason TEXT,
      status TEXT,
      accrued_date TEXT,
      created_at TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE diagnostic_performer_reserves (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      invoice_item_id INTEGER,
      assigned_doctor_id INTEGER,
      test_name TEXT,
      unit_service_amount REAL DEFAULT 0,
      unit_discount_amount REAL DEFAULT 0,
      net_unit_service_amount REAL DEFAULT 0,
      rule_rate_type TEXT,
      rule_rate_value REAL DEFAULT 0,
      reserved_amount REAL DEFAULT 0,
      settlement_id INTEGER,
      status TEXT,
      reserved_at TEXT,
      paid_at TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE doctor_commission_settlements (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      settlement_no TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE expenses (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      category TEXT,
      amount REAL DEFAULT 0,
      cash_movement_id INTEGER,
      payment_status TEXT,
      status TEXT,
      date TEXT,
      description TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE cash_drawer_movements (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      movement_type TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      amount REAL DEFAULT 0,
      payment_method TEXT,
      created_at TEXT,
      description TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE lab_consumables (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      code TEXT,
      name TEXT,
      unit TEXT,
      reorder_level REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE lab_test_consumable_map (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      lab_test_id INTEGER NOT NULL,
      consumable_id INTEGER NOT NULL,
      qty_per_test REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      deleted_at TEXT,
      effective_from TEXT,
      effective_to TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE lab_consumable_movements (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      consumable_id INTEGER NOT NULL,
      movement_type TEXT,
      quantity REAL DEFAULT 0,
      created_at TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE lab_consumable_stock (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      consumable_id INTEGER NOT NULL,
      quantity_available REAL DEFAULT 0,
      expiry_date TEXT,
      qc_status TEXT,
      PRIMARY KEY (tenant_id, id)
    );

    CREATE INDEX idx_bills_tenant_status_created
      ON bills(tenant_id, status, created_at, id);
    CREATE INDEX idx_payments_tenant_bill_receipt
      ON payments(tenant_id, bill_id, receipt_no);
    CREATE INDEX idx_payments_tenant_date_receiver
      ON payments(tenant_id, date, received_by);
    CREATE INDEX idx_invoice_items_bill ON invoice_items(bill_id);
    CREATE INDEX idx_invoice_items_tenant ON invoice_items(tenant_id);
    CREATE INDEX idx_lab_orders_date ON lab_orders(order_date);
    CREATE INDEX idx_lab_orders_tenant ON lab_orders(tenant_id);
    CREATE INDEX idx_lab_order_items_tenant_order
      ON lab_order_items(tenant_id, lab_order_id, id);
    CREATE INDEX idx_doctor_comm_accruals_tenant_status
      ON doctor_commission_accruals(tenant_id, status, accrued_date);
    CREATE INDEX idx_lab_test_cons_map_test ON lab_test_consumable_map(lab_test_id);
    CREATE INDEX idx_lab_test_cons_map_consumable ON lab_test_consumable_map(consumable_id);
    CREATE INDEX idx_lab_consumable_mov_consumable ON lab_consumable_movements(consumable_id);
    CREATE INDEX idx_lab_consumable_mov_date ON lab_consumable_movements(created_at);
    CREATE INDEX idx_lab_consumable_mov_tenant ON lab_consumable_movements(tenant_id);
    CREATE INDEX idx_lab_consumable_stock_consumable ON lab_consumable_stock(consumable_id);
    CREATE INDEX idx_lab_consumable_stock_tenant ON lab_consumable_stock(tenant_id);
  `);

  sqlite.exec(`
    INSERT INTO tenants VALUES ('tenant-a', 'Tenant A'), ('tenant-b', 'Tenant B');
    INSERT INTO users VALUES
      (1, 'tenant-a', 'Ordering Doctor A', 'doctor'),
      (1, 'tenant-b', 'Ordering Doctor B', 'doctor');
    INSERT INTO patients VALUES
      (1, 'tenant-a', 'Patient A', 'A-001'),
      (1, 'tenant-b', 'Patient B', 'B-001');
    INSERT INTO doctors VALUES
      (1, 'tenant-a', 'Dr A', 1),
      (1, 'tenant-b', 'Dr B', 1);
    INSERT INTO visits VALUES
      (1, 'tenant-a', 1, 1, '2026-07-12 08:00:00', 'completed'),
      (1, 'tenant-b', 1, 1, '2026-07-12 08:00:00', 'completed');

    INSERT INTO bills (
      id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
      total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
    ) VALUES
      (1, 'tenant-a', 'A-INV-1', 1, 1, 1, 'paid', 100, 100, 0, 60, 40, '2026-07-12 08:00:00', '2026-07-12 10:00:00'),
      (1, 'tenant-b', 'B-INV-1', 1, 1, 1, 'paid', 9999, 9999, 0, 9000, 999, '2026-07-12 08:00:00', '2026-07-12 10:00:00');
    INSERT INTO invoice_items VALUES
      (1, 'tenant-a', 1, 'consultation', 'Doctor Consultation', NULL, 1, 40, 40, 'active'),
      (2, 'tenant-a', 1, 'test', 'CBC', 1, 1, 60, 60, 'active'),
      (1, 'tenant-b', 1, 'consultation', 'Other Tenant Consultation', NULL, 1, 999, 999, 'active'),
      (2, 'tenant-b', 1, 'test', 'Other Tenant Test', 1, 1, 9000, 9000, 'active');
    INSERT INTO payments VALUES
      (1, 'tenant-a', 1, 100, 'cash', 'A-R-1', 1, NULL, '2026-07-12 10:00:00', '2026-07-12 10:00:00'),
      (1, 'tenant-b', 1, 9999, 'cash', 'B-R-1', 1, NULL, '2026-07-12 10:00:00', '2026-07-12 10:00:00');
    INSERT INTO billing_deposits VALUES
      (1, 'tenant-a', 1, NULL, 1, 30, 'deposit', 'A-DEP-1', '2026-07-12 11:00:00'),
      (1, 'tenant-b', 1, NULL, 1, 7777, 'deposit', 'B-DEP-1', '2026-07-12 11:00:00');

    INSERT INTO billing_service_items VALUES
      (1, 'tenant-a', 'CBC', 'CBC', 60, 1),
      (1, 'tenant-b', 'Other Tenant Secret Test', 'SECRET', 9000, 1);
    INSERT INTO lab_orders VALUES
      (1, 'tenant-a', 1, 1, 1, '2026-07-12 08:30:00', '2026-07-12 08:30:00', NULL),
      (1, 'tenant-b', 1, 1, 1, '2026-07-12 08:30:00', '2026-07-12 08:30:00', NULL);
    INSERT INTO lab_test_catalog VALUES
      (1, 'tenant-a', 'CBC', 'Complete Blood Count', 1),
      (1, 'tenant-b', 'SECRET', 'Other Tenant Secret Test', 1);
    INSERT INTO lab_order_items VALUES
      (1, 'tenant-a', 1, 1, 'CBC', 'A-ACC-1', 'verified', 'final', '2026-07-12 09:30:00', '2026-07-12 09:30:00', '2026-07-12 09:30:00'),
      (1, 'tenant-b', 1, 1, 'Other Tenant Secret Test', 'B-ACC-1', 'verified', 'final', '2026-07-12 09:30:00', '2026-07-12 09:30:00', '2026-07-12 09:30:00');

    INSERT INTO doctor_commission_accruals (
      id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
      source_type, commission_amount, earned_commission_amount, gross_amount,
      commission_base_amount, performer_reserve_amount, commission_rate_bps,
      commission_flat_amount, doctor_waiver_amount, payable_commission_amount,
      paid_amount, balance_amount, status, accrued_date, created_at
    ) VALUES
      (1, 'tenant-a', 1, 1, 1, NULL, NULL, 'consultation_fee', 10, 10, 40, 40, 0, 2500, 0, 0, 10, 0, 10, 'accrued', '2026-07-12', '2026-07-12'),
      (2, 'tenant-a', 1, 1, 1, 1, 1, 'lab_test', 6, 6, 60, 60, 0, 1000, 0, 0, 6, 0, 6, 'accrued', '2026-07-12', '2026-07-12'),
      (3, 'tenant-a', 1, 1, 1, NULL, NULL, 'procedure', 4, 0, 25, 25, 0, 0, 4, 0, 0, 0, 4, 'accrued', '2026-07-12', '2026-07-12'),
      (4, 'tenant-a', 1, 1, 1, NULL, NULL, 'referral', 500, 500, 500, 500, 0, 10000, 0, 0, 500, 0, 500, 'cancelled', '2026-07-12', '2026-07-12'),
      (1, 'tenant-b', 1, 1, 1, 1, 1, 'lab_test', 999, 999, 9999, 9999, 0, 1000, 0, 0, 999, 0, 999, 'accrued', '2026-07-12', '2026-07-12');

    INSERT INTO cash_drawer_movements VALUES
      (1, 'tenant-a', 'cash_out', 'doctor_payout', 1, 15, 'cash', '2026-07-12 12:00:00', 'July doctor settlement'),
      (2, 'tenant-a', 'cash_out', 'expense', 1, 20, 'cash', '2026-07-12 12:30:00', 'Utilities cash payment'),
      (1, 'tenant-b', 'cash_out', 'doctor_payout', 1, 8888, 'cash', '2026-07-12 12:00:00', 'Other Tenant Secret Payout');
    INSERT INTO expenses VALUES
      (1, 'tenant-a', 'Utilities', 10, 2, 'paid', 'approved', '2026-07-12', 'Electricity bill'),
      (2, 'tenant-a', 'Approved but unpaid', 999, NULL, 'unpaid', 'approved', '2026-07-12', 'Should stay excluded'),
      (3, 'tenant-a', 'Utilities', 5, 2, 'paid', 'approved', '2026-07-12', 'Generator fuel'),
      (4, 'tenant-a', 'Utilities', 5, 2, 'paid', 'approved', '2026-07-12', NULL),
      (1, 'tenant-b', 'Other tenant expense', 9999, NULL, 'paid', 'approved', '2026-07-12', 'Other Tenant Secret Expense');

    INSERT INTO lab_consumables VALUES
      (1, 'tenant-a', 'CBC-R', 'CBC Reagent', 'ml', 5, 1),
      (1, 'tenant-b', 'SECRET-R', 'Other Tenant Reagent', 'ml', 5, 1);
    INSERT INTO lab_test_consumable_map VALUES
      (1, 'tenant-a', 1, 1, 2, 1, NULL, NULL, NULL),
      (1, 'tenant-b', 1, 1, 100, 1, NULL, NULL, NULL);
    INSERT INTO lab_consumable_movements VALUES
      (1, 'tenant-a', 1, 'usage_out', 3, '2026-07-12 10:00:00'),
      (2, 'tenant-a', 1, 'return', 1, '2026-07-12 10:30:00'),
      (1, 'tenant-b', 1, 'usage_out', 999, '2026-07-12 10:00:00');
    INSERT INTO lab_consumable_stock VALUES
      (1, 'tenant-a', 1, 10, '2027-01-01', 'accepted'),
      (1, 'tenant-b', 1, 999, '2027-01-01', 'accepted');
  `);

  return { sqlite, d1: createD1(sqlite, captured), captured };
}

describe('executive dashboard analytics against production-shaped SQLite', () => {
  it('reconciles collection, expense, commission, doctor, test, and reagent panels without crossing tenants', async () => {
    const { sqlite, d1 } = createHarness();

    const [income, expense, commission, commissionBreakdown, doctors, tests, reagents] = await Promise.all([
      getIncomeServiceAnalysis({
        dbBinding: d1,
        tenantId: 'tenant-a',
        period: PERIOD,
        page: 1,
        pageSize: 25,
      }),
      getExpenseAnalysis({
        dbBinding: d1,
        tenantId: 'tenant-a',
        period: PERIOD,
        page: 1,
        pageSize: 25,
      }),
      getExecutiveCommissionTotals({
        dbBinding: d1,
        tenantId: 'tenant-a',
        startDate: PERIOD.startDate,
        endDate: PERIOD.endDate,
      }),
      getExecutiveCommissionBreakdown({
        dbBinding: d1,
        tenantId: 'tenant-a',
        startDate: PERIOD.startDate,
        endDate: PERIOD.endDate,
        metric: 'test_commission',
        page: { page: 1, pageSize: 25, offset: 0 },
      }),
      getDoctorPerformance({
        dbBinding: d1,
        tenantId: 'tenant-a',
        period: PERIOD,
        page: 1,
        pageSize: 25,
      }),
      getTestPerformance({
        dbBinding: d1,
        tenantId: 'tenant-a',
        period: PERIOD,
        page: 1,
        pageSize: 25,
      }),
      getReagentReconciliation({
        dbBinding: d1,
        tenantId: 'tenant-a',
        period: PERIOD,
        page: 1,
        pageSize: 25,
      }),
    ]);

    const depositRow = sqlite.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM billing_deposits
      WHERE tenant_id = ?
        AND transaction_type = 'deposit'
        AND date(created_at) BETWEEN date(?) AND date(?)
    `).get('tenant-a', PERIOD.startDate, PERIOD.endDate) as { amount: number };

    const serviceCollections = income.totals.collection;
    const deposits = Number(depositRow.amount);
    const totalCollection = serviceCollections + deposits;
    const paidOperatingExpenses = expense.rows
      .filter((row) => row.category !== 'Doctor payouts')
      .reduce((sum, row) => sum + row.paidAmount, 0);
    const doctorPayouts = expense.rows
      .filter((row) => row.category === 'Doctor payouts')
      .reduce((sum, row) => sum + row.paidAmount, 0);
    const totalExpense = expense.totals.paidAmount;
    const netIncome = totalCollection - totalExpense;

    expect(serviceCollections).toBe(100);
    expect(deposits).toBe(30);
    expect(totalCollection).toBe(serviceCollections + deposits);
    expect(paidOperatingExpenses).toBe(20);
    expect(doctorPayouts).toBe(15);
    expect(totalExpense).toBe(paidOperatingExpenses + doctorPayouts);
    expect(netIncome).toBe(totalCollection - totalExpense);

    expect(commission).toEqual({
      visit_commission: 10,
      test_commission: 6,
      other_doctor_commission: 4,
      total_commission: 20,
    });
    expect(commission.total_commission).toBe(
      commission.visit_commission + commission.test_commission + commission.other_doctor_commission,
    );
    expect(commissionBreakdown).toMatchObject({
      total: 6,
      totalRows: 1,
      sources: [{ label: 'Dr A', amount: 6, count: 1 }],
    });

    expect(doctors.totals.tests).toBe(tests.rows.reduce((sum, row) => sum + row.quantity, 0));
    expect(doctors.rows).toEqual([
      expect.objectContaining({
        doctorId: 1,
        doctorName: 'Dr A',
        visits: 1,
        visitCollection: 40,
        tests: 1,
        testCollection: 60,
        totalCommission: 20,
      }),
    ]);
    expect(tests.rows).toEqual([
      expect.objectContaining({
        testId: 1,
        testCode: 'CBC',
        testName: 'CBC',
        quantity: 1,
        billed: 60,
        collected: 60,
        due: 0,
        testCommission: 6,
      }),
    ]);

    expect(income.rows.map((row) => row.serviceName).sort()).toEqual(['CBC', 'Doctor Consultation']);
    expect(expense.rows).toHaveLength(4);
    expect(expense.totalRows).toBe(4);
    expect(expense.totals).toEqual({ transactions: 4, paidAmount: 35 });
    expect(expense.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'expense-1',
        category: 'Utilities',
        detail: 'Electricity bill',
        paidAmount: 10,
        paymentMethod: 'cash',
        status: 'paid',
      }),
      expect.objectContaining({
        id: 'expense-3',
        category: 'Utilities',
        detail: 'Generator fuel',
        paidAmount: 5,
      }),
      expect.objectContaining({
        id: 'expense-4',
        category: 'Utilities',
        detail: 'No description provided',
        paidAmount: 5,
      }),
      expect.objectContaining({
        id: 'doctor-payout-1',
        category: 'Doctor payouts',
        detail: 'July doctor settlement',
        paidAmount: 15,
        paymentMethod: 'cash',
        status: 'paid',
      }),
    ]));
    const expensePage = await getExpenseAnalysis({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      page: 1,
      pageSize: 2,
    });
    expect(expensePage.rows).toHaveLength(2);
    expect(expensePage.totalRows).toBe(4);
    expect(expensePage.hasNextPage).toBe(true);
    expect(reagents.rows).toEqual([
      expect.objectContaining({
        consumableId: 1,
        reagentCode: 'CBC-R',
        reagentName: 'CBC Reagent',
        unit: 'ml',
        completedTests: 1,
        expectedUsage: 2,
        actualUsage: 2,
        returnedQuantity: 1,
        variance: 0,
        currentStock: 10,
        status: 'ok',
      }),
    ]);

    const serialized = JSON.stringify({ income, expense, commission, doctors, tests, reagents });
    expect(serialized).not.toContain('Tenant B');
    expect(serialized).not.toContain('Other Tenant');
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('9999');
  });

  it('excludes commission accruals attached to unpaid or reopened bills until they are fully paid', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO bills (
        id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
        total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
      ) VALUES
        (4, 'tenant-a', 'A-INV-UNPAID-COMMISSION', 1, NULL, 1, 'open', 700, 0, 700, 700, 0, '2026-07-12 14:00:00', '2026-07-12 14:00:00');

      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, payable_commission_amount,
        paid_amount, balance_amount, status, accrued_date, created_at
      ) VALUES
        (30, 'tenant-a', 1, 1, 4, NULL, 1, 'lab_test', 175, 175, 700, 700, 0, 2500, 0, 0, 175, 0, 175, 'accrued', '2026-07-12', '2026-07-12 14:00:00');
    `);

    const unpaidTotals = await getExecutiveCommissionTotals({
      dbBinding: d1,
      tenantId: 'tenant-a',
      startDate: PERIOD.startDate,
      endDate: PERIOD.endDate,
    });
    const unpaidBreakdown = await getExecutiveCommissionBreakdown({
      dbBinding: d1,
      tenantId: 'tenant-a',
      startDate: PERIOD.startDate,
      endDate: PERIOD.endDate,
      metric: 'test_commission',
      page: { page: 1, pageSize: 25, offset: 0 },
    });

    expect(unpaidTotals).toEqual({
      visit_commission: 10,
      test_commission: 6,
      other_doctor_commission: 4,
      total_commission: 20,
    });
    expect(unpaidBreakdown).toMatchObject({ total: 6, totalRows: 1 });
    expect(unpaidBreakdown.rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reference_no: 'A-INV-UNPAID-COMMISSION' }),
    ]));

    sqlite.exec(`
      UPDATE bills
      SET status = 'paid', paid = 700, due = 0
      WHERE tenant_id = 'tenant-a' AND id = 4;
    `);

    const paidTotals = await getExecutiveCommissionTotals({
      dbBinding: d1,
      tenantId: 'tenant-a',
      startDate: PERIOD.startDate,
      endDate: PERIOD.endDate,
    });
    const paidBreakdown = await getExecutiveCommissionBreakdown({
      dbBinding: d1,
      tenantId: 'tenant-a',
      startDate: PERIOD.startDate,
      endDate: PERIOD.endDate,
      metric: 'test_commission',
      page: { page: 1, pageSize: 25, offset: 0 },
    });

    expect(paidTotals).toEqual({
      visit_commission: 10,
      test_commission: 181,
      other_doctor_commission: 4,
      total_commission: 195,
    });
    expect(paidBreakdown).toMatchObject({ total: 181, totalRows: 2 });
    expect(paidBreakdown.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reference_no: 'A-INV-UNPAID-COMMISSION',
        amount: 175,
        paid_amount: 700,
        due_amount: 0,
      }),
    ]));
  });

  it('groups test commission as one doctor-by-invoice row and applies the doctor filter', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO patients VALUES (2, 'tenant-a', 'Wrong Accrual Patient', 'P-WRONG');
      INSERT INTO doctors VALUES (2, 'tenant-a', 'Dr B', NULL);
      INSERT INTO billing_service_items VALUES (2, 'tenant-a', 'Lipid Profile', 'LIPID', 40, 1);
      INSERT INTO lab_test_catalog VALUES (2, 'tenant-a', 'LIPID', 'Lipid Profile', 2);
      INSERT INTO lab_order_items VALUES
        (2, 'tenant-a', 1, 2, 'Lipid Profile', 'A-ACC-2', 'verified', 'final', '2026-07-12 09:40:00', '2026-07-12 09:40:00', '2026-07-12 09:40:00');
      INSERT INTO invoice_items VALUES
        (3, 'tenant-a', 1, 'test', 'Lipid Profile', 2, 1, 40, 40, 'active');
      UPDATE bills
      SET total = 140, paid = 140, due = 0, test_bill = 100
      WHERE tenant_id = 'tenant-a' AND id = 1;
      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, payable_commission_amount,
        paid_amount, balance_amount, status, accrued_date, created_at
      ) VALUES
        (10, 'tenant-a', 1, 2, 1, 2, 2, 'lab_test', 4, 4, 40, 40, 0, 1000, 0, 0, 4, 0, 4, 'approved', '2026-07-12', '2026-07-12 09:40:00'),
        (11, 'tenant-a', 2, 1, 1, 1, 1, 'lab_test', 20, 20, 60, 60, 0, 1000, 0, 0, 20, 0, 20, 'approved', '2026-07-12', '2026-07-12 09:45:00');
    `);

    await expect(getExecutiveCommissionBreakdown({
      dbBinding: d1,
      tenantId: 'tenant-a',
      startDate: PERIOD.startDate,
      endDate: PERIOD.endDate,
      metric: 'test_commission',
      doctorId: 0,
      page: { page: 1, pageSize: 25, offset: 0 },
    })).rejects.toThrow('doctorId must be a positive integer');

    const breakdown = await getExecutiveCommissionBreakdown({
      dbBinding: d1,
      tenantId: 'tenant-a',
      startDate: PERIOD.startDate,
      endDate: PERIOD.endDate,
      metric: 'test_commission',
      doctorId: 1,
      page: { page: 1, pageSize: 25, offset: 0 },
    });

    expect(breakdown).toMatchObject({
      total: 10,
      totalRows: 1,
      sources: [{ label: 'Dr A', amount: 10, count: 1, key: '1', doctorId: 1 }],
    });
    expect(breakdown.rows).toEqual([
      expect.objectContaining({
        id: 'commission-invoice-1-bill-1',
        bill_id: 1,
        invoice_no: 'A-INV-1',
        patient_name: 'Patient A',
        service_names: 'CBC, Lipid Profile',
        item_count: 2,
        amount: 10,
        gross_amount: 140,
        discount_amount: 0,
        net_amount: 140,
        paid_amount: 140,
        due_amount: 0,
      }),
    ]);
  });

  it('keeps a no-bill commission accrual as a traceable fallback row', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      DELETE FROM doctor_commission_accruals;
      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, payable_commission_amount,
        paid_amount, balance_amount, status, accrued_date, created_at
      ) VALUES
        (20, 'tenant-a', 1, 1, NULL, NULL, 1, 'lab_test', 5, 5, 50, 50, 0, 1000, 0, 0, 5, 0, 5, 'approved', '2026-07-12', '2026-07-12 10:00:00');
    `);

    const breakdown = await getExecutiveCommissionBreakdown({
      dbBinding: d1,
      tenantId: 'tenant-a',
      startDate: PERIOD.startDate,
      endDate: PERIOD.endDate,
      metric: 'test_commission',
      doctorId: 1,
      page: { page: 1, pageSize: 25, offset: 0 },
    });

    expect(breakdown).toMatchObject({
      total: 5,
      totalRows: 1,
      sources: [{ label: 'Dr A', amount: 5, count: 1, key: '1', doctorId: 1 }],
    });
    expect(breakdown.rows).toEqual([
      expect.objectContaining({
        id: 'commission-invoice-1-accrual-20',
        reference_no: 'ACCRUAL-20',
        bill_id: null,
        invoice_no: null,
        patient_name: 'Patient A',
        service_names: 'Complete Blood Count',
        item_count: 1,
        gross_amount: 50,
        discount_amount: 0,
        net_amount: 50,
        paid_amount: 0,
        due_amount: 5,
      }),
    ]);
  });

  it('uses payable commission for KPI totals and doctor-wise drilldown after a full doctor waiver', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, payable_commission_amount,
        paid_amount, balance_amount, status, accrued_date, created_at
      ) VALUES
        (5, 'tenant-a', 1, 1, 1, 1, 1, 'lab_test', 0, 100, 700, 400, 200, 2500, 0, 100, 0, 0, 0, 'accrued', '2026-07-12', '2026-07-12');
    `);

    const [totals, breakdown] = await Promise.all([
      getExecutiveCommissionTotals({
        dbBinding: d1,
        tenantId: 'tenant-a',
        startDate: PERIOD.startDate,
        endDate: PERIOD.endDate,
      }),
      getExecutiveCommissionBreakdown({
        dbBinding: d1,
        tenantId: 'tenant-a',
        startDate: PERIOD.startDate,
        endDate: PERIOD.endDate,
        metric: 'test_commission',
        page: { page: 1, pageSize: 25, offset: 0 },
      }),
    ]);

    expect(totals).toEqual({
      visit_commission: 10,
      test_commission: 6,
      other_doctor_commission: 4,
      total_commission: 20,
    });
    expect(breakdown).toMatchObject({
      total: 6,
      totalRows: 1,
      sources: [{ label: 'Dr A', amount: 6, count: 1, key: '1', doctorId: 1 }],
    });
    expect(breakdown.rows).toEqual([
      expect.objectContaining({
        id: 'commission-invoice-1-bill-1',
        amount: 6,
        service_names: 'CBC',
        item_count: 1,
      }),
    ]);

    const doctorPerformance = await getDoctorPerformance({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      page: 1,
      pageSize: 25,
    });
    expect(doctorPerformance.rows.find((row) => row.doctorId === 1)).toMatchObject({
      earnedCommission: 120,
      doctorWaiver: 100,
      payableCommission: 20,
      paidCommission: 0,
      outstandingCommission: 20,
    });

    const details = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 1,
      tab: 'commissions',
      page: 1,
      pageSize: 1,
    });
    expect(details.summary).toMatchObject({
      referredTests: 1,
      earnedCommission: 120,
      doctorWaiver: 100,
      payableCommission: 20,
      paidCommission: 0,
      outstandingCommission: 20,
    });
    expect(details.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 5,
        grossAmount: 700,
        discountAmount: 100,
        performerReserveAmount: 200,
        commissionBaseAmount: 400,
        earnedAmount: 100,
        waiverAmount: 100,
        payableAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
      }),
    ]));

    const referredTests = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 1,
      tab: 'referred-tests',
      page: 1,
      pageSize: 25,
    });
    expect(referredTests.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 1,
        testCommission: 106,
        earnedAmount: 106,
        waiverAmount: 100,
        payableAmount: 6,
      }),
    ]));
  });

  it('aggregates payable commission and doctor waiver across every paid diagnostic invoice in the date range', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO bills (
        id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
        total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
      ) VALUES
        (2, 'tenant-a', 'A-INV-2', 1, 1, 1, 'paid', 2600, 2600, 0, 2600, 0, '2026-07-12 12:00:00', '2026-07-12 12:00:00'),
        (3, 'tenant-a', 'A-INV-3', 1, 1, 1, 'paid', 2100, 2100, 0, 2100, 0, '2026-07-12 13:00:00', '2026-07-12 13:00:00');
      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, incentive_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, payable_commission_amount,
        paid_amount, balance_amount, status, accrued_date, created_at
      ) VALUES
        (20, 'tenant-a', 1, 1, 2, NULL, 1, 'lab_test', 'prescriber', 625, 625, 2600, 2500, 0, 2500, 0, 0, 625, 0, 625, 'accrued', '2026-07-12', '2026-07-12 12:00:00'),
        (21, 'tenant-a', 1, 1, 3, NULL, 1, 'lab_test', 'prescriber', 425, 425, 2100, 1700, 0, 2500, 0, 340, 85, 0, 85, 'accrued', '2026-07-12', '2026-07-12 13:00:00');
    `);

    const performance = await getDoctorPerformance({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      page: 1,
      pageSize: 25,
    });

    expect(performance.rows.find((row) => row.doctorId === 1)).toMatchObject({
      visitCommission: 10,
      referrerCommission: 716,
      earnedCommission: 1070,
      doctorWaiver: 340,
      payableCommission: 730,
      outstandingCommission: 730,
    });
  });

  it('keeps the linked test name visible for referral-source compensation rows', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      UPDATE doctor_commission_accruals
      SET source_type = 'referral'
      WHERE tenant_id = 'tenant-a' AND id = 2;
    `);

    const details = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 1,
      tab: 'commissions',
      page: 1,
      pageSize: 25,
    });

    expect(details.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 2,
        sourceType: 'referral',
        detailName: 'CBC',
        referenceNo: 'A-INV-1',
      }),
    ]));
  });

  it('separates referrer commission from performer reserves and keeps unassigned reserves unassigned', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO doctors VALUES
        (10, 'tenant-a', 'Dr Noorsali', NULL);
      INSERT INTO visits VALUES
        (10, 'tenant-a', 10, 1, '2026-07-12 08:00:00', 'completed');
      INSERT INTO bills (
        id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
        total, discount, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
      ) VALUES
        (100, 'tenant-a', 'A-VISIT-100', 1, 10, NULL, 'paid', 200, 0, 200, 0, 0, 200, '2026-07-12 08:00:00', '2026-07-12 08:05:00'),
        (101, 'tenant-a', 'A-USG-101', 1, NULL, 10, 'paid', 1000, 0, 1000, 0, 1000, 0, '2026-07-12 09:00:00', '2026-07-12 09:05:00'),
        (102, 'tenant-a', 'A-USG-102', 1, NULL, 10, 'paid', 0, 700, 0, 0, 0, 0, '2026-07-12 10:00:00', '2026-07-12 10:05:00'),
        (103, 'tenant-a', 'A-USG-103', 1, NULL, 10, 'paid', 450, 0, 450, 0, 450, 0, '2026-07-12 11:00:00', '2026-07-12 11:05:00'),
        (104, 'tenant-a', 'A-USG-104', 1, NULL, 10, 'paid', 350, 0, 350, 0, 350, 0, '2026-07-12 12:00:00', '2026-07-12 12:05:00'),
        (105, 'tenant-a', 'A-USG-105', 1, NULL, NULL, 'paid', 650, 0, 650, 0, 650, 0, '2026-07-12 13:00:00', '2026-07-12 13:05:00'),
        (106, 'tenant-a', 'A-DIRECT-106', 1, NULL, 10, 'paid', 500, 100, 500, 0, 500, 0, '2026-07-12 14:00:00', '2026-07-12 14:05:00');
      INSERT INTO lab_orders VALUES
        (101, 'tenant-a', 1, 101, 1, '2026-07-12 09:00:00', '2026-07-12 09:00:00', NULL),
        (102, 'tenant-a', 1, 102, 1, '2026-07-12 10:00:00', '2026-07-12 10:00:00', NULL),
        (103, 'tenant-a', 1, 103, 1, '2026-07-12 11:00:00', '2026-07-12 11:00:00', NULL),
        (104, 'tenant-a', 1, 104, 1, '2026-07-12 12:00:00', '2026-07-12 12:00:00', NULL),
        (105, 'tenant-a', 1, 105, 1, '2026-07-12 13:00:00', '2026-07-12 13:00:00', NULL);
      INSERT INTO lab_order_items VALUES
        (101, 'tenant-a', 101, 1, 'USG 101', 'ACC-101', 'completed', 'final', NULL, NULL, '2026-07-12 09:30:00'),
        (102, 'tenant-a', 102, 1, 'USG 102', 'ACC-102', 'completed', 'final', NULL, NULL, '2026-07-12 10:30:00'),
        (103, 'tenant-a', 103, 1, 'USG 103', 'ACC-103', 'completed', 'final', NULL, NULL, '2026-07-12 11:30:00'),
        (104, 'tenant-a', 104, 1, 'USG 104', 'ACC-104', 'completed', 'final', NULL, NULL, '2026-07-12 12:30:00'),
        (105, 'tenant-a', 105, 1, 'USG 105', 'ACC-105', 'completed', 'final', NULL, NULL, '2026-07-12 13:30:00');
      INSERT INTO invoice_items VALUES
        (100, 'tenant-a', 100, 'consultation', 'Visit', 10, 1, 200, 200, 'active'),
        (101, 'tenant-a', 101, 'test', 'USG 101', 101, 1, 1000, 1000, 'active'),
        (102, 'tenant-a', 102, 'test', 'USG 102', 102, 1, 700, 0, 'active'),
        (103, 'tenant-a', 103, 'test', 'USG 103', 103, 1, 450, 450, 'active'),
        (104, 'tenant-a', 104, 'test', 'USG 104', 104, 1, 350, 350, 'active'),
        (105, 'tenant-a', 105, 'test', 'USG 105', 105, 1, 650, 650, 'active'),
        (106, 'tenant-a', 106, 'test', 'Direct Test 106', NULL, 1, 600, 500, 'active');
      INSERT INTO payments VALUES
        (100, 'tenant-a', 100, 200, 'cash', 'R-100', 1, NULL, '2026-07-12 08:05:00', '2026-07-12 08:05:00'),
        (101, 'tenant-a', 101, 1000, 'cash', 'R-101', 1, NULL, '2026-07-12 09:05:00', '2026-07-12 09:05:00'),
        (103, 'tenant-a', 103, 450, 'cash', 'R-103', 1, NULL, '2026-07-12 11:05:00', '2026-07-12 11:05:00'),
        (104, 'tenant-a', 104, 350, 'cash', 'R-104', 1, NULL, '2026-07-12 12:05:00', '2026-07-12 12:05:00'),
        (105, 'tenant-a', 105, 650, 'cash', 'R-105', 1, NULL, '2026-07-12 13:05:00', '2026-07-12 13:05:00'),
        (106, 'tenant-a', 106, 500, 'cash', 'R-106', 1, NULL, '2026-07-12 14:05:00', '2026-07-12 14:05:00');
      INSERT INTO diagnostic_performer_reserves
        (
          id, tenant_id, bill_id, invoice_item_id, assigned_doctor_id, test_name,
          unit_service_amount, unit_discount_amount, net_unit_service_amount,
          rule_rate_type, rule_rate_value, reserved_amount, status, reserved_at, paid_at
        )
      VALUES
        (101, 'tenant-a', 101, 101, 10, 'USG 101', 1000, 0, 1000, 'flat', 200, 200, 'paid', '2026-07-12 09:00:00', '2026-07-12 14:00:00'),
        (102, 'tenant-a', 102, 102, 10, 'USG 102', 700, 700, 0, 'flat', 200, 200, 'reserved', '2026-07-12 10:00:00', NULL),
        (103, 'tenant-a', 103, 103, 10, 'USG 103', 450, 0, 450, 'flat', 200, 200, 'reserved', '2026-07-12 11:00:00', NULL),
        (104, 'tenant-a', 104, 104, 10, 'USG 104', 350, 0, 350, 'flat', 200, 200, 'reserved', '2026-07-12 12:00:00', NULL),
        (105, 'tenant-a', 105, 105, NULL, 'USG 105', 650, 0, 650, 'flat', 200, 200, 'reserved', '2026-07-12 13:00:00', NULL);
      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, incentive_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, paid_amount, balance_amount,
        status, accrued_date, created_at
      ) VALUES
        (100, 'tenant-a', 10, 1, 100, NULL, NULL, 'consultation_fee', 'performer', 200, 200, 200, 200, 0, 0, 200, 0, 0, 200, 'accrued', '2026-07-12', '2026-07-12'),
        (101, 'tenant-a', 10, 1, 101, 101, 1, 'lab_test', 'prescriber', 200, 200, 1000, 800, 200, 2500, 0, 0, 0, 200, 'accrued', '2026-07-12', '2026-07-12'),
        (102, 'tenant-a', 10, 1, 101, 101, 1, 'lab_test', 'performer', 200, 200, 200, 200, 200, 0, 200, 0, 200, 0, 'paid', '2026-07-12', '2026-07-12'),
        (103, 'tenant-a', 10, 1, 103, 103, 1, 'lab_test', 'prescriber', 62.5, 62.5, 450, 250, 200, 2500, 0, 0, 0, 62.5, 'accrued', '2026-07-12', '2026-07-12'),
        (104, 'tenant-a', 10, 1, 104, 104, 1, 'lab_test', 'prescriber', 37.5, 37.5, 350, 150, 200, 2500, 0, 0, 0, 37.5, 'accrued', '2026-07-12', '2026-07-12');
    `);

    const result = await getDoctorPerformance({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      page: 1,
      pageSize: 25,
    });

    const noorsali = result.rows.find((row) => row.doctorId === 10);
    const unassigned = result.rows.find((row) => row.doctorId === null);

    expect(noorsali).toMatchObject({
      visitCommission: 200,
      referredTests: 5,
      discountedTests: 2,
      testGrossAmount: 3100,
      testDiscountAmount: 800,
      testCollection: 2300,
      referrerCommission: 300,
      performedTests: 4,
      performerReserveCount: 4,
      performerReserve: 800,
      testCommission: 1100,
      earnedCommission: 1300,
      doctorWaiver: 0,
      payableCommission: 1300,
      paidCommission: 200,
      outstandingCommission: 1100,
      totalCommission: 1300,
    });
    expect(unassigned).toMatchObject({
      performedTests: 1,
      performerReserveCount: 1,
      performerReserve: 200,
      testCommission: 200,
      earnedCommission: 200,
      doctorWaiver: 0,
      payableCommission: 200,
      paidCommission: 0,
      outstandingCommission: 200,
      totalCommission: 200,
    });

    const assignedCommissionDetails = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 10,
      tab: 'commissions',
      page: 1,
      pageSize: 25,
    });
    const unassignedCommissionDetails = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: null,
      tab: 'commissions',
      page: 1,
      pageSize: 25,
    });
    const referredTestDetails = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 10,
      tab: 'tests',
      page: 1,
      pageSize: 25,
    });
    const explicitReferredTestDetails = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 10,
      tab: 'referred-tests' as never,
      page: 1,
      pageSize: 25,
    });
    const performedTestDetails = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 10,
      tab: 'performed-tests' as never,
      page: 1,
      pageSize: 25,
    });

    expect(referredTestDetails.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 102,
        grossAmount: 700,
        discountAmount: 700,
        netBilledAmount: 0,
      }),
      expect.objectContaining({
        id: -106,
        testName: 'Direct Test 106',
        grossAmount: 600,
        discountAmount: 100,
        netBilledAmount: 500,
      }),
    ]));
    expect(explicitReferredTestDetails.rows.map((row) => Number(row.id)).sort((a, b) => a - b))
      .toEqual(referredTestDetails.rows.map((row) => Number(row.id)).sort((a, b) => a - b));
    expect(performedTestDetails.rows
      .filter((row) => 'testName' in row)
      .map((row) => Number(row.id))
      .sort((a, b) => a - b))
      .toEqual([101, 102, 103, 104]);
    expect(performedTestDetails.rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 105 }),
      expect.objectContaining({ id: -106 }),
    ]));
    expect(assignedCommissionDetails.rows.filter((row) => (
      'sourceType' in row && row.sourceType === 'performer_reserve'
    ))).toHaveLength(4);
    expect(assignedCommissionDetails.rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'lab_test', incentiveType: 'performer' }),
    ]));
    expect(unassignedCommissionDetails.rows).toEqual([
      expect.objectContaining({
        sourceType: 'performer_reserve',
        incentiveType: 'performer',
        amount: 200,
        status: 'reserved',
      }),
    ]);
  });

  it('separates referring, ordering clinician, entered-by, and performing doctor identities', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO users VALUES
        (7, 'tenant-a', 'Reception User', 'reception'),
        (8, 'tenant-a', 'Clinician User', 'doctor'),
        (9, 'tenant-a', 'Performer User', 'doctor');
      INSERT INTO doctors VALUES
        (2, 'tenant-a', 'Dr Clinician', 8),
        (3, 'tenant-a', 'Dr Performer', 9);
      UPDATE lab_orders
      SET ordered_by = 7,
          ordering_clinician_doctor_id = NULL
      WHERE tenant_id = 'tenant-a' AND id = 1;
      INSERT INTO diagnostic_performer_reserves (
        id, tenant_id, bill_id, invoice_item_id, assigned_doctor_id, test_name,
        unit_service_amount, unit_discount_amount, net_unit_service_amount,
        rule_rate_type, rule_rate_value, reserved_amount, status, reserved_at
      ) VALUES
        (70, 'tenant-a', 1, 2, 3, 'CBC', 60, 0, 60, 'flat', 5, 5, 'reserved', '2026-07-12 09:00:00');
    `);

    const withoutClinician = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 1,
      tab: 'tests',
      page: 1,
      pageSize: 25,
    });
    const firstRow = withoutClinician.rows.find((row) => 'testName' in row && row.testName === 'CBC');

    expect(firstRow).toMatchObject({
      referringDoctorName: 'Dr A',
      orderingClinicianId: null,
      orderingClinicianName: null,
      enteredByUserId: 7,
      enteredByName: 'Reception User',
      performingDoctorId: 3,
      performingDoctorName: 'Dr Performer',
    });

    sqlite.exec(`
      UPDATE lab_orders
      SET ordering_clinician_doctor_id = 2
      WHERE tenant_id = 'tenant-a' AND id = 1;
    `);

    const withClinician = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 1,
      tab: 'tests',
      page: 1,
      pageSize: 25,
    });
    const secondRow = withClinician.rows.find((row) => 'testName' in row && row.testName === 'CBC');

    expect(secondRow).toMatchObject({
      orderingClinicianId: 2,
      orderingClinicianName: 'Dr Clinician',
      enteredByUserId: 7,
      enteredByName: 'Reception User',
      performingDoctorId: 3,
      performingDoctorName: 'Dr Performer',
    });
  });

  it('attributes paid visit and test amounts from bill-level commission doctors when lab item links are absent', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO doctors VALUES
        (2, 'tenant-a', 'Dr Visit Commission', NULL),
        (3, 'tenant-a', 'Dr Test Commission', NULL);
      INSERT INTO visits VALUES
        (2, 'tenant-a', 2, 1, '2026-07-12 15:00:00', 'completed');
      INSERT INTO bills (
        id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
        total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
      ) VALUES
        (20, 'tenant-a', 'A-INV-20', 1, NULL, NULL, 'paid', 100, 100, 0, 60, 40, '2026-07-12 14:00:00', '2026-07-12 14:05:00'),
        (21, 'tenant-a', 'A-INV-21', 1, 2, NULL, 'paid', 60, 60, 0, 60, 0, '2026-07-12 15:00:00', '2026-07-12 15:05:00'),
        (22, 'tenant-a', 'A-INV-22', 1, NULL, 3, 'paid', 0, 0, 0, 0, 0, '2026-07-12 16:00:00', '2026-07-12 16:00:00');
      INSERT INTO invoice_items VALUES
        (20, 'tenant-a', 20, 'consultation', 'Consultation', NULL, 1, 40, 40, 'active'),
        (21, 'tenant-a', 20, 'test', 'Legacy test', 1, 1, 60, 60, 'active'),
        (22, 'tenant-a', 21, 'test', 'Visit fallback test', 1, 1, 60, 60, 'active');
      INSERT INTO payments VALUES
        (20, 'tenant-a', 20, 100, 'cash', 'A-R-20', 1, NULL, '2026-07-12 14:05:00', '2026-07-12 14:05:00'),
        (21, 'tenant-a', 21, 60, 'cash', 'A-R-21', 1, NULL, '2026-07-12 15:05:00', '2026-07-12 15:05:00');
      INSERT INTO lab_orders VALUES
        (22, 'tenant-a', 1, 22, 1, '2026-07-12 16:00:00', '2026-07-12 16:00:00', NULL);
      INSERT INTO lab_order_items VALUES
        (22, 'tenant-a', 22, 1, 'Lab-only test', 'A-ACC-22', 'completed', 'final', '2026-07-12 16:20:00', '2026-07-12 16:25:00', '2026-07-12 16:25:00');
      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, paid_amount, balance_amount,
        status, accrued_date, created_at
      ) VALUES
        (20, 'tenant-a', 2, 1, 20, NULL, NULL, 'consultation_fee', 4, 4, 40, 40, 0, 1000, 0, 0, 0, 4, 'accrued', '2026-07-12', '2026-07-12'),
        (21, 'tenant-a', 3, 1, 20, NULL, 1, 'lab_test', 6, 6, 60, 60, 0, 1000, 0, 0, 0, 6, 'accrued', '2026-07-12', '2026-07-12');
    `);

    const result = await getDoctorPerformance({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      page: 1,
      pageSize: 25,
    });

    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ doctorId: 2, visitCollection: 40, testCollection: 60 }),
      expect.objectContaining({ doctorId: 3, testCollection: 60 }),
    ]));

    const visitDetails = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 2,
      tab: 'visits',
      page: 1,
      pageSize: 25,
    });
    const testDetails = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 3,
      tab: 'tests',
      page: 1,
      pageSize: 25,
    });
    const visitFallbackTestDetails = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 2,
      tab: 'tests',
      page: 1,
      pageSize: 25,
    });

    expect(visitDetails.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ collectedAmount: 40 }),
    ]));
    expect(testDetails.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ testName: 'Legacy test', collectedAmount: 60 }),
      expect.objectContaining({ testName: 'Lab-only test', collectedAmount: 0 }),
    ]));
    expect(visitFallbackTestDetails.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ testName: 'Visit fallback test', collectedAmount: 60 }),
    ]));
  });

  it('counts consultation bills per resolved doctor even when the linked visit date is stale', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO doctors VALUES
        (4, 'tenant-a', 'Dr Consultation One', NULL),
        (5, 'tenant-a', 'Dr Consultation Two', NULL);
      INSERT INTO visits VALUES
        (30, 'tenant-a', 4, 1, '2026-07-11 09:00:00', 'completed');
      INSERT INTO bills (
        id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
        total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
      ) VALUES
        (30, 'tenant-a', 'A-INV-30', 1, 30, NULL, 'paid', 40, 40, 0, 0, 40, '2026-07-12 09:00:00', '2026-07-12 09:05:00'),
        (31, 'tenant-a', 'A-INV-31', 1, 30, NULL, 'paid', 50, 50, 0, 0, 50, '2026-07-12 10:00:00', '2026-07-12 10:05:00');
      INSERT INTO invoice_items VALUES
        (30, 'tenant-a', 30, 'consultation', 'Consultation one', NULL, 1, 40, 40, 'active'),
        (31, 'tenant-a', 31, 'consultation', 'Consultation two', NULL, 1, 50, 50, 'active');
      INSERT INTO payments VALUES
        (30, 'tenant-a', 30, 40, 'cash', 'A-R-30', 1, NULL, '2026-07-12 09:05:00', '2026-07-12 09:05:00'),
        (31, 'tenant-a', 31, 50, 'cash', 'A-R-31', 1, NULL, '2026-07-12 10:05:00', '2026-07-12 10:05:00');
      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, paid_amount, balance_amount,
        status, accrued_date, created_at
      ) VALUES
        (30, 'tenant-a', 4, 1, 30, NULL, NULL, 'consultation_fee', 4, 4, 40, 40, 0, 1000, 0, 0, 0, 4, 'accrued', '2026-07-12', '2026-07-12'),
        (31, 'tenant-a', 5, 1, 31, NULL, NULL, 'consultation_fee', 5, 5, 50, 50, 0, 1000, 0, 0, 0, 5, 'accrued', '2026-07-12', '2026-07-12');
    `);

    const result = await getDoctorPerformance({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      page: 1,
      pageSize: 25,
    });

    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ doctorId: 4, visits: 1, visitCollection: 40 }),
      expect.objectContaining({ doctorId: 5, visits: 1, visitCollection: 50 }),
    ]));

    const details = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 4,
      tab: 'visits',
      page: 1,
      pageSize: 25,
    });
    expect(details.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        invoiceNo: 'A-INV-30',
        occurredAt: '2026-07-12 09:00:00',
        collectedAmount: 40,
      }),
    ]));
  });

  it('includes billed test lines that have no lab order and falls back from zero line_total', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO billing_service_items VALUES
        (2, 'tenant-a', 'Random Blood Sugar', 'RBS', 20, 1);
      INSERT INTO bills (
        id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
        total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
      ) VALUES
        (2, 'tenant-a', 'A-INV-2', 1, NULL, 1, 'paid', 40, 40, 0, 40, 0, '2026-07-12 12:00:00', '2026-07-12 12:05:00');
      INSERT INTO invoice_items VALUES
        (3, 'tenant-a', 2, 'test', 'Historical RBS description', 2, 2, 20, 0, 'active');
      INSERT INTO payments VALUES
        (2, 'tenant-a', 2, 40, 'cash', 'A-R-2', 1, NULL, '2026-07-12 12:05:00', '2026-07-12 12:05:00');
    `);

    const tests = await getTestPerformance({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      page: 1,
      pageSize: 25,
    });

    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM lab_orders WHERE tenant_id = ? AND bill_id = ?`)
      .get('tenant-a', 2)).toEqual({ count: 0 });
    expect(tests.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        testId: 2,
        testCode: 'RBS',
        testName: 'Random Blood Sugar',
        quantity: 2,
        billed: 40,
        collected: 40,
        due: 0,
      }),
    ]));
    expect(tests.totals).toMatchObject({ quantity: 3, billed: 100, collected: 100, due: 0 });
  });

  it('groups invoice lines that reference lab order items under the linked billing service', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO bills (
        id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
        total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
      ) VALUES
        (3, 'tenant-a', 'A-INV-3', 1, NULL, 1, 'paid', 80, 80, 0, 80, 0, '2026-07-12 13:00:00', '2026-07-12 13:05:00');
      INSERT INTO lab_orders VALUES
        (3, 'tenant-a', 1, 3, 1, '2026-07-12 13:00:00', '2026-07-12 13:00:00', NULL);
      INSERT INTO lab_order_items VALUES
        (5, 'tenant-a', 3, 1, 'CBC snapshot', 'ACC-5', 'pending', 'pending', NULL, NULL, '2026-07-12 13:00:00');
      INSERT INTO invoice_items VALUES
        (4, 'tenant-a', 3, 'test', 'CBC through lab item reference', 5, 1, 80, 80, 'active');
      INSERT INTO payments VALUES
        (3, 'tenant-a', 3, 80, 'cash', 'A-R-3', 1, NULL, '2026-07-12 13:05:00', '2026-07-12 13:05:00');
    `);

    const tests = await getTestPerformance({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      page: 1,
      pageSize: 25,
    });

    expect(tests.rows).toEqual([
      expect.objectContaining({
        testId: 1,
        testCode: 'CBC',
        testName: 'CBC',
        quantity: 2,
        billed: 140,
        collected: 140,
        due: 0,
      }),
    ]);

    const details = await getTestPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      testId: 1,
      page: 1,
      pageSize: 25,
    });
    expect(details.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 4, testName: 'CBC', billedAmount: 80, collectedAmount: 80, dueAmount: 0 }),
    ]));
  });

  it('groups one test by referring and performing doctor with exact line reconciliation', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO users VALUES
        (2, 'tenant-a', 'Reception User', 'reception'),
        (3, 'tenant-a', 'Performer User', 'doctor');
      INSERT INTO doctors VALUES
        (2, 'tenant-a', 'Dr Second Referrer', NULL),
        (3, 'tenant-a', 'Dr Performer', 3);
      INSERT INTO bills (
        id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
        total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
      ) VALUES
        (2, 'tenant-a', 'A-INV-2', 1, NULL, 2, 'paid', 100, 100, 0, 100, 0, '2026-07-12 11:00:00', '2026-07-12 11:05:00'),
        (3, 'tenant-a', 'A-INV-3', 1, NULL, NULL, 'paid', 50, 50, 0, 50, 0, '2026-07-12 12:00:00', '2026-07-12 12:05:00');
      INSERT INTO lab_orders (
        id, tenant_id, patient_id, bill_id, ordered_by, order_date, created_at,
        ordering_clinician_doctor_id
      ) VALUES
        (2, 'tenant-a', 1, 2, 2, '2026-07-12 11:00:00', '2026-07-12 11:00:00', 2),
        (3, 'tenant-a', 1, 3, 2, '2026-07-12 12:00:00', '2026-07-12 12:00:00', NULL);
      INSERT INTO lab_order_items VALUES
        (2, 'tenant-a', 2, 1, 'CBC second', 'A-ACC-2', 'completed', 'final', '2026-07-12 11:30:00', '2026-07-12 11:35:00', '2026-07-12 11:35:00'),
        (3, 'tenant-a', 3, 1, 'CBC unassigned', 'A-ACC-3', 'pending', 'pending', NULL, NULL, '2026-07-12 12:00:00');
      INSERT INTO invoice_items VALUES
        (3, 'tenant-a', 2, 'test', 'CBC second', 2, 2, 60, 100, 'active'),
        (4, 'tenant-a', 3, 'test', 'CBC unassigned', 3, 1, 50, 50, 'active');
      INSERT INTO payments VALUES
        (2, 'tenant-a', 2, 100, 'cash', 'A-R-2', 1, NULL, '2026-07-12 11:05:00', '2026-07-12 11:05:00'),
        (3, 'tenant-a', 3, 50, 'cash', 'A-R-3', 1, NULL, '2026-07-12 12:05:00', '2026-07-12 12:05:00');
      INSERT INTO diagnostic_performer_reserves (
        id, tenant_id, bill_id, invoice_item_id, assigned_doctor_id, test_name,
        unit_service_amount, unit_discount_amount, net_unit_service_amount,
        rule_rate_type, rule_rate_value, reserved_amount, status, reserved_at
      ) VALUES
        (2, 'tenant-a', 2, 3, 3, 'CBC second', 120, 20, 100, 'flat', 15, 15, 'reserved', '2026-07-12 11:00:00');
      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, incentive_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, paid_amount, balance_amount,
        status, accrued_date, created_at
      ) VALUES
        (10, 'tenant-a', 2, 1, 2, 2, 1, 'lab_test', 'referrer', 10, 10, 120, 100, 15, 1000, 0, 0, 0, 10, 'accrued', '2026-07-12', '2026-07-12');
    `);

    const lines = await getTestPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      testId: 1,
      view: 'lines' as never,
      page: 1,
      pageSize: 25,
    });
    const referred = await getTestPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      testId: 1,
      view: 'referred' as never,
      page: 1,
      pageSize: 25,
    });
    const performed = await getTestPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      testId: 1,
      view: 'performed' as never,
      page: 1,
      pageSize: 25,
    });
    const emptyPage = await getTestPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      testId: 1,
      view: 'lines' as never,
      page: 99,
      pageSize: 25,
    });

    expect(lines).toMatchObject({
      view: 'lines',
      summary: {
        quantity: 4,
        billed: 210,
        collected: 210,
        due: 0,
        referringDoctorCount: 2,
        performingDoctorCount: 1,
      },
    });
    expect(emptyPage).toMatchObject({
      view: 'lines',
      rows: [],
      totalRows: 3,
      summary: lines.summary,
    });

    expect(lines.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 3,
        quantity: 2,
        referringDoctorName: 'Dr Second Referrer',
        orderingClinicianName: 'Dr Second Referrer',
        enteredByName: 'Reception User',
        performingDoctorName: 'Dr Performer',
        performerReserveAmount: 15,
        discountAmount: 20,
      }),
      expect.objectContaining({
        id: 4,
        referringDoctorId: null,
        performingDoctorId: null,
      }),
    ]));

    const referredRows = referred.rows as Array<Record<string, number | string | null>>;
    expect(referredRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ doctorId: 1, doctorName: 'Dr A' }),
      expect.objectContaining({ doctorId: 2, doctorName: 'Dr Second Referrer', quantity: 2 }),
      expect.objectContaining({ doctorId: null, doctorName: 'Unassigned Referring Doctor' }),
    ]));
    expect(referredRows.reduce((sum, row) => sum + Number(row.quantity), 0)).toBe(lines.summary.quantity);
    expect(referredRows.reduce((sum, row) => sum + Number(row.testCommission), 0)).toBe(lines.summary.testCommission);

    const performedRows = performed.rows as Array<Record<string, number | string | null>>;
    expect(performedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ doctorId: 3, doctorName: 'Dr Performer', quantity: 2, performerReserve: 15 }),
      expect.objectContaining({ doctorId: null, doctorName: 'Unassigned Performing Doctor' }),
    ]));
    expect(performedRows.reduce((sum, row) => sum + Number(row.quantity), 0)).toBe(lines.summary.quantity);
    expect(performedRows.reduce((sum, row) => sum + Number(row.performerReserve), 0)).toBe(lines.summary.performerReserve);
  });

  it('excludes unpaid diagnostic accruals and uses persisted payable commission inputs without collection reconstruction', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      UPDATE doctor_commission_accruals
      SET commission_amount = 5,
          earned_commission_amount = 5,
          commission_base_amount = 40,
          performer_reserve_amount = 10,
          commission_rate_bps = 2500
      WHERE tenant_id = 'tenant-a' AND id = 2;

      INSERT INTO bills (
        id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
        total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
      ) VALUES
        (4, 'tenant-a', 'A-INV-UNPAID', 1, NULL, 1, 'open', 2300, 0, 2300, 2300, 0, '2026-07-12 14:00:00', '2026-07-12 14:00:00');

      INSERT INTO lab_orders VALUES
        (40, 'tenant-a', 1, 4, 1, '2026-07-12 14:00:00', '2026-07-12 14:00:00', NULL);
      INSERT INTO lab_order_items VALUES
        (40, 'tenant-a', 40, 1, 'Unpaid Test', 'ACC-UNPAID', 'completed', 'final', NULL, NULL, '2026-07-12 14:30:00');
      INSERT INTO invoice_items VALUES
        (40, 'tenant-a', 4, 'test', 'Unpaid Test', 40, 1, 2300, 2300, 'active');

      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, paid_amount, balance_amount,
        status, accrued_date, created_at
      ) VALUES
        (5, 'tenant-a', 1, 1, 4, 40, 1, 'lab_test', 573, 573, 2300, 2300, 0, 2500, 0, 0, 0, 573, 'accrued', '2026-07-12', '2026-07-12'),
        (6, 'tenant-a', 1, 1, 1, NULL, NULL, 'lab_test', 10, 10, 50, 50, 10, 0, 10, 0, 0, 10, 'paid', '2026-07-12', '2026-07-12');
    `);

    const doctors = await getDoctorPerformance({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      page: 1,
      pageSize: 25,
    });

    expect(doctors.rows).toEqual([
      expect.objectContaining({
        doctorId: 1,
        testCollection: 60,
        referrerCommission: 16,
        performerReserve: 0,
        testCommission: 16,
        totalCommission: 30,
      }),
    ]);
    expect(doctors.totals).toMatchObject({ referrerCommission: 16, performerReserve: 0, testCommission: 16, totalCommission: 30 });

    const commissionDetails = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 1,
      tab: 'commissions',
      page: 1,
      pageSize: 25,
    });
    expect(commissionDetails.rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ referenceNo: 'A-INV-UNPAID' }),
    ]));

    const testDetails = await getDoctorPerformanceDetails({
      dbBinding: d1,
      tenantId: 'tenant-a',
      period: PERIOD,
      doctorId: 1,
      tab: 'tests',
      page: 1,
      pageSize: 25,
    });
    expect(testDetails.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 40,
        testName: 'Unpaid Test',
        grossAmount: 2300,
        collectedAmount: 0,
        dueAmount: 2300,
        earnedAmount: 0,
        waiverAmount: 0,
        payableAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
      }),
    ]));
  });

  it('nets approved refund cash-outs from executive collection and persisted commission totals', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO bills (
        id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
        total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
      ) VALUES
        (50, 'tenant-a', 'A-INV-REFUND', 1, NULL, 1, 'paid', 224, 224, 0, 224, 0, '2026-07-12 15:00:00', '2026-07-12 15:10:00');

      INSERT INTO invoice_items VALUES
        (50, 'tenant-a', 50, 'test', 'Active refunded-bill test', NULL, 1, 224, 224, 'active'),
        (51, 'tenant-a', 50, 'test', 'Returned test', NULL, 1, 16, 16, 'cancelled');

      INSERT INTO payments VALUES
        (50, 'tenant-a', 50, 240, 'cash', 'A-R-REFUND', 1, NULL, '2026-07-12 15:05:00', '2026-07-12 15:05:00');

      INSERT INTO doctor_commission_accruals (
        id, tenant_id, doctor_id, patient_id, bill_id, lab_order_item_id, lab_test_id,
        source_type, incentive_type, commission_amount, earned_commission_amount, gross_amount,
        commission_base_amount, performer_reserve_amount, commission_rate_bps,
        commission_flat_amount, doctor_waiver_amount, payable_commission_amount,
        paid_amount, balance_amount, reversed_amount, clawback_amount,
        status, accrued_date, created_at
      ) VALUES
        (50, 'tenant-a', 1, 1, 50, NULL, NULL, 'lab_test', 'referrer', 56, 56, 224, 224.03, 0, 2500, 0, 0, 56, 0, 56, 0, 0, 'accrued', '2026-07-12', '2026-07-12 15:00:00'),
        (51, 'tenant-a', 1, 1, 50, NULL, NULL, 'lab_test', 'referrer', 4, 4, 16, 16, 0, 2500, 0, 0, 4, 0, 0, 4, 0, 'accrued', '2026-07-12', '2026-07-12 15:00:00');
    `);

    const [income, doctors, tests, commission] = await Promise.all([
      getIncomeServiceAnalysis({
        dbBinding: d1,
        tenantId: 'tenant-a',
        period: PERIOD,
        page: 1,
        pageSize: 25,
      }),
      getDoctorPerformance({
        dbBinding: d1,
        tenantId: 'tenant-a',
        period: PERIOD,
        page: 1,
        pageSize: 25,
      }),
      getTestPerformance({
        dbBinding: d1,
        tenantId: 'tenant-a',
        period: PERIOD,
        page: 1,
        pageSize: 25,
      }),
      getExecutiveCommissionTotals({
        dbBinding: d1,
        tenantId: 'tenant-a',
        startDate: PERIOD.startDate,
        endDate: PERIOD.endDate,
      }),
    ]);

    expect(income.totals.collection).toBe(324);
    expect(tests.rows.reduce((sum, row) => sum + row.collected, 0)).toBe(284);
    expect(commission).toEqual({
      visit_commission: 10,
      test_commission: 62,
      other_doctor_commission: 4,
      total_commission: 76,
    });
    expect(doctors.rows).toEqual([
      expect.objectContaining({
        doctorId: 1,
        visitCollection: 40,
        testCollection: 284,
        referrerCommission: 62,
        testCommission: 62,
        earnedCommission: 76,
        payableCommission: 76,
        paidCommission: 0,
        outstandingCommission: 76,
        totalCommission: 76,
      }),
    ]);
  });

  it('returns explicit zero/empty analytics for a valid future period', async () => {
    const { d1 } = createHarness();
    const futurePeriod: ExecutiveDashboardPeriod = {
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      label: '2026-08-01',
      preset: 'custom',
    };

    const [income, expense, doctors, tests, reagents] = await Promise.all([
      getIncomeServiceAnalysis({ dbBinding: d1, tenantId: 'tenant-a', period: futurePeriod, page: 1, pageSize: 25 }),
      getExpenseAnalysis({ dbBinding: d1, tenantId: 'tenant-a', period: futurePeriod, page: 1, pageSize: 25 }),
      getDoctorPerformance({ dbBinding: d1, tenantId: 'tenant-a', period: futurePeriod, page: 1, pageSize: 25 }),
      getTestPerformance({ dbBinding: d1, tenantId: 'tenant-a', period: futurePeriod, page: 1, pageSize: 25 }),
      getReagentReconciliation({ dbBinding: d1, tenantId: 'tenant-a', period: futurePeriod, page: 1, pageSize: 25 }),
    ]);

    expect(income).toMatchObject({ rows: [], totals: { transactions: 0, units: 0, collection: 0 } });
    expect(expense).toMatchObject({ rows: [], totals: { transactions: 0, paidAmount: 0 } });
    expect(doctors.rows).toEqual([]);
    expect(tests.rows).toEqual([]);
    expect(reagents.rows).toEqual([]);
  });

  it('uses existing production indexes for the five analytics summary families', async () => {
    const { sqlite, d1, captured } = createHarness();
    await Promise.all([
      getDoctorPerformance({ dbBinding: d1, tenantId: 'tenant-a', period: PERIOD, page: 1, pageSize: 25 }),
      getTestPerformance({ dbBinding: d1, tenantId: 'tenant-a', period: PERIOD, page: 1, pageSize: 25 }),
      getIncomeServiceAnalysis({ dbBinding: d1, tenantId: 'tenant-a', period: PERIOD, page: 1, pageSize: 25 }),
      getExpenseAnalysis({ dbBinding: d1, tenantId: 'tenant-a', period: PERIOD, page: 1, pageSize: 25 }),
      getReagentReconciliation({ dbBinding: d1, tenantId: 'tenant-a', period: PERIOD, page: 1, pageSize: 25 }),
    ]);

    const markers = [
      'executive_doctor:summary',
      'executive_test:summary',
      'executive_income:services',
      'executive_expense:analysis',
      'executive_reagent:expected',
    ];
    for (const marker of markers) {
      const statement = captured.find((entry) => entry.sql.includes(marker));
      expect(statement, `missing captured SQL for ${marker}`).toBeDefined();
      const planRows = sqlite.prepare(`EXPLAIN QUERY PLAN ${statement!.sql}`)
        .all(...statement!.params) as Array<{ detail: string }>;
      const details = planRows.map((row) => row.detail);
      const usesIndex = details.some((detail) => /USING (?:COVERING )?INDEX|USING INTEGER PRIMARY KEY/i.test(detail));
      if (!usesIndex) {
        throw new Error(`${marker} did not use an existing index: ${details.join(' | ')}`);
      }
    }
  });
});

describe('executive dashboard analytics route security', () => {
  it('returns 401 before analytics handlers run when no authentication token is provided', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-a');
      c.env = { JWT_SECRET: 'test-secret' } as Env;
      await next();
    });
    app.use('/api/*', authMiddleware);
    app.route('/api/dashboard', dashboardRoutes);

    const response = await app.request('/api/dashboard/doctor-performance');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'No token provided' });
  });

  it('rejects non-executive roles before issuing analytics SQL', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'receptionist',
      tenantId: 'tenant-a',
    });

    const response = await app.request('/dashboard/doctor-performance');

    expect(response.status).toBe(403);
    expect(mockDB.queries).toHaveLength(0);
  });

  it('accepts ten-row pagination for executive analytics panels', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-a',
      queryOverride: (sql) => sql.includes('executive_doctor:summary') ? { results: [] } : null,
    });

    const response = await app.request('/dashboard/doctor-performance?page=1&pageSize=10');

    expect(response.status).toBe(200);
  });

  it('binds SQL-like search text, ignores client tenant overrides, and rejects unknown sorts', async () => {
    const injection = `%' OR 1=1 --`;
    let analyticsQueryCount = 0;
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-a',
      queryOverride: (sql, params) => {
        if (!sql.includes('executive_doctor:summary')) return null;
        analyticsQueryCount += 1;
        expect(sql).not.toContain(injection);
        expect(params).toContain(`%${injection}%`);
        expect(params).toContain('tenant-a');
        expect(params).not.toContain('tenant-b');
        return { results: [] };
      },
    });

    const safeResponse = await app.request(
      `/dashboard/doctor-performance?tenantId=tenant-b&search=${encodeURIComponent(injection)}&sortBy=totalCommission&sortDirection=desc`,
    );
    expect(safeResponse.status).toBe(200);
    expect(analyticsQueryCount).toBe(1);

    const badSortResponse = await app.request('/dashboard/doctor-performance?sortBy=totalCommission%20DESC%3B%20DROP%20TABLE%20doctors');
    expect(badSortResponse.status).toBe(400);
    expect(analyticsQueryCount).toBe(1);
    expect(mockDB.queries.filter((query) => query.sql.includes('executive_doctor:summary'))).toHaveLength(1);
  });
});
