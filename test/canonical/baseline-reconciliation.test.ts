import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  snapshotSqliteSchema,
  type SchemaSnapshotReport,
} from '../../scripts/canonical/snapshot-schema';
import {
  reconcileProductionBaseline,
  type ProductionBaselineReport,
} from '../../scripts/canonical/baseline-reconciliation';

function createDatabase(root: string, name: string, sql: string): string {
  const database = join(root, name);
  const result = spawnSync('sqlite3', [database], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`sqlite fixture failed: ${String(result.stderr)}`);
  }
  return database;
}

const SOURCE_FIXTURE = `
PRAGMA foreign_keys = OFF;
CREATE TABLE d1_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT
);
CREATE TABLE tenants (
  id TEXT PRIMARY KEY
);
CREATE TABLE patients (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  diagnosis TEXT,
  note TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE TABLE bills (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  total REAL NOT NULL,
  paid REAL NOT NULL,
  due REAL NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CHECK (total >= 0)
);
CREATE TRIGGER bills_touch_after_update
AFTER UPDATE ON bills
BEGIN
  SELECT NEW.id;
END;
CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  item_category TEXT,
  reference_id INTEGER,
  line_total REAL NOT NULL,
  is_cancelled INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);
CREATE INDEX idx_invoice_items_bill ON invoice_items(bill_id);
CREATE VIEW active_invoice_items AS
SELECT id, bill_id, line_total FROM invoice_items WHERE is_cancelled = 0;
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);
CREATE TABLE billing_deposits (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  amount REAL NOT NULL
);
CREATE TABLE billing_credit_notes (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER,
  total_amount REAL NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE doctor_commission_accruals (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER,
  payable_commission_amount REAL,
  paid_amount REAL,
  balance_amount REAL
);
CREATE TABLE ipd_ledger_entries (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  admission_id INTEGER NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0
);
CREATE TABLE InventoryStock (
  Id INTEGER PRIMARY KEY,
  TenantId TEXT NOT NULL,
  CurrentStock REAL NOT NULL
);
CREATE TABLE InventoryStockTransaction (
  Id INTEGER PRIMARY KEY,
  TenantId TEXT NOT NULL,
  StockId INTEGER NOT NULL,
  Quantity REAL NOT NULL
);
CREATE TABLE emp_cash_transactions (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  amount REAL NOT NULL
);
CREATE TABLE cash_drawer_movements (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  amount REAL NOT NULL
);
CREATE TABLE accounting_vouchers (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT
);
CREATE TABLE accounting_journal_lines (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  voucher_id INTEGER NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (voucher_id) REFERENCES accounting_vouchers(id)
);
INSERT INTO d1_migrations VALUES
  (1, '001_existing.sql', '2026-07-13T00:00:00Z'),
  (2, '002_missing_repo.sql', '2026-07-13T00:01:00Z');
INSERT INTO tenants VALUES ('t1');
INSERT INTO patients VALUES
  (1, 't1', 'Sensitive Patient', '+8801700000000', 'Private diagnosis', 'Private note'),
  (2, 'missing-tenant', 'Other Sensitive Patient', NULL, NULL, NULL);
INSERT INTO bills VALUES
  (1, 't1', 120.0, 20.0, 90.0),
  (2, 't1', 'not-money', 0.0, 0.0);
INSERT INTO invoice_items VALUES
  (1, 't1', 1, 'lab', 77, 50.0, 0),
  (2, 't1', 1, 'lab', 77, 50.0, 0),
  (3, 't1', 999, 'lab', 88, 25.0, 0);
INSERT INTO payments VALUES (1, 't1', 1, 20.0);
INSERT INTO billing_deposits VALUES (1, 't1', 1, 'deposit', 30.0);
INSERT INTO billing_credit_notes VALUES (1, 't1', 1, 5.0, 'approved');
INSERT INTO doctor_commission_accruals VALUES (1, 't1', 1, 10.0, 3.0, 7.0);
INSERT INTO ipd_ledger_entries VALUES (1, 't1', 1, 100.0, 25.0);
INSERT INTO InventoryStock VALUES (1, 't1', -2.0);
INSERT INTO InventoryStockTransaction VALUES (1, 't1', 1, -2.0);
INSERT INTO emp_cash_transactions VALUES (1, 't1', 'bill', 1, 20.0);
INSERT INTO cash_drawer_movements VALUES (1, 't1', 'expense', '9', -4.0);
INSERT INTO accounting_vouchers VALUES (1, 't1', 'bill', '1');
INSERT INTO accounting_journal_lines VALUES
  (1, 't1', 1, 120.0, 0.0),
  (2, 't1', 1, 0.0, 100.0);
`;

const CLONE_FIXTURE = SOURCE_FIXTURE.replace(
  ',\n  FOREIGN KEY (bill_id) REFERENCES bills(id)\n);\nCREATE INDEX idx_invoice_items_bill',
  '\n);\nCREATE INDEX idx_invoice_items_bill',
);

describe('CDB-012 schema snapshot and production baseline', () => {
  it('captures schema metadata, row counts, checks, views, indexes, and FK violations without row content', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-012-schema-'));
    const database = createDatabase(root, 'source.sqlite', SOURCE_FIXTURE);
    const output = join(root, 'schema.json');
    const markdown = join(root, 'schema.md');

    const report: SchemaSnapshotReport = snapshotSqliteSchema({
      database,
      output,
      markdown,
      now: () => new Date('2026-07-13T13:00:00.000Z'),
    });

    expect(report.tableCount).toBeGreaterThan(10);
    expect(report.viewCount).toBe(1);
    expect(report.triggerCount).toBe(1);
    expect(report.triggers).toEqual([
      expect.objectContaining({
        name: 'bills_touch_after_update',
        tableName: 'bills',
      }),
    ]);
    expect(report.totalRowCount).toBeGreaterThan(10);
    expect(report.foreignKeyViolations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'invoice_items',
          parentTable: 'bills',
          rowId: 3,
        }),
        expect.objectContaining({
          table: 'patients',
          parentTable: 'tenants',
          rowId: 2,
        }),
      ]),
    );
    const invoiceItems = report.tables.find((table) => table.name === 'invoice_items');
    expect(invoiceItems?.columns.map((column) => column.name)).toContain('reference_id');
    expect(invoiceItems?.indexes.map((index) => index.name)).toContain(
      'idx_invoice_items_bill',
    );
    expect(report.tables.find((table) => table.name === 'bills')?.checks).toContain(
      'total >= 0',
    );

    const persisted = `${readFileSync(output, 'utf8')}\n${readFileSync(markdown, 'utf8')}`;
    expect(persisted).not.toContain('Sensitive Patient');
    expect(persisted).not.toContain('+8801700000000');
    expect(persisted).not.toContain('Private diagnosis');
    expect(persisted).not.toContain('Private note');
  });

  it('classifies financial, source-reference, FK, tenant, stock, and accounting mismatches with stable exception IDs', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-012-baseline-'));
    const sourceDatabase = createDatabase(root, 'source.sqlite', SOURCE_FIXTURE);
    const cloneDatabase = createDatabase(root, 'clone.sqlite', CLONE_FIXTURE);
    const migrationDirectory = join(root, 'migrations');
    mkdirSync(migrationDirectory);
    writeFileSync(join(migrationDirectory, '001_existing.sql'), '-- existing\n', 'utf8');
    writeFileSync(join(migrationDirectory, '003_not_applied.sql'), '-- pending\n', 'utf8');
    const output = join(root, 'baseline.json');
    const markdown = join(root, 'baseline.md');
    const exceptions = join(root, 'exceptions.yaml');
    const waiverManifest = join(root, 'waivers.json');
    writeFileSync(
      waiverManifest,
      JSON.stringify({
        manualWaivers: [
          {
            table: 'invoice_items',
            column: 'bill_id',
            parentTable: 'bills',
            reason: 'fixture import compatibility',
          },
        ],
        graphWaivers: [],
      }),
      'utf8',
    );

    const report: ProductionBaselineReport = reconcileProductionBaseline({
      sourceDatabase,
      cloneDatabase,
      waiverManifest,
      migrationDirectory,
      output,
      markdown,
      exceptions,
      now: () => new Date('2026-07-13T13:05:00.000Z'),
    });

    const codes = new Set(report.exceptions.map((exception) => exception.code));
    expect(codes.has('FOREIGN_KEY_VIOLATION')).toBe(true);
    expect(codes.has('TENANT_REFERENCE_MISMATCH')).toBe(true);
    expect(codes.has('DUPLICATE_SOURCE_REFERENCE')).toBe(true);
    expect(codes.has('MONEY_MIXED_STORAGE')).toBe(true);
    expect(codes.has('BILL_LINE_TOTAL_MISMATCH')).toBe(true);
    expect(codes.has('BILL_DUE_MISMATCH')).toBe(true);
    expect(codes.has('NEGATIVE_STOCK_BALANCE')).toBe(true);
    expect(codes.has('ACCOUNTING_VOUCHER_IMBALANCE')).toBe(true);
    expect(codes.has('SOURCE_CLONE_FK_DIFFERENCE')).toBe(true);
    expect(codes.has('MIGRATION_APPLIED_NOT_IN_REPOSITORY')).toBe(true);
    expect(codes.has('MIGRATION_REPOSITORY_NOT_APPLIED')).toBe(true);
    expect(report.migrationDrift).toEqual(
      expect.objectContaining({
        appliedMigrationCount: 2,
        repositoryMigrationCount: 2,
        appliedNotInRepository: ['002_missing_repo.sql'],
        repositoryNotApplied: ['003_not_applied.sql'],
      }),
    );
    const fkDifferences = report.exceptions.filter(
      (exception) => exception.code === 'SOURCE_CLONE_FK_DIFFERENCE',
    );
    expect(fkDifferences).toHaveLength(1);
    expect(fkDifferences[0].status).toBe('accepted_import_compatibility');
    expect(report.domains.billing.billCount).toBe(2);
    expect(report.domains.payments.paymentCount).toBe(1);
    expect(report.domains.deposits.transactionCount).toBe(1);
    expect(report.domains.commissions.accrualCount).toBe(1);
    expect(report.domains.ipd.ledgerEntryCount).toBe(1);
    expect(report.domains.stock.stockRowCount).toBe(1);
    expect(report.domains.cash.eventCount).toBe(2);
    expect(report.domains.accounting.voucherCount).toBe(1);

    const ids = report.exceptions.map((exception) => exception.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^P01-[A-Z0-9_]+-[A-F0-9]{12}$/.test(id))).toBe(true);

    const yaml = readFileSync(exceptions, 'utf8');
    const markdownText = readFileSync(markdown, 'utf8');
    const persisted = `${readFileSync(output, 'utf8')}\n${markdownText}\n${yaml}`;
    expect(yaml).toContain('status: open');
    expect(yaml).toContain('status: accepted_import_compatibility');
    expect(markdownText).toContain('Accepted import-compatibility exceptions: 1');
    expect(markdownText).toContain(
      'not authorization to omit future canonical production constraints',
    );
    expect(persisted).not.toContain('Sensitive Patient');
    expect(persisted).not.toContain('+8801700000000');
    expect(persisted).not.toContain('Private diagnosis');
    expect(persisted).not.toContain('Private note');
  });

  it('detects unexpected source-versus-clone column, index, check, view, and trigger drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-012-schema-drift-'));
    const sourceDatabase = createDatabase(
      root,
      'source.sqlite',
      `
      CREATE TABLE items (
        id INTEGER PRIMARY KEY,
        amount INTEGER NOT NULL CHECK (amount >= 0),
        note TEXT
      );
      CREATE INDEX idx_items_amount ON items(amount);
      CREATE VIEW item_view AS SELECT id, amount FROM items;
      CREATE TRIGGER item_trigger AFTER INSERT ON items BEGIN SELECT NEW.id; END;
      `,
    );
    const cloneDatabase = createDatabase(
      root,
      'clone.sqlite',
      `
      CREATE TABLE items (
        id INTEGER PRIMARY KEY,
        amount REAL CHECK (amount > 0)
      );
      CREATE VIEW item_view AS SELECT id FROM items;
      `,
    );

    const report = reconcileProductionBaseline({
      sourceDatabase,
      cloneDatabase,
      now: () => new Date('2026-07-13T13:08:00.000Z'),
    });
    const codes = new Set(report.exceptions.map((exception) => exception.code));

    expect(codes.has('SOURCE_CLONE_COLUMN_DIFFERENCE')).toBe(true);
    expect(codes.has('SOURCE_CLONE_INDEX_DIFFERENCE')).toBe(true);
    expect(codes.has('SOURCE_CLONE_CHECK_DIFFERENCE')).toBe(true);
    expect(codes.has('SOURCE_CLONE_VIEW_DIFFERENCE')).toBe(true);
    expect(codes.has('SOURCE_CLONE_TRIGGER_DIFFERENCE')).toBe(true);
  });

  it('rejects malformed import-waiver manifests', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-012-waiver-'));
    const sourceDatabase = createDatabase(root, 'source.sqlite', SOURCE_FIXTURE);
    const cloneDatabase = createDatabase(root, 'clone.sqlite', CLONE_FIXTURE);
    const waiverManifest = join(root, 'invalid-waivers.json');
    writeFileSync(
      waiverManifest,
      JSON.stringify({
        manualWaivers: [{ table: '', column: '', parentTable: 'bills' }],
      }),
      'utf8',
    );

    expect(() =>
      reconcileProductionBaseline({
        sourceDatabase,
        cloneDatabase,
        waiverManifest,
      }),
    ).toThrow(/invalid waiver manifest entry/i);
  });

  it('produces the same stable exception IDs when rerun at a different time', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-012-stable-'));
    const sourceDatabase = createDatabase(root, 'source.sqlite', SOURCE_FIXTURE);
    const first: ProductionBaselineReport = reconcileProductionBaseline({
      sourceDatabase,
      now: () => new Date('2026-07-13T13:10:00.000Z'),
    });
    const second: ProductionBaselineReport = reconcileProductionBaseline({
      sourceDatabase,
      now: () => new Date('2026-07-14T13:10:00.000Z'),
    });

    expect(second.exceptions.map((exception) => exception.id)).toEqual(
      first.exceptions.map((exception) => exception.id),
    );
  }, 15_000);
});
