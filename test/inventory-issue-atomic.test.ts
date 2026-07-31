import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  buildAtomicInventoryIssueStatements,
  commitAtomicInventoryIssue,
  type AtomicInventoryIssueInput,
} from '../src/lib/inventory-issue-atomic';

type SqlValue = string | number | bigint | null | Uint8Array;

type RunResult = {
  success: boolean;
  meta: { changes: number; last_row_id: number; duration: number };
};

class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(
      this.database,
      this.sql,
      params.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run(): Promise<RunResult> {
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

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta: object }> {
    return {
      results: this.database.prepare(this.sql).all(...this.params) as T[],
      success: true,
      meta: {},
    };
  }
}

function createTransactionalD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1Statement(database, sql);
    },
    async batch(statements: SqliteD1Statement[]) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results: RunResult[] = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql: string) {
      database.exec(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

function createHarness(): { sqlite: DatabaseSync; d1: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE InventoryStock (
      StockId INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ItemId INTEGER NOT NULL,
      StoreId INTEGER NOT NULL,
      AvailableQuantity REAL NOT NULL,
      ReservedQuantity REAL NOT NULL DEFAULT 0,
      DamagedQuantity REAL NOT NULL DEFAULT 0,
      BlockedQuantity REAL NOT NULL DEFAULT 0,
      BatchNo TEXT,
      ExpiryDate TEXT,
      AfterOpenExpiryDate TEXT,
      CostPrice REAL DEFAULT 0,
      IsActive INTEGER NOT NULL DEFAULT 1,
      StockStatus TEXT NOT NULL DEFAULT 'available',
      QCStatus TEXT NOT NULL DEFAULT 'accepted',
      ModifiedBy TEXT,
      ModifiedOn TEXT
    );

    CREATE TABLE InventoryConsumption (
      ConsumptionId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      ConsumptionNo TEXT NOT NULL,
      ConsumptionDate TEXT NOT NULL,
      IssueType TEXT NOT NULL,
      FromStoreId INTEGER,
      DepartmentId INTEGER,
      Department TEXT,
      PatientId INTEGER,
      AdmissionId INTEGER,
      VisitId INTEGER,
      SurgeryId INTEGER,
      LabOrderId INTEGER,
      Chargeable INTEGER NOT NULL DEFAULT 0,
      BillingStatus TEXT NOT NULL DEFAULT 'not_chargeable',
      BillingReferenceId INTEGER,
      TotalCost REAL NOT NULL DEFAULT 0,
      TotalCharge REAL NOT NULL DEFAULT 0,
      Remarks TEXT,
      CreatedBy TEXT,
      CreatedOn TEXT NOT NULL,
      OperationKey TEXT,
      OperationStatus TEXT NOT NULL DEFAULT 'completed',
      UNIQUE(tenant_id, OperationKey)
    );

    CREATE TABLE InventoryConsumptionItem (
      ConsumptionItemId INTEGER PRIMARY KEY AUTOINCREMENT,
      ConsumptionId INTEGER NOT NULL,
      ItemId INTEGER,
      StockId INTEGER,
      BatchNo TEXT,
      ExpiryDate TEXT,
      Quantity REAL NOT NULL,
      Unit TEXT,
      CostPrice REAL NOT NULL DEFAULT 0,
      ChargeAmount REAL NOT NULL DEFAULT 0,
      IsChargeable INTEGER NOT NULL DEFAULT 0,
      BillingReferenceId INTEGER,
      Remarks TEXT,
      CreatedBy TEXT,
      CreatedOn TEXT NOT NULL,
      OperationAllocationKey TEXT,
      UNIQUE(ConsumptionId, OperationAllocationKey),
      FOREIGN KEY(ConsumptionId) REFERENCES InventoryConsumption(ConsumptionId)
    );

    CREATE TABLE InventoryStockTransaction (
      TransactionId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      StockId INTEGER,
      ItemId INTEGER,
      StoreId INTEGER,
      TransactionType TEXT,
      ReferenceNo TEXT,
      ReferenceId INTEGER,
      InQuantity REAL,
      OutQuantity REAL,
      BalanceQuantity REAL,
      TransactionDate TEXT,
      Remarks TEXT,
      CreatedBy TEXT,
      CreatedOn TEXT
    );

    CREATE TABLE InventoryAuditLog (
      AuditLogId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      Action TEXT,
      EntityType TEXT,
      EntityId INTEGER,
      ItemId INTEGER,
      StockId INTEGER,
      BatchNo TEXT,
      StoreId INTEGER,
      ReferenceType TEXT,
      ReferenceId INTEGER,
      OldValueJson TEXT,
      NewValueJson TEXT,
      UserId TEXT,
      CreatedOn TEXT
    );

    CREATE TABLE billing_provisional_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      admission_id INTEGER,
      visit_id INTEGER,
      item_category TEXT NOT NULL,
      item_name TEXT NOT NULL CHECK(item_name <> 'FAIL-BILLING'),
      department TEXT,
      unit_price REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 1,
      discount_percent REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      reference_id INTEGER,
      bill_status TEXT DEFAULT 'provisional',
      is_insurance INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT
    );

    CREATE TABLE inventory_issue_batch_guard (
      tenant_id TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      step_key TEXT NOT NULL,
      assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(tenant_id, operation_key, step_key)
    );

    CREATE TABLE inventory_demand_source_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      demand_date TEXT NOT NULL,
      source_scope TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      UNIQUE(tenant_id, source_type, source_id)
    );

    CREATE TABLE inventory_demand_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      demand_date TEXT NOT NULL,
      source_scope TEXT NOT NULL,
      consumed_qty REAL NOT NULL DEFAULT 0,
      billed_event_count INTEGER NOT NULL DEFAULT 0,
      completed_event_count INTEGER NOT NULL DEFAULT 0,
      waste_qty REAL NOT NULL DEFAULT 0,
      adjustment_qty REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, inventory_item_id, demand_date, source_scope)
    );

    INSERT INTO InventoryStock
      (StockId, tenant_id, ItemId, StoreId, AvailableQuantity, CostPrice, BatchNo, ExpiryDate)
    VALUES
      (1, 'tenant-a', 101, 5, 10, 12, 'LOT-1', '2099-01-01'),
      (2, 'tenant-a', 102, 5, 10, 20, 'LOT-2', '2099-01-01');
  `);
  return { sqlite, d1: createTransactionalD1(sqlite) };
}

function baseInput(overrides: Partial<AtomicInventoryIssueInput> = {}): AtomicInventoryIssueInput {
  return {
    db: overrides.db as D1Database,
    tenantId: 'tenant-a',
    userId: '7',
    operationKey: 'issue-op-0001',
    issueNo: 'ISS-0001',
    issueDate: '2026-07-10',
    transactionDate: '2026-07-10T01:00:00.000Z',
    issueType: 'patient_issue',
    fromStoreId: 5,
    departmentId: 8,
    department: 'Ward',
    patientId: 900,
    admissionId: 901,
    visitId: null,
    surgeryId: null,
    labOrderId: null,
    billingReferenceId: null,
    chargeable: true,
    remarks: 'Atomic issue test',
    allocations: [
      {
        allocationKey: 'line-0-stock-1',
        itemId: 101,
        itemName: 'Item A',
        itemCategory: 'consumable',
        itemUnit: 'pcs',
        stock: {
          StockId: 1,
          AvailableQuantity: 10,
          ReservedQuantity: 0,
          DamagedQuantity: 0,
          BlockedQuantity: 0,
          BatchNo: 'LOT-1',
          ExpiryDate: '2099-01-01',
        },
        quantity: 2,
        costPrice: 12,
        unitCharge: 18,
        lineCharge: 36,
        isChargeable: true,
        remarks: null,
      },
      {
        allocationKey: 'line-1-stock-2',
        itemId: 102,
        itemName: 'Item B',
        itemCategory: 'consumable',
        itemUnit: 'pcs',
        stock: {
          StockId: 2,
          AvailableQuantity: 10,
          ReservedQuantity: 0,
          DamagedQuantity: 0,
          BlockedQuantity: 0,
          BatchNo: 'LOT-2',
          ExpiryDate: '2099-01-01',
        },
        quantity: 3,
        costPrice: 20,
        unitCharge: 25,
        lineCharge: 75,
        isChargeable: true,
        remarks: null,
      },
    ],
    ...overrides,
  };
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  const row = sqlite.prepare(sql).get() as Record<string, number>;
  return Number(Object.values(row)[0]);
}

describe('atomic inventory issue request', () => {
  it('builds one tenant-scoped batch containing core stock, billing and demand writes', () => {
    const { d1 } = createHarness();
    const statements = buildAtomicInventoryIssueStatements(baseInput({ db: d1 })) as unknown as SqliteD1Statement[];
    const sql = statements.map((statement) => statement.sql.replace(/\s+/g, ' '));

    expect(sql[0]).toContain('INSERT INTO InventoryConsumption');
    expect(sql[0]).toContain('OperationKey');
    expect(sql.some((value) => value.includes('UPDATE InventoryStock'))).toBe(true);
    expect(sql.some((value) => value.includes('INSERT INTO inventory_issue_batch_guard') && value.includes('changes()'))).toBe(true);
    expect(sql.some((value) => value.includes('INSERT INTO InventoryConsumptionItem'))).toBe(true);
    expect(sql.some((value) => value.includes('INSERT INTO InventoryStockTransaction'))).toBe(true);
    expect(sql.some((value) => value.includes('INSERT INTO InventoryAuditLog'))).toBe(true);
    expect(sql.some((value) => value.includes('INSERT INTO billing_provisional_items'))).toBe(true);
    expect(sql.some((value) => value.includes('INSERT OR IGNORE INTO inventory_demand_source_event'))).toBe(true);
    expect(sql.some((value) => value.includes('INSERT INTO inventory_demand_daily'))).toBe(true);
    expect(sql.at(-2)).toContain('UPDATE InventoryConsumption');
    expect(sql.at(-1)).toContain('DELETE FROM inventory_issue_batch_guard');
  });

  it('commits header, every allocation, ledger, audit, billing and demand as one request', async () => {
    const { sqlite, d1 } = createHarness();

    await expect(commitAtomicInventoryIssue(baseInput({ db: d1 }))).resolves.toEqual({
      consumptionId: 1,
      issueNo: 'ISS-0001',
      totalCost: 84,
      totalCharge: 111,
      billedLines: 2,
    });

    expect(scalar(sqlite, 'SELECT AvailableQuantity FROM InventoryStock WHERE StockId = 1')).toBe(8);
    expect(scalar(sqlite, 'SELECT AvailableQuantity FROM InventoryStock WHERE StockId = 2')).toBe(7);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryConsumption')).toBe(1);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryConsumptionItem')).toBe(2);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryStockTransaction')).toBe(2);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryAuditLog')).toBe(2);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM billing_provisional_items')).toBe(2);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryConsumptionItem WHERE BillingReferenceId IS NOT NULL')).toBe(2);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM inventory_demand_source_event')).toBe(2);
    expect(scalar(sqlite, 'SELECT consumed_qty FROM inventory_demand_daily WHERE inventory_item_id = 101')).toBe(2);
    expect(scalar(sqlite, "SELECT COUNT(*) FROM inventory_issue_batch_guard")).toBe(0);
  });

  it('rolls back the full request when the second stock snapshot is stale', async () => {
    const { sqlite, d1 } = createHarness();
    const input = baseInput({ db: d1 });
    input.allocations[1].stock.AvailableQuantity = 11;

    await expect(commitAtomicInventoryIssue(input)).rejects.toThrow();

    expect(scalar(sqlite, 'SELECT AvailableQuantity FROM InventoryStock WHERE StockId = 1')).toBe(10);
    expect(scalar(sqlite, 'SELECT AvailableQuantity FROM InventoryStock WHERE StockId = 2')).toBe(10);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryConsumption')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryConsumptionItem')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryStockTransaction')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryAuditLog')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM billing_provisional_items')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM inventory_demand_source_event')).toBe(0);
  });

  it('rolls back stock and all request records when provisional billing fails', async () => {
    const { sqlite, d1 } = createHarness();
    const input = baseInput({ db: d1 });
    input.allocations[1].itemName = 'FAIL-BILLING';

    await expect(commitAtomicInventoryIssue(input)).rejects.toThrow();

    expect(scalar(sqlite, 'SELECT AvailableQuantity FROM InventoryStock WHERE StockId = 1')).toBe(10);
    expect(scalar(sqlite, 'SELECT AvailableQuantity FROM InventoryStock WHERE StockId = 2')).toBe(10);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryConsumption')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryConsumptionItem')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryStockTransaction')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM InventoryAuditLog')).toBe(0);
    expect(scalar(sqlite, 'SELECT COUNT(*) FROM billing_provisional_items')).toBe(0);
  });
});
