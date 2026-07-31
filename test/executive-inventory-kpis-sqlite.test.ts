import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  getExecutiveInventoryKpiBreakdown,
  getExecutiveInventoryKpiSummary,
} from '../src/lib/executive-inventory-kpis';

type SqliteValue = string | number | bigint | null | Uint8Array;

class SqliteD1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    private readonly params: SqliteValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteD1PreparedStatement {
    return new SqliteD1PreparedStatement(
      this.database,
      this.sql,
      params.map((value) => (value === undefined ? null : value)) as SqliteValue[],
    );
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: object }> {
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

function createD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1PreparedStatement(database, sql);
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

function createHarness(): { sqlite: DatabaseSync; d1: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE InventoryItem (
      ItemId INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ItemName TEXT NOT NULL,
      ItemCode TEXT,
      ItemType TEXT,
      IssueUnit TEXT,
      UOMId INTEGER,
      ReOrderLevel REAL DEFAULT 0,
      MinStockQuantity REAL DEFAULT 0,
      IsActive INTEGER DEFAULT 1,
      ItemCategoryId INTEGER,
      SubCategoryId INTEGER
    );
    CREATE TABLE InventoryStock (
      StockId INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ItemId INTEGER NOT NULL,
      StoreId INTEGER,
      AvailableQuantity REAL DEFAULT 0,
      IsActive INTEGER DEFAULT 1,
      BatchNo TEXT,
      ExpiryDate TEXT,
      QCStatus TEXT DEFAULT 'accepted'
    );
    CREATE TABLE InventoryStore (
      StoreId INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      StoreName TEXT
    );
    CREATE TABLE InventoryItemCategory (
      ItemCategoryId INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      CategoryName TEXT
    );
    CREATE TABLE InventoryItemSubCategory (
      SubCategoryId INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      SubCategoryName TEXT
    );
    CREATE TABLE InventoryUnitOfMeasurement (
      UOMId INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      UOMName TEXT
    );
    CREATE TABLE InventoryPurchaseRequest (
      PurchaseRequestId INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      PRDate TEXT,
      PRNumber TEXT,
      Department TEXT,
      Status TEXT
    );
    CREATE TABLE InventoryStockTransaction (
      TransactionId INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ItemId INTEGER NOT NULL,
      StockId INTEGER,
      StoreId INTEGER,
      OutQuantity REAL DEFAULT 0,
      TransactionDate TEXT,
      CreatedOn TEXT,
      TransactionType TEXT,
      ReferenceNo TEXT
    );
    CREATE TABLE lab_test_catalog (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      code TEXT,
      name TEXT
    );
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      lab_order_id INTEGER,
      lab_test_id INTEGER,
      status TEXT,
      result_status TEXT,
      completed_at TEXT,
      verified_at TEXT,
      updated_at TEXT,
      accession_no TEXT,
      test_name TEXT
    );
    CREATE TABLE lab_consumables (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      code TEXT,
      name TEXT,
      unit TEXT,
      reorder_level REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE lab_consumable_stock (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      consumable_id INTEGER NOT NULL,
      lot_number TEXT,
      expiry_date TEXT,
      quantity_available REAL DEFAULT 0,
      received_date TEXT,
      created_at TEXT,
      qc_status TEXT DEFAULT 'not_required'
    );
    CREATE TABLE lab_consumable_movements (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      consumable_id INTEGER NOT NULL,
      movement_type TEXT,
      quantity REAL,
      created_at TEXT
    );
    CREATE TABLE lab_test_consumable_map (
      id INTEGER PRIMARY KEY,
      lab_test_id INTEGER NOT NULL,
      consumable_id INTEGER NOT NULL,
      qty_per_test REAL NOT NULL DEFAULT 1,
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      tenant_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      effective_from TEXT,
      effective_to TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      updated_at TEXT,
      UNIQUE(lab_test_id, consumable_id, tenant_id)
    );
    CREATE TABLE radiology_requisitions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      imaging_type_name TEXT,
      imaging_item_name TEXT,
      procedure_code TEXT,
      imaging_date TEXT,
      order_status TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  sqlite.exec(`
    INSERT INTO InventoryUnitOfMeasurement VALUES (1, 'tenant-a', 'test');
    INSERT INTO InventoryStore VALUES (1, 'tenant-a', 'Main Store');
    INSERT INTO InventoryStore VALUES (2, 'tenant-a', 'Radiology Store');
    INSERT INTO InventoryItemCategory VALUES (1, 'tenant-a', 'General');
    INSERT INTO InventoryItemCategory VALUES (2, 'tenant-a', 'Imaging Consumables');
    INSERT INTO InventoryItemSubCategory VALUES (1, 'tenant-a', 'X-ray Film');

    INSERT INTO InventoryItem VALUES (1, 'tenant-a', 'General Gloves', 'GLV', 'consumable', 'pcs', NULL, 10, 5, 1, 1, NULL);
    INSERT INTO InventoryItem VALUES (2, 'tenant-a', 'CBC Reagent', 'CBC-R', 'lab_reagent', 'test', 1, 10, 5, 1, 1, NULL);
    INSERT INTO InventoryItem VALUES (3, 'tenant-a', 'Contrast Media', 'CONTRAST', 'radiology_consumable', 'ml', NULL, 5, 2, 1, 2, 1);
    INSERT INTO InventoryItem VALUES (4, 'tenant-a', 'X-ray Film 14x17', 'XR-FILM', 'consumable', 'pcs', NULL, 10, 5, 1, 2, 1);
    INSERT INTO InventoryItem VALUES (5, 'tenant-b', 'Other Tenant Reagent', 'OTHER-R', 'lab_reagent', 'test', NULL, 10, 5, 1, NULL, NULL);
    INSERT INTO InventoryItem VALUES (6, 'tenant-a', 'Shared Protective Gloves', 'SHARED-G', 'consumable', 'pcs', NULL, 10, 5, 1, 1, NULL);

    INSERT INTO InventoryStock VALUES (1, 'tenant-a', 1, 1, 15, 1, 'G-1', '2026-07-30', 'accepted');
    INSERT INTO InventoryStock VALUES (2, 'tenant-a', 2, 1, 5, 1, 'LAB-1', '2026-06-30', 'accepted');
    INSERT INTO InventoryStock VALUES (3, 'tenant-a', 3, 2, 0, 1, 'RAD-C-1', '2027-01-01', 'accepted');
    INSERT INTO InventoryStock VALUES (4, 'tenant-a', 4, 2, 4, 1, 'XR-1', '2026-08-01', 'accepted');
    INSERT INTO InventoryStock VALUES (5, 'tenant-b', 5, NULL, 999, 1, 'OTHER-1', '2027-01-01', 'accepted');
    INSERT INTO InventoryStock VALUES (6, 'tenant-a', 6, 2, 3, 1, 'SHARED-RAD', '2026-09-01', 'accepted');
    INSERT INTO InventoryStock VALUES (7, 'tenant-a', 6, 1, 100, 1, 'SHARED-MAIN', '2026-09-01', 'accepted');

    INSERT INTO InventoryPurchaseRequest VALUES (1, 'tenant-a', '2026-07-12', 'PR-1', 'Lab', 'submitted');
    INSERT INTO InventoryPurchaseRequest VALUES (2, 'tenant-b', '2026-07-12', 'PR-2', 'Lab', 'submitted');

    INSERT INTO lab_test_catalog VALUES (1, 'tenant-a', 'CBC', 'Complete Blood Count');
    INSERT INTO lab_order_items VALUES (1, 'tenant-a', 1, 1, 'verified', 'final', '2026-07-12 10:00:00', '2026-07-12 11:00:00', '2026-07-12 11:00:00', 'ACC-1', 'CBC');
    INSERT INTO lab_order_items VALUES (2, 'tenant-a', 1, 1, 'cancelled', 'cancelled', NULL, NULL, '2026-07-12 12:00:00', 'ACC-2', 'CBC');

    INSERT INTO lab_consumables VALUES (1, 'tenant-a', 'CBC-R', 'CBC Reagent', 'test', 10, 1);
    INSERT INTO lab_consumables VALUES (2, 'tenant-b', 'OTHER-R', 'Other Reagent', 'test', 10, 1);
    INSERT INTO lab_consumables VALUES (3, 'tenant-a', 'STAIN', 'Slide Stain', 'ml', 5, 1);
    INSERT INTO lab_consumable_stock VALUES (1, 'tenant-a', 1, 'LOT-QC', '2026-08-01', 20, '2026-07-01', '2026-07-01', 'pending');
    INSERT INTO lab_consumable_stock VALUES (2, 'tenant-b', 2, 'OTHER-QC', '2026-08-01', 20, '2026-07-01', '2026-07-01', 'pending');
    INSERT INTO lab_consumable_movements VALUES (1, 'tenant-a', 1, 'usage_out', 7, '2026-07-12 09:00:00');
    INSERT INTO lab_consumable_movements VALUES (2, 'tenant-a', 1, 'return', 2, '2026-07-12 10:00:00');
    INSERT INTO lab_consumable_movements VALUES (3, 'tenant-b', 2, 'usage_out', 500, '2026-07-12 10:00:00');
    INSERT INTO lab_consumable_movements VALUES (4, 'tenant-a', 3, 'usage_out', 3, '2026-07-12 11:00:00');
    INSERT INTO lab_test_consumable_map VALUES (1, 1, 1, 5, 1, NULL, 'tenant-a', 1, NULL, NULL, NULL, NULL, NULL);

    INSERT INTO radiology_requisitions VALUES (1, 'tenant-a', 'X-ray', 'Chest X-ray', 'CXR', '2026-07-12', 'reported', 1, '2026-07-12', '2026-07-12');
    INSERT INTO radiology_requisitions VALUES (2, 'tenant-a', 'X-ray', 'Pending X-ray', 'PXR', '2026-07-12', 'pending', 1, '2026-07-12', '2026-07-12');
    INSERT INTO radiology_requisitions VALUES (3, 'tenant-b', 'X-ray', 'Other X-ray', 'OXR', '2026-07-12', 'reported', 1, '2026-07-12', '2026-07-12');

    INSERT INTO InventoryStockTransaction VALUES (1, 'tenant-a', 4, 4, 2, 2, '2026-07-12', '2026-07-12', 'issue', 'RAD-ISSUE-1');
    INSERT INTO InventoryStockTransaction VALUES (2, 'tenant-b', 5, 5, NULL, 100, '2026-07-12', '2026-07-12', 'issue', 'OTHER-ISSUE');
  `);

  return { sqlite, d1: createD1(sqlite) };
}

describe('executive inventory KPI SQL against production-shaped SQLite', () => {
  it('reconciles stock, lab, and radiology metrics without mixing tenants', async () => {
    const { d1 } = createHarness();
    const summary = await getExecutiveInventoryKpiSummary(d1, 'tenant-a', '2026-07-12', '2026-07-12');

    expect(summary).toMatchObject({
      inventory_stock_skus: 4,
      inventory_low_stock: 2,
      inventory_out_of_stock: 1,
      inventory_pending_purchase: 1,
      lab_tests_completed: 1,
      lab_reagent_consumed: 2,
      lab_reagent_stock_skus: 1,
      lab_reagent_low_stock: 1,
      lab_reagent_out_of_stock: 0,
      lab_reagent_qc_issues: 1,
      radiology_exams_completed: 1,
      radiology_stock_skus: 2,
      radiology_low_stock: 2,
      radiology_out_of_stock: 1,
      radiology_issue_lines: 1,
    });
  });

  it('keeps stock summaries available when the optional purchase-request table is missing', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec('DROP TABLE InventoryPurchaseRequest;');

    const summary = await getExecutiveInventoryKpiSummary(d1, 'tenant-a', '2026-07-12', '2026-07-12');
    expect(summary.inventory_stock_skus).toBe(4);
    expect(summary.inventory_low_stock).toBe(2);
    expect(summary.inventory_pending_purchase).toBe(0);
    expect(summary.lab_tests_completed).toBe(1);
    expect(summary.radiology_exams_completed).toBe(1);
  });

  it('keeps inventory and radiology summaries available when an optional lab workflow table is missing', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec('DROP TABLE lab_order_items;');

    const summary = await getExecutiveInventoryKpiSummary(d1, 'tenant-a', '2026-07-12', '2026-07-12');
    expect(summary.inventory_stock_skus).toBe(4);
    expect(summary.lab_reagent_stock_skus).toBe(1);
    expect(summary.radiology_exams_completed).toBe(1);
    expect(summary.lab_tests_completed).toBe(0);
    expect(summary.lab_reagent_consumed).toBe(0);
    expect(summary.lab_reagent_qc_issues).toBe(0);
  });

  it('counts consumed reagent SKUs without adding incompatible units and preserves exact item usage', async () => {
    const { d1 } = createHarness();
    const breakdown = await getExecutiveInventoryKpiBreakdown(
      d1,
      'tenant-a',
      'lab_reagent_consumed',
      '2026-07-12',
      '2026-07-12',
      { page: 1, pageSize: 25, offset: 0 },
    );

    expect(breakdown.total).toBe(2);
    expect(breakdown.totalRows).toBe(2);
    expect(breakdown.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ item_name: 'CBC Reagent', unit_name: 'test', consumed_quantity: 5 }),
      expect.objectContaining({ item_name: 'Slide Stain', unit_name: 'ml', consumed_quantity: 3 }),
    ]));
  });

  it('scopes store-based radiology fallback stock to the radiology store only', async () => {
    const { d1 } = createHarness();
    const breakdown = await getExecutiveInventoryKpiBreakdown(
      d1,
      'tenant-a',
      'radiology_low_stock',
      '2026-07-12',
      '2026-07-12',
      { page: 1, pageSize: 25, offset: 0 },
    );

    expect(breakdown.total).toBe(2);
    expect(breakdown.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        item_name: 'Shared Protective Gloves',
        available_quantity: 3,
        store_name: 'Radiology Store',
        batch_no: 'SHARED-RAD',
      }),
    ]));
    expect(breakdown.rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ item_name: 'Shared Protective Gloves', available_quantity: 103 }),
    ]));
  });

  it('returns item, unit, store, lot, and expiry details from the same total source', async () => {
    const { d1 } = createHarness();
    const breakdown = await getExecutiveInventoryKpiBreakdown(
      d1,
      'tenant-a',
      'inventory_stock_skus',
      '2026-07-12',
      '2026-07-12',
      { page: 1, pageSize: 25, offset: 0 },
    );

    expect(breakdown.total).toBe(4);
    expect(breakdown.rows).toHaveLength(4);
    expect(breakdown.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        item_name: 'CBC Reagent',
        item_code: 'CBC-R',
        unit_name: 'test',
        available_quantity: 5,
        reorder_level: 10,
        store_name: 'Main Store',
        batch_no: 'LAB-1',
        expiry_date: '2026-06-30',
      }),
      expect.objectContaining({
        item_name: 'X-ray Film 14x17',
        unit_name: 'pcs',
        store_name: 'Radiology Store',
      }),
    ]));
  });
});
