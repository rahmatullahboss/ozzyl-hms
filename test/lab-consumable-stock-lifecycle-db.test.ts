import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { consumeLabConsumableStock, consumeMappedLabConsumables, recordLabInventoryException, reverseMappedLabConsumablesForOrderItem } from '../src/lib/lab-consumables';
import { getLabInventoryStrictModeReadiness } from '../src/lib/lab-inventory-policy';
import { createCanonicalReagentStock } from '../src/lib/lab-reagent-stock-sync';
import labMonitoring from '../src/routes/tenant/labMonitoring.ts';
import type { Env, Variables } from '../src/types';

const TENANT_ID = 91001;
const USER_ID = 991;
const LAB_TEST_ID = 81001;
const LAB_ORDER_ID = 82001;

type SqliteValue = string | number | bigint | null | Uint8Array;

type RunMeta = { changes: number; last_row_id: number; duration: number };

class SqliteD1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqliteValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteD1PreparedStatement {
    return new SqliteD1PreparedStatement(
      this.database,
      this.sql,
      params.map((param) => (param === undefined ? null : param)) as SqliteValue[],
    );
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta: object }> {
    const statement = this.database.prepare(this.sql);
    return { results: statement.all(...this.params) as T[], success: true, meta: {} };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const statement = this.database.prepare(this.sql);
    return (statement.get(...this.params) as T | undefined) ?? null;
  }

  async run(): Promise<{ success: boolean; meta: RunMeta }> {
    const statement = this.database.prepare(this.sql);
    const result = statement.run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const statement = this.database.prepare(this.sql);
    const rows = statement.all(...this.params) as Record<string, unknown>[];
    return rows.map((row) => Object.values(row) as T);
  }
}

interface SqliteHarness {
  sqlite: DatabaseSync;
  d1: D1Database;
  app: Hono<{ Bindings: Env; Variables: Variables }>;
}

function createSqliteD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1PreparedStatement(database, sql);
    },
    batch: async (statements: SqliteD1PreparedStatement[]) => {
      database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    exec: async (sql: string) => {
      database.exec(sql);
      return { count: 0, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function applyLabStockSchema(sqlite: DatabaseSync): void {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE lab_test_catalog (id INTEGER PRIMARY KEY, code TEXT, name TEXT, is_active INTEGER NOT NULL DEFAULT 1, tenant_id INTEGER, billing_service_item_id INTEGER, is_outsourced INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE billing_service_items (id INTEGER PRIMARY KEY, item_name TEXT, item_code TEXT, is_active INTEGER NOT NULL DEFAULT 1, tenant_id INTEGER);
    CREATE TABLE lab_orders (id INTEGER PRIMARY KEY, tenant_id INTEGER);
    CREATE TABLE radiology_requisitions (id INTEGER PRIMARY KEY);
    CREATE TABLE radiology_reports (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_machines (id INTEGER PRIMARY KEY);
    CREATE TABLE film_types (id INTEGER PRIMARY KEY);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, tenant_id INTEGER);
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      table_name TEXT,
      record_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE billing_provisional_items (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER,
      billed_bill_id INTEGER,
      admission_id INTEGER
    );
  `);

  const migrationFiles = [
    '0170_lab_consumables_monitoring.sql',
    ...readdirSync('migrations')
      .filter((name) => /^037[2-9]_lab_(consumable|operation_logs)/.test(name))
      .sort(),
    '0392_lab_reagent_analyzer_assignments.sql',
    '0393_lab_inventory_policy.sql',
    '0394_lab_inventory_exception_and_claim_lifecycle.sql',
    '0395_lab_inventory_policy_modes.sql',
    '0396_lab_test_consumable_map_lifecycle.sql',
    '0398_lab_consumable_movement_ledger_type.sql',
    '0400_inventory_reagent_integrity_hardening.sql',
    '0409_small_hospital_reagent_billing_hardening.sql',
  ];

  for (const file of migrationFiles) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }

  sqlite.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(TENANT_ID, 'Lifecycle Tenant');
  sqlite.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(USER_ID, 'Lab Admin');
  sqlite.prepare('INSERT INTO billing_service_items (id, item_name, item_code, tenant_id) VALUES (?, ?, ?, ?)')
    .run(1, 'CBC Lifecycle', 'CBC-LIFE', TENANT_ID);
  sqlite.prepare('INSERT INTO lab_test_catalog (id, code, name, tenant_id, billing_service_item_id) VALUES (?, ?, ?, ?, ?)')
    .run(LAB_TEST_ID, 'CBC-LIFE', 'CBC Lifecycle', TENANT_ID, 1);
  sqlite.prepare('INSERT INTO lab_orders (id, tenant_id) VALUES (?, ?)').run(LAB_ORDER_ID, TENANT_ID);
}

function createHarness(): SqliteHarness {
  const sqlite = new DatabaseSync(':memory:');
  applyLabStockSchema(sqlite);
  const d1 = createSqliteD1(sqlite);
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.set('tenantId', String(TENANT_ID));
    c.set('userId', String(USER_ID));
    c.set('role', 'hospital_admin');
    c.env = { DB: d1 } as unknown as Env;
    await next();
  });
  app.route('/lab-monitoring', labMonitoring);
  app.onError((err, c) => {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ error: err.message }, status as Parameters<typeof c.json>[1]);
  });

  return { sqlite, d1, app };
}

async function postJson<T = Record<string, unknown>>(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  body: unknown,
): Promise<{ status: number; body: T }> {
  const response = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const rawBody = await response.text();
  try {
    return { status: response.status, body: JSON.parse(rawBody) as T };
  } catch {
    return { status: response.status, body: { error: rawBody } as T };
  }
}

async function getJson<T = Record<string, unknown>>(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
): Promise<{ status: number; body: T }> {
  const response = await app.request(path);
  const rawBody = await response.text();
  try {
    return { status: response.status, body: JSON.parse(rawBody) as T };
  } catch {
    return { status: response.status, body: { error: rawBody } as T };
  }
}

function insertConsumable(sqlite: DatabaseSync, category: string = 'reagent'): number {
  const result = sqlite.prepare(`
    INSERT INTO lab_consumables (code, name, category, unit, unit_price, reorder_level, reorder_qty, tenant_id, created_by)
    VALUES (?, ?, ?, 'mL', 100, 5, 10, ?, ?)
  `).run(`LC-${Date.now()}-${Math.random()}`, `Lifecycle ${category}`, category, TENANT_ID, USER_ID);
  return Number(result.lastInsertRowid);
}

function insertLocation(sqlite: DatabaseSync, code: string): number {
  const result = sqlite.prepare(`
    INSERT INTO lab_consumable_locations (location_code, location_name, location_type, tenant_id, created_by)
    VALUES (?, ?, 'store', ?, ?)
  `).run(code, `${code} Store`, TENANT_ID, USER_ID);
  return Number(result.lastInsertRowid);
}

function insertStock(
  sqlite: DatabaseSync,
  consumableId: number,
  options: { quantity?: number; qcStatus?: string; expiryDate?: string | null; locationId?: number | null } = {},
): number {
  const result = sqlite.prepare(`
    INSERT INTO lab_consumable_stock
      (consumable_id, lot_number, expiry_date, quantity_received, purchase_price, received_date, remarks, qc_status, location_id, tenant_id, created_by)
    VALUES (?, ?, ?, ?, 75, '2026-01-01', 'seed', ?, ?, ?, ?)
  `).run(
    consumableId,
    `LOT-${Date.now()}-${Math.random()}`,
    options.expiryDate ?? '2099-12-31',
    options.quantity ?? 10,
    options.qcStatus ?? 'passed',
    options.locationId ?? null,
    TENANT_ID,
    USER_ID,
  );
  return Number(result.lastInsertRowid);
}

function installCanonicalInventorySchema(sqlite: DatabaseSync): void {
  sqlite.exec(readFileSync('migrations/0378_lab_inventory_bridge_links.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE InventoryItemCategory (
      ItemCategoryId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      CategoryName TEXT NOT NULL,
      CategoryCode TEXT,
      Description TEXT,
      IsActive INTEGER DEFAULT 1,
      CreatedBy INTEGER,
      CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE InventoryUnitOfMeasurement (
      UOMId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      UOMName TEXT NOT NULL,
      Description TEXT,
      IsActive INTEGER DEFAULT 1,
      CreatedBy INTEGER,
      CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE InventoryItem (
      ItemId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      ItemName TEXT NOT NULL,
      ItemCode TEXT,
      ItemCategoryId INTEGER,
      UOMId INTEGER,
      StandardRate REAL DEFAULT 0,
      ReOrderLevel INTEGER DEFAULT 0,
      Description TEXT,
      IsActive INTEGER DEFAULT 1,
      CreatedBy INTEGER,
      CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
      ItemType TEXT DEFAULT 'general',
      PurchasePrice REAL DEFAULT 0,
      StorageCondition TEXT,
      IsBatchRequired INTEGER DEFAULT 0,
      IsExpiryRequired INTEGER DEFAULT 0
    );
    CREATE TABLE InventoryStore (
      StoreId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      StoreName TEXT NOT NULL,
      StoreCode TEXT,
      StoreType TEXT DEFAULT 'main',
      Address TEXT,
      ParentStoreId INTEGER,
      IsActive INTEGER DEFAULT 1,
      CreatedBy INTEGER,
      CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE InventoryStock (
      StockId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      ItemId INTEGER NOT NULL,
      StoreId INTEGER NOT NULL,
      BatchNo TEXT,
      ExpiryDate TEXT,
      AvailableQuantity INTEGER DEFAULT 0,
      CostPrice REAL DEFAULT 0,
      MRP REAL DEFAULT 0,
      IsActive INTEGER DEFAULT 1,
      CreatedBy INTEGER,
      CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
      ReservedQuantity INTEGER DEFAULT 0,
      DamagedQuantity INTEGER DEFAULT 0,
      BlockedQuantity INTEGER DEFAULT 0,
      QCStatus TEXT DEFAULT 'accepted',
      OpenDate TEXT,
      AfterOpenExpiryDate TEXT,
      StockStatus TEXT DEFAULT 'available'
    );
    CREATE TABLE InventoryStockTransaction (
      TransactionId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      ItemId INTEGER NOT NULL,
      StockId INTEGER NOT NULL,
      StoreId INTEGER NOT NULL,
      TransactionType TEXT NOT NULL,
      ReferenceNo TEXT,
      ReferenceId INTEGER,
      InQuantity INTEGER DEFAULT 0,
      OutQuantity INTEGER DEFAULT 0,
      BalanceQuantity INTEGER DEFAULT 0,
      TransactionDate TEXT,
      Remarks TEXT,
      CreatedBy INTEGER,
      CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function prepareStrictPolicyReadiness(sqlite: DatabaseSync): number {
  const consumableId = insertConsumable(sqlite, 'reagent');
  insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });
  sqlite.prepare(`
    INSERT INTO lab_test_consumable_map
      (lab_test_id, consumable_id, qty_per_test, is_mandatory, notes, tenant_id, is_active, effective_from)
    VALUES (?, ?, 1, 1, 'strict readiness fixture', ?, 1, CURRENT_TIMESTAMP)
  `).run(LAB_TEST_ID, consumableId, TENANT_ID);
  return consumableId;
}

function firstRow<T = Record<string, unknown>>(sqlite: DatabaseSync, sql: string, ...params: SqliteValue[]): T {
  const row = sqlite.prepare(sql).get(...params) as T | undefined;
  expect(row).toBeTruthy();
  return row as T;
}

async function expectHttpStatus(promise: Promise<unknown>, status: number): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status });
}

describe('lab stock lifecycle DB integration', () => {
  it('stock-in reagent defaults to QC pending', async () => {
    const { app, sqlite } = createHarness();
    installCanonicalInventorySchema(sqlite);
    const consumableId = insertConsumable(sqlite, 'reagent');

    const response = await postJson<{ id: number; qc_status: string }>(app, '/lab-monitoring/stock/in', {
      consumable_id: consumableId,
      lot_number: 'QC-PENDING-1',
      expiry_date: '2099-12-31',
      quantity: 10,
      purchase_price: 75,
    });

    expect(response.status).toBe(201);
    expect(response.body.qc_status).toBe('pending');
    const stock = firstRow<{ qc_status: string; quantity_available: number }>(
      sqlite,
      'SELECT qc_status, quantity_available FROM lab_consumable_stock WHERE id = ?',
      response.body.id,
    );
    expect(stock).toMatchObject({ qc_status: 'pending', quantity_available: 10 });
  });

  it('creates canonical inventory stock from reagent stock-in and deduplicates retries', async () => {
    const { app, sqlite } = createHarness();
    installCanonicalInventorySchema(sqlite);
    const consumableId = insertConsumable(sqlite, 'reagent');
    const locationId = insertLocation(sqlite, 'LAB-COLD');
    const payload = {
      consumable_id: consumableId,
      lot_number: 'CANONICAL-LOT-1',
      expiry_date: '2099-12-31',
      quantity: 10,
      purchase_price: 75,
      location_id: locationId,
      idempotency_key: 'stock-in-test-1',
    };

    const response = await postJson<{
      id: number;
      inventory_stock_id: number;
      inventory_item_id: number;
      inventory_store_id: number;
      qc_status: string;
      deduplicated: boolean;
    }>(app, '/lab-monitoring/stock/in', payload);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ qc_status: 'pending', deduplicated: false });
    expect(response.body.inventory_stock_id).toBeGreaterThan(0);
    expect(response.body.inventory_item_id).toBeGreaterThan(0);
    expect(response.body.inventory_store_id).toBeGreaterThan(0);

    const consumable = firstRow<{ inventory_item_id: number }>(
      sqlite,
      'SELECT inventory_item_id FROM lab_consumables WHERE id = ?',
      consumableId,
    );
    expect(consumable.inventory_item_id).toBe(response.body.inventory_item_id);

    const canonicalStock = firstRow<{
      ItemId: number;
      StoreId: number;
      BatchNo: string;
      ExpiryDate: string;
      AvailableQuantity: number;
      QCStatus: string;
    }>(sqlite, 'SELECT ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, QCStatus FROM InventoryStock WHERE StockId = ?', response.body.inventory_stock_id);
    expect(canonicalStock).toMatchObject({
      ItemId: response.body.inventory_item_id,
      StoreId: response.body.inventory_store_id,
      BatchNo: 'CANONICAL-LOT-1',
      ExpiryDate: '2099-12-31',
      AvailableQuantity: 10,
      QCStatus: 'pending',
    });

    const inventoryOverviewRow = firstRow<{
      StockId: number;
      ItemName: string;
      StoreName: string;
      BatchNo: string;
      AvailableQuantity: number;
    }>(sqlite, `
      SELECT S.StockId, I.ItemName, ST.StoreName, S.BatchNo, S.AvailableQuantity
      FROM InventoryStock S
      JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
      JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
      WHERE S.StockId = ? AND S.tenant_id = ?
    `, response.body.inventory_stock_id, String(TENANT_ID));
    expect(inventoryOverviewRow).toMatchObject({
      StockId: response.body.inventory_stock_id,
      StoreName: 'LAB-COLD Store',
      BatchNo: 'CANONICAL-LOT-1',
      AvailableQuantity: 10,
    });
    expect(inventoryOverviewRow.ItemName).toContain('Lifecycle reagent');

    const compatibilityStock = firstRow<{ inventory_stock_id: number }>(
      sqlite,
      'SELECT inventory_stock_id FROM lab_consumable_stock WHERE id = ?',
      response.body.id,
    );
    expect(compatibilityStock.inventory_stock_id).toBe(response.body.inventory_stock_id);

    const transaction = firstRow<{ TransactionType: string; ReferenceNo: string; BalanceQuantity: number }>(
      sqlite,
      'SELECT TransactionType, ReferenceNo, BalanceQuantity FROM InventoryStockTransaction WHERE StockId = ?',
      response.body.inventory_stock_id,
    );
    expect(transaction).toMatchObject({
      TransactionType: 'lab-stock-in',
      ReferenceNo: 'LAB-STOCK-IN:stock-in-test-1',
      BalanceQuantity: 10,
    });

    const retry = await postJson<typeof response.body>(app, '/lab-monitoring/stock/in', payload);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({
      id: response.body.id,
      inventory_stock_id: response.body.inventory_stock_id,
      deduplicated: true,
    });
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStock').count).toBe(1);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM lab_consumable_stock').count).toBe(1);
  });

  it('rejects malformed reagent expiry dates before creating canonical stock', async () => {
    const { app, sqlite } = createHarness();
    installCanonicalInventorySchema(sqlite);
    const consumableId = insertConsumable(sqlite, 'reagent');

    const response = await postJson<{ error: string }>(app, '/lab-monitoring/stock/in', {
      consumable_id: consumableId,
      lot_number: 'INVALID-DATE-LOT',
      expiry_date: '31-12-2099',
      quantity: 5,
      purchase_price: 50,
      idempotency_key: 'invalid-date-stock-key',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Expiry date must use YYYY-MM-DD');
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStock').count).toBe(0);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM lab_consumable_stock').count).toBe(0);
  });

  it('reuses the linked inventory item while creating a separate canonical lot', async () => {
    const { app, sqlite } = createHarness();
    installCanonicalInventorySchema(sqlite);
    const consumableId = insertConsumable(sqlite, 'reagent');

    const first = await postJson<{ inventory_item_id: number; inventory_stock_id: number }>(app, '/lab-monitoring/stock/in', {
      consumable_id: consumableId,
      lot_number: 'SEPARATE-LOT-1',
      expiry_date: '2099-12-31',
      quantity: 5,
      purchase_price: 50,
      idempotency_key: 'separate-stock-key-1',
    });
    const second = await postJson<{ inventory_item_id: number; inventory_stock_id: number }>(app, '/lab-monitoring/stock/in', {
      consumable_id: consumableId,
      lot_number: 'SEPARATE-LOT-2',
      expiry_date: '2099-11-30',
      quantity: 6,
      purchase_price: 60,
      idempotency_key: 'separate-stock-key-2',
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.inventory_item_id).toBe(first.body.inventory_item_id);
    expect(second.body.inventory_stock_id).not.toBe(first.body.inventory_stock_id);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryItem').count).toBe(1);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStock').count).toBe(2);
  });

  it('rolls back canonical lot, transaction and compatibility rows when stock-in batching fails', async () => {
    const { app, sqlite } = createHarness();
    installCanonicalInventorySchema(sqlite);
    const consumableId = insertConsumable(sqlite, 'reagent');
    sqlite.exec(`
      CREATE TRIGGER reject_canonical_reagent_movement
      BEFORE INSERT ON lab_consumable_movements
      WHEN NEW.reference_type = 'inventory_stock_in'
      BEGIN
        SELECT RAISE(ABORT, 'forced canonical movement failure');
      END;
    `);

    const response = await postJson<{ error: string }>(app, '/lab-monitoring/stock/in', {
      consumable_id: consumableId,
      lot_number: 'ROLLBACK-LOT-1',
      expiry_date: '2099-12-31',
      quantity: 5,
      purchase_price: 50,
      idempotency_key: 'rollback-stock-key',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('forced canonical movement failure');
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStock').count).toBe(0);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStockTransaction').count).toBe(0);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM lab_consumable_stock').count).toBe(0);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM lab_consumable_movements').count).toBe(0);
  });

  it('rejects reusing a reagent stock-in idempotency key for a different request', async () => {
    const { app, sqlite } = createHarness();
    installCanonicalInventorySchema(sqlite);
    const firstConsumableId = insertConsumable(sqlite, 'reagent');
    const secondConsumableId = insertConsumable(sqlite, 'reagent');

    const first = await postJson(app, '/lab-monitoring/stock/in', {
      consumable_id: firstConsumableId,
      lot_number: 'IDEMPOTENT-LOT-1',
      expiry_date: '2099-12-31',
      quantity: 5,
      purchase_price: 50,
      idempotency_key: 'shared-stock-key',
    });
    expect(first.status).toBe(201);

    const collision = await postJson<{ error: string }>(app, '/lab-monitoring/stock/in', {
      consumable_id: secondConsumableId,
      lot_number: 'IDEMPOTENT-LOT-2',
      expiry_date: '2099-12-31',
      quantity: 9,
      purchase_price: 90,
      idempotency_key: 'shared-stock-key',
    });

    expect(collision.status).toBe(400);
    expect(collision.body.error).toContain('Idempotency key');
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStock').count).toBe(1);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM lab_consumable_stock').count).toBe(1);
  });

  it('returns the winning canonical stock when a concurrent idempotent request commits first', async () => {
    const { sqlite, d1 } = createHarness();
    installCanonicalInventorySchema(sqlite);
    const consumableId = insertConsumable(sqlite, 'reagent');
    const input = {
      tenantId: TENANT_ID,
      userId: USER_ID,
      consumableId,
      lotNumber: 'RACE-LOT-1',
      expiryDate: '2099-12-31',
      quantity: 7,
      purchasePrice: 70,
      receivedDate: '2026-07-12',
      idempotencyKey: 'race-stock-key-1',
    };

    const competingD1 = {
      ...(d1 as unknown as Record<string, unknown>),
      batch: async () => {
        const item = firstRow<{ inventory_item_id: number }>(
          sqlite,
          'SELECT inventory_item_id FROM lab_consumables WHERE id = ?',
          consumableId,
        );
        const store = firstRow<{ StoreId: number }>(
          sqlite,
          'SELECT StoreId FROM InventoryStore ORDER BY StoreId LIMIT 1',
        );
        const stockResult = sqlite.prepare(`
          INSERT INTO InventoryStock
            (tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity,
             CostPrice, MRP, IsActive, CreatedBy, QCStatus, StockStatus)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'pending', 'available')
        `).run(
          TENANT_ID,
          item.inventory_item_id,
          store.StoreId,
          input.lotNumber,
          input.expiryDate,
          input.quantity,
          input.purchasePrice,
          input.purchasePrice,
          USER_ID,
        );
        const stockId = Number(stockResult.lastInsertRowid);
        sqlite.prepare(`
          INSERT INTO InventoryStockTransaction
            (tenant_id, ItemId, StockId, StoreId, TransactionType, ReferenceNo,
             ReferenceId, InQuantity, BalanceQuantity, TransactionDate, CreatedBy)
          VALUES (?, ?, ?, ?, 'lab-stock-in', ?, ?, ?, ?, ?, ?)
        `).run(
          TENANT_ID,
          item.inventory_item_id,
          stockId,
          store.StoreId,
          `LAB-STOCK-IN:${input.idempotencyKey}`,
          consumableId,
          input.quantity,
          input.quantity,
          input.receivedDate,
          USER_ID,
        );
        const labStockResult = sqlite.prepare(`
          INSERT INTO lab_consumable_stock
            (consumable_id, lot_number, expiry_date, quantity_received, purchase_price,
             received_date, qc_status, tenant_id, created_by, inventory_stock_id)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).run(
          consumableId,
          input.lotNumber,
          input.expiryDate,
          input.quantity,
          input.purchasePrice,
          input.receivedDate,
          TENANT_ID,
          USER_ID,
          stockId,
        );
        expect(Number(labStockResult.lastInsertRowid)).toBeGreaterThan(0);
        throw new Error('UNIQUE constraint failed: InventoryStockTransaction.tenant_id');
      },
    } as unknown as D1Database;

    const result = await createCanonicalReagentStock(competingD1, input);

    expect(result).toMatchObject({
      deduplicated: true,
      inventoryStockId: 1,
      labStockId: 1,
    });
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStock').count).toBe(1);
  });

  it('keeps non-reagent consumable stock on the legacy lab ledger', async () => {
    const { app, sqlite } = createHarness();
    installCanonicalInventorySchema(sqlite);
    const consumableId = insertConsumable(sqlite, 'tube');

    const response = await postJson<{ id: number; qc_status: string }>(app, '/lab-monitoring/stock/in', {
      consumable_id: consumableId,
      quantity: 12,
      purchase_price: 20,
    });

    expect(response.status).toBe(201);
    expect(response.body.qc_status).toBe('not_required');
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStock').count).toBe(0);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStockTransaction').count).toBe(0);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM lab_consumable_stock WHERE consumable_id = ?', consumableId).count).toBe(1);
  });

  it('backfills legacy reagent stock into canonical inventory exactly once', async () => {
    const { app, sqlite } = createHarness();
    installCanonicalInventorySchema(sqlite);
    const consumableId = insertConsumable(sqlite, 'reagent');
    const locationId = insertLocation(sqlite, 'LAB-BACKFILL');
    const labStockId = insertStock(sqlite, consumableId, {
      quantity: 8,
      qcStatus: 'passed',
      expiryDate: '2099-12-31',
      locationId,
    });

    const first = await postJson<{
      summary: {
        scanned: number;
        created: number;
        alreadyLinked: number;
        skipped: number;
        failed: number;
      };
    }>(app, '/lab-monitoring/stock/backfill-canonical', {});

    expect(first.status).toBe(200);
    expect(first.body.summary).toMatchObject({
      scanned: 1,
      created: 1,
      alreadyLinked: 0,
      skipped: 0,
      failed: 0,
    });

    const linked = firstRow<{ inventory_stock_id: number }>(
      sqlite,
      'SELECT inventory_stock_id FROM lab_consumable_stock WHERE id = ?',
      labStockId,
    );
    expect(linked.inventory_stock_id).toBeGreaterThan(0);

    const inventoryStock = firstRow<{
      BatchNo: string;
      AvailableQuantity: number;
      QCStatus: string;
    }>(
      sqlite,
      'SELECT BatchNo, AvailableQuantity, QCStatus FROM InventoryStock WHERE StockId = ?',
      linked.inventory_stock_id,
    );
    expect(inventoryStock).toMatchObject({
      AvailableQuantity: 8,
      QCStatus: 'passed',
    });
    expect(inventoryStock.BatchNo).toMatch(/^LOT-/);

    const transaction = firstRow<{ TransactionType: string; ReferenceNo: string }>(
      sqlite,
      'SELECT TransactionType, ReferenceNo FROM InventoryStockTransaction WHERE StockId = ?',
      linked.inventory_stock_id,
    );
    expect(transaction).toMatchObject({
      TransactionType: 'lab-legacy-backfill',
      ReferenceNo: `LAB-LEGACY-STOCK:${labStockId}`,
    });

    const second = await postJson<typeof first.body>(app, '/lab-monitoring/stock/backfill-canonical', {});
    expect(second.status).toBe(200);
    expect(second.body.summary).toMatchObject({
      scanned: 1,
      created: 0,
      alreadyLinked: 1,
      skipped: 0,
      failed: 0,
    });
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStock').count).toBe(1);
    expect(firstRow<{ count: number }>(sqlite, 'SELECT COUNT(*) AS count FROM InventoryStockTransaction').count).toBe(1);
  });

  it('does not relink canonical inventory movements that only share a numeric stock id with legacy stock', async () => {
    const { app, sqlite } = createHarness();
    installCanonicalInventorySchema(sqlite);
    const consumableId = insertConsumable(sqlite, 'reagent');
    const labStockId = insertStock(sqlite, consumableId, {
      quantity: 6,
      qcStatus: 'passed',
      expiryDate: '2099-12-31',
    });

    sqlite.prepare(`
      INSERT INTO InventoryItemCategory (tenant_id, CategoryName, CategoryCode, IsActive)
      VALUES (?, 'Existing reagent', 'EXISTING-REAGENT', 1)
    `).run(TENANT_ID);
    const categoryId = Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
    sqlite.prepare(`
      INSERT INTO InventoryUnitOfMeasurement (tenant_id, UOMName, IsActive)
      VALUES (?, 'mL', 1)
    `).run(TENANT_ID);
    const uomId = Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
    sqlite.prepare(`
      INSERT INTO InventoryItem
        (ItemId, tenant_id, ItemName, ItemCode, ItemCategoryId, UOMId, ItemType, IsActive)
      VALUES (?, ?, 'Existing canonical reagent', 'EXISTING-CANONICAL', ?, ?, 'lab_reagent', 1)
    `).run(9001, TENANT_ID, categoryId, uomId);
    sqlite.prepare(`
      INSERT INTO InventoryStore (StoreId, tenant_id, StoreName, StoreCode, IsActive)
      VALUES (9001, ?, 'Existing Store', 'EXISTING', 1)
    `).run(TENANT_ID);
    sqlite.prepare(`
      INSERT INTO InventoryStock
        (StockId, tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, QCStatus, StockStatus)
      VALUES (?, ?, 9001, 9001, 'EXISTING-LOT', '2099-12-31', 4, 'passed', 'available')
    `).run(labStockId, TENANT_ID);
    const movementResult = sqlite.prepare(`
      INSERT INTO lab_consumable_movements
        (consumable_id, stock_id, ledger_type, lab_stock_id, inventory_stock_id,
         movement_type, quantity, unit_cost, reference_type, tenant_id)
      VALUES (?, ?, 'inventory', NULL, ?, 'usage_out', 1, 0, 'existing_inventory_usage', ?)
    `).run(consumableId, labStockId, labStockId, TENANT_ID);
    const movementId = Number(movementResult.lastInsertRowid);

    const response = await postJson<{ summary: { created: number; failed: number } }>(
      app,
      '/lab-monitoring/stock/backfill-canonical',
      {},
    );
    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({ created: 1, failed: 0 });

    const movement = firstRow<{
      stock_id: number;
      ledger_type: string;
      lab_stock_id: number | null;
      inventory_stock_id: number;
    }>(
      sqlite,
      'SELECT stock_id, ledger_type, lab_stock_id, inventory_stock_id FROM lab_consumable_movements WHERE id = ?',
      movementId,
    );
    expect(movement).toEqual({
      stock_id: labStockId,
      ledger_type: 'inventory',
      lab_stock_id: null,
      inventory_stock_id: labStockId,
    });
  });

  it('shows pending and failed lots in stock controls while total stock counts only production-usable lots', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const passedId = insertStock(sqlite, consumableId, { quantity: 4, qcStatus: 'passed' });
    const pendingId = insertStock(sqlite, consumableId, { quantity: 7, qcStatus: 'pending' });
    const failedId = insertStock(sqlite, consumableId, { quantity: 9, qcStatus: 'failed' });

    const response = await app.request(`/lab-monitoring/consumables/${consumableId}`);

    expect(response.status).toBe(200);
    const body = await response.json() as { consumable: { total_stock: number }; stock: Array<{ id: number; qc_status: string }> };
    expect(Number(body.consumable.total_stock)).toBe(4);
    expect(body.stock.map((lot) => lot.id).sort((a, b) => a - b)).toEqual([passedId, pendingId, failedId].sort((a, b) => a - b));
    expect(Object.fromEntries(body.stock.map((lot) => [lot.id, lot.qc_status]))).toMatchObject({
      [passedId]: 'passed',
      [pendingId]: 'pending',
      [failedId]: 'failed',
    });
  });

  it('lists active stock lots across all consumables and filters by consumable', async () => {
    const { app, sqlite } = createHarness();
    const legacyConsumableId = insertConsumable(sqlite, 'reagent');
    const linkedConsumableId = insertConsumable(sqlite, 'reagent');
    const zeroInventoryConsumableId = insertConsumable(sqlite, 'reagent');
    const legacyLotId = insertStock(sqlite, legacyConsumableId, { quantity: 6, qcStatus: 'passed' });
    const linkedShadowLotId = insertStock(sqlite, linkedConsumableId, { quantity: 3, qcStatus: 'passed' });
    const zeroInventoryLotId = insertStock(sqlite, zeroInventoryConsumableId, { quantity: 8, qcStatus: 'passed' });

    sqlite.exec(`
      ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
      CREATE TABLE InventoryStore (
        StoreId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        StoreName TEXT NOT NULL,
        StoreCode TEXT,
        StoreType TEXT DEFAULT 'main',
        IsActive INTEGER DEFAULT 1
      );
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ItemId INTEGER,
        StoreId INTEGER,
        BatchNo TEXT,
        ExpiryDate TEXT,
        AvailableQuantity INTEGER DEFAULT 0,
        CostPrice REAL DEFAULT 0,
        IsActive INTEGER DEFAULT 1
      );
    `);

    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = ? WHERE id = ?').run(7101, linkedConsumableId);
    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = 0 WHERE id = ?').run(zeroInventoryConsumableId);
    sqlite.prepare(`
      INSERT INTO InventoryStore (StoreId, tenant_id, StoreName, StoreCode, StoreType)
      VALUES (1, ?, 'Lab Main Store', 'LAB-MAIN', 'lab')
    `).run(String(TENANT_ID));
    sqlite.prepare(`
      INSERT INTO InventoryStock (StockId, tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, CostPrice, IsActive)
      VALUES (501, ?, 7101, 1, 'INV-ALL-1', '2099-12-31', 12, 81, 1)
    `).run(String(TENANT_ID));

    const allResponse = await getJson<{ data: Array<Record<string, unknown>> }>(app, '/lab-monitoring/stock/lots');

    expect(allResponse.status).toBe(200);
    expect(allResponse.body.data).toHaveLength(3);
    expect(allResponse.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: legacyLotId,
        consumable_id: legacyConsumableId,
        ledger_type: 'lab',
        quantity_available: 6,
      }),
      expect.objectContaining({
        id: 501,
        consumable_id: linkedConsumableId,
        lot_number: 'INV-ALL-1',
        ledger_type: 'inventory',
        quantity_available: 12,
        location_code: 'LAB-MAIN',
      }),
      expect.objectContaining({
        id: zeroInventoryLotId,
        consumable_id: zeroInventoryConsumableId,
        ledger_type: 'lab',
        quantity_available: 8,
      }),
    ]));
    expect(allResponse.body.data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: linkedShadowLotId, ledger_type: 'lab' }),
    ]));
    expect(allResponse.body.data.every((lot) => typeof lot.consumable_name === 'string' && typeof lot.consumable_code === 'string')).toBe(true);

    const filteredResponse = await getJson<{ data: Array<Record<string, unknown>> }>(
      app,
      `/lab-monitoring/stock/lots?consumable_id=${linkedConsumableId}`,
    );

    expect(filteredResponse.status).toBe(200);
    expect(filteredResponse.body.data).toHaveLength(1);
    expect(filteredResponse.body.data[0]).toMatchObject({
      id: 501,
      consumable_id: linkedConsumableId,
      ledger_type: 'inventory',
    });
  });

  it('falls back to legacy lots when a linked canonical inventory projection is unavailable', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const legacyLotId = insertStock(sqlite, consumableId, { quantity: 5, qcStatus: 'passed' });

    sqlite.exec('ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;');
    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = ? WHERE id = ?').run(7201, consumableId);

    const response = await getJson<{ data: Array<Record<string, unknown>> }>(app, '/lab-monitoring/stock/lots');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: legacyLotId,
        consumable_id: consumableId,
        ledger_type: 'lab',
        quantity_available: 5,
      }),
    ]);
  });

  it('reads the safe policy and blocks strict mode until billing-stock atomicity is available', async () => {
    const { sqlite, app } = createHarness();
    prepareStrictPolicyReadiness(sqlite);

    const defaultResponse = await app.request('/lab-monitoring/inventory-policy');
    expect(defaultResponse.status).toBe(200);
    await expect(defaultResponse.json()).resolves.toMatchObject({
      data: {
        lab_inventory_mode: 'soft',
        reagent_consumption_timing: 'billing',
        allow_result_without_stock: true,
        require_test_mapping_for_completion: false,
      },
    });

    const updateResponse = await app.request('/lab-monitoring/inventory-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lab_inventory_mode: 'strict',
        reagent_consumption_timing: 'result',
        allow_result_without_stock: true,
        require_test_mapping_for_completion: false,
      }),
    });
    expect(updateResponse.status).toBe(409);
    await expect(updateResponse.json()).resolves.toMatchObject({
      code: 'STRICT_LAB_INVENTORY_ATOMICITY_REQUIRED',
      capabilities: {
        strict_mode_available: false,
        strict_billing_atomicity_ready: false,
      },
    });

    const row = firstRow<{ count: number }>(
      sqlite,
      'SELECT COUNT(*) AS count FROM lab_inventory_policy WHERE tenant_id = ?',
      String(TENANT_ID),
    );
    expect(row.count).toBe(0);
  });

  it('restores the first-hospital safe lab inventory policy after strict-mode changes', async () => {
    const { sqlite, app } = createHarness();
    prepareStrictPolicyReadiness(sqlite);

    await app.request('/lab-monitoring/inventory-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lab_inventory_mode: 'strict',
        reagent_consumption_timing: 'result',
        allow_result_without_stock: true,
        require_test_mapping_for_completion: false,
      }),
    });

    const safePolicyResponse = await app.request('/lab-monitoring/inventory-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lab_inventory_mode: 'soft',
        reagent_consumption_timing: 'billing',
        allow_result_without_stock: true,
        require_test_mapping_for_completion: false,
      }),
    });

    expect(safePolicyResponse.status).toBe(200);
    await expect(safePolicyResponse.json()).resolves.toMatchObject({
      data: {
        lab_inventory_mode: 'soft',
        reagent_consumption_timing: 'billing',
        allow_result_without_stock: true,
        require_test_mapping_for_completion: false,
      },
    });

    const row = firstRow<{ lab_inventory_mode: string; reagent_consumption_timing: string; allow_result_without_stock: number; require_test_mapping_for_completion: number }>(
      sqlite,
      'SELECT lab_inventory_mode, reagent_consumption_timing, allow_result_without_stock, require_test_mapping_for_completion FROM lab_inventory_policy WHERE tenant_id = ?',
      String(TENANT_ID),
    );
    expect(row).toMatchObject({
      lab_inventory_mode: 'soft',
      reagent_consumption_timing: 'billing',
      allow_result_without_stock: 1,
      require_test_mapping_for_completion: 0,
    });
  });

  it('counts canonical usable reagent lots and avoids double-counting linked legacy mirrors in readiness', async () => {
    const { sqlite, d1 } = createHarness();
    const canonicalConsumableId = insertConsumable(sqlite, 'reagent');
    const legacyConsumableId = insertConsumable(sqlite, 'reagent');
    sqlite.exec(`
      ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
      ALTER TABLE lab_consumable_stock ADD COLUMN inventory_stock_id INTEGER;
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ItemId INTEGER NOT NULL,
        StoreId INTEGER,
        BatchNo TEXT,
        ExpiryDate TEXT,
        AvailableQuantity REAL DEFAULT 0,
        ReservedQuantity REAL DEFAULT 0,
        DamagedQuantity REAL DEFAULT 0,
        BlockedQuantity REAL DEFAULT 0,
        CostPrice REAL DEFAULT 0,
        IsActive INTEGER DEFAULT 1,
        QCStatus TEXT DEFAULT 'accepted',
        OpenDate TEXT,
        AfterOpenExpiryDate TEXT,
        StockStatus TEXT DEFAULT 'available'
      );
    `);
    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = 7701 WHERE id = ?').run(canonicalConsumableId);
    const canonicalStockId = Number(sqlite.prepare(`
      INSERT INTO InventoryStock
        (tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, QCStatus, StockStatus, IsActive, OpenDate, AfterOpenExpiryDate)
      VALUES (?, 7701, 1, 'CAN-READY-1', '2099-12-31', 5, 'passed', 'available', 1, '2026-07-01', '2026-07-20')
    `).run(String(TENANT_ID)).lastInsertRowid);
    sqlite.prepare(`
      INSERT INTO lab_consumable_stock
        (consumable_id, lot_number, expiry_date, quantity_received, purchase_price, received_date,
         qc_status, tenant_id, created_by, inventory_stock_id)
      VALUES (?, 'MIRROR-READY-1', '2099-12-31', 5, 75, '2026-07-01', 'passed', ?, ?, ?),
             (?, 'LEGACY-READY-1', '2099-12-31', 4, 75, '2026-07-01', 'passed', ?, ?, NULL)
    `).run(
      canonicalConsumableId, TENANT_ID, USER_ID, canonicalStockId,
      legacyConsumableId, TENANT_ID, USER_ID,
    );

    const canonicalRisk = firstRow<{ count: number }>(
      sqlite,
      `SELECT COUNT(*) AS count
       FROM InventoryStock inv
       JOIN lab_consumables c ON c.inventory_item_id = inv.ItemId AND c.tenant_id = inv.tenant_id
       WHERE inv.tenant_id = ?
         AND inv.AvailableQuantity > 0
         AND inv.AfterOpenExpiryDate IS NOT NULL
         AND date(inv.AfterOpenExpiryDate) <= date(?)`,
      String(TENANT_ID),
      '2026-08-09',
    );
    expect(canonicalRisk.count).toBe(1);
    const combinedRisk = firstRow<{ count: number }>(
      sqlite,
      `SELECT COALESCE(SUM(risk_count), 0) AS count
       FROM (
         SELECT COUNT(1) AS risk_count
         FROM lab_consumable_stock s
         JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
         WHERE s.tenant_id = ?
           AND s.inventory_stock_id IS NULL
           AND COALESCE(c.is_active, 1) = 1
           AND s.quantity_available > 0
           AND s.onboard_expires_at IS NOT NULL
           AND date(s.onboard_expires_at) <= date(?)
         UNION ALL
         SELECT COUNT(1) AS risk_count
         FROM InventoryStock inv
         JOIN lab_consumables c ON c.inventory_item_id = inv.ItemId AND c.tenant_id = inv.tenant_id
         WHERE inv.tenant_id = ?
           AND COALESCE(c.is_active, 1) = 1
           AND COALESCE(inv.IsActive, 1) = 1
           AND (COALESCE(inv.AvailableQuantity, 0)
                - COALESCE(inv.ReservedQuantity, 0)
                - COALESCE(inv.DamagedQuantity, 0)
                - COALESCE(inv.BlockedQuantity, 0)) > 0
           AND inv.AfterOpenExpiryDate IS NOT NULL
           AND date(inv.AfterOpenExpiryDate) <= date(?)
       )`,
      String(TENANT_ID),
      '2026-08-09',
      String(TENANT_ID),
      '2026-08-09',
    );
    expect(combinedRisk.count).toBe(1);

    const readiness = await getLabInventoryStrictModeReadiness(d1, TENANT_ID, new Date('2026-07-10T00:00:00.000Z'));

    expect(readiness.counts.stockedLots).toBe(2);
    expect(readiness.counts.onboardExpiryRiskLots).toBe(1);
    expect(readiness.counts.qcRiskLots).toBe(0);
  });

  it('lists and reviews lab inventory exceptions for admin follow-up', async () => {
    const { sqlite, app } = createHarness();
    const exceptionId = Number(sqlite.prepare(`
      INSERT INTO lab_inventory_exceptions
        (tenant_id, lab_order_id, lab_order_item_id, lab_test_id, source_event, severity, reason, message, status, created_by)
      VALUES (?, ?, ?, ?, 'billing_finalization', 'error', 'insufficient_stock', 'CBC reagent missing', 'open', ?)
    `).run(String(TENANT_ID), LAB_ORDER_ID, 501, LAB_TEST_ID, USER_ID).lastInsertRowid);

    const listResponse = await app.request('/lab-monitoring/inventory-exceptions');
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: exceptionId, status: 'open', reason: 'insufficient_stock' })],
    });

    const reviewResponse = await app.request('/lab-monitoring/inventory-exceptions/' + exceptionId + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', remarks: 'Stock received and mapping checked' }),
    });
    expect(reviewResponse.status).toBe(200);

    const row = firstRow<{ status: string; resolved_by: number; resolution_remarks: string }>(
      sqlite,
      'SELECT status, resolved_by, resolution_remarks FROM lab_inventory_exceptions WHERE id = ?',
      exceptionId,
    );
    expect(row).toMatchObject({ status: 'resolved', resolved_by: String(USER_ID), resolution_remarks: 'Stock received and mapping checked' });
  });

  it('deduplicates repeated open inventory exceptions and starts a new occurrence after resolution', async () => {
    const { sqlite, d1 } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const input = {
      tenantId: TENANT_ID,
      userId: USER_ID,
      labOrderId: LAB_ORDER_ID,
      labOrderItemId: 502,
      labTestId: LAB_TEST_ID,
      consumableId,
      sourceEvent: 'billing_finalization',
      reason: 'insufficient_stock',
      message: 'CBC reagent missing',
      metadata: { required: 2 },
    };

    await recordLabInventoryException(d1, input);
    await recordLabInventoryException(d1, { ...input, message: 'CBC reagent still missing' });

    const openRows = sqlite.prepare(`
      SELECT id, message, occurrence_count
      FROM lab_inventory_exceptions
      WHERE tenant_id = ? AND status = 'open'
    `).all(String(TENANT_ID)) as Array<{ id: number; message: string; occurrence_count: number }>;
    expect(openRows).toHaveLength(1);
    expect(openRows[0]).toMatchObject({ message: 'CBC reagent still missing', occurrence_count: 2 });

    sqlite.prepare(`
      UPDATE lab_inventory_exceptions
      SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(openRows[0].id);
    await recordLabInventoryException(d1, input);

    const counts = firstRow<{ total: number; open_count: number }>(
      sqlite,
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count
       FROM lab_inventory_exceptions
       WHERE tenant_id = ? AND lab_order_item_id = ?`,
      String(TENANT_ID),
      input.labOrderItemId,
    );
    expect(counts).toMatchObject({ total: 2, open_count: 1 });
  });

  it('updates test-to-consumable mapping quantities inline without delete/recreate', async () => {
    const { sqlite, app } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const mappingId = Number(sqlite.prepare(`
      INSERT INTO lab_test_consumable_map (lab_test_id, consumable_id, qty_per_test, is_mandatory, notes, tenant_id)
      VALUES (?, ?, 1, 1, 'starter default', ?)
    `).run(LAB_TEST_ID, consumableId, TENANT_ID).lastInsertRowid);

    const response = await app.request('/lab-monitoring/test-consumable-map/' + mappingId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty_per_test: 1.75, is_mandatory: false, notes: null }),
    });
    expect(response.status).toBe(200);

    const row = firstRow<{ qty_per_test: number; is_mandatory: number; notes: string | null }>(
      sqlite,
      'SELECT qty_per_test, is_mandatory, notes FROM lab_test_consumable_map WHERE id = ?',
      mappingId,
    );
    expect(row.qty_per_test).toBe(1.75);
    expect(row.is_mandatory).toBe(0);
    expect(row.notes).toBeNull();

    const listResponse = await app.request('/lab-monitoring/test-consumable-map');
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as { data: Array<Record<string, unknown>> };
    expect(listBody.data.find((item) => item.id === mappingId)).toMatchObject({
      qty_per_test: 1.75,
      is_mandatory: 0,
    });
  });

  it('rejects test-to-consumable mapping imports with unknown tenant test or consumable ids', async () => {
    const { sqlite, app } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');

    const unknownTest = await postJson<{ error: string }>(app, '/lab-monitoring/test-consumable-map/bulk', {
      mappings: [{ lab_test_id: 999999, consumable_id: consumableId, qty_per_test: 1, is_mandatory: true, notes: 'Unknown test' }],
    });
    expect(unknownTest.status).toBe(400);
    expect(unknownTest.body.error).toMatch(/Unknown or inactive lab test id 999999/);

    const unknownConsumable = await postJson<{ error: string }>(app, '/lab-monitoring/test-consumable-map', {
      lab_test_id: LAB_TEST_ID,
      consumable_id: 999999,
      qty_per_test: 1,
      is_mandatory: true,
      notes: 'Unknown consumable',
    });
    expect(unknownConsumable.status).toBe(400);
    expect(unknownConsumable.body.error).toMatch(/Unknown or inactive reagent\/consumable id 999999/);
  });

  it('prevalidates bulk mapping imports before writing any rows', async () => {
    const { sqlite, app } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');

    const response = await postJson<{ error: string }>(app, '/lab-monitoring/test-consumable-map/bulk', {
      mappings: [
        { lab_test_id: LAB_TEST_ID, consumable_id: consumableId, qty_per_test: 1, is_mandatory: true, notes: 'Valid first row' },
        { lab_test_id: 999999, consumable_id: consumableId, qty_per_test: 1, is_mandatory: true, notes: 'Invalid second row' },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Unknown or inactive lab test id 999999/);
    const count = sqlite.prepare(`
      SELECT COUNT(1) as count
      FROM lab_test_consumable_map
      WHERE tenant_id = ? AND lab_test_id = ? AND consumable_id = ?
    `).get(TENANT_ID, LAB_TEST_ID, consumableId) as { count: number };
    expect(count.count).toBe(0);
  });

  it('rejects inactive lab tests when creating test-to-consumable mappings', async () => {
    const { sqlite, app } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const inactiveTestId = LAB_TEST_ID + 99;
    sqlite.prepare(`
      INSERT INTO lab_test_catalog (id, code, name, is_active, tenant_id)
      VALUES (?, 'INACTIVE-CBC', 'Inactive CBC', 0, ?)
    `).run(inactiveTestId, TENANT_ID);

    const response = await postJson<{ error: string }>(app, '/lab-monitoring/test-consumable-map', {
      lab_test_id: inactiveTestId,
      consumable_id: consumableId,
      qty_per_test: 1,
      is_mandatory: true,
      notes: 'Inactive test should be rejected',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(new RegExp(`Unknown or inactive lab test id ${inactiveTestId}`));
  });

  it('deducts mapped reagents at no-LIS billing time, keeps result finalization idempotent, and reverses on cancellation', async () => {
    const { sqlite, d1 } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });
    const labOrderItemId = 83001;

    sqlite.prepare(`
      INSERT INTO lab_test_consumable_map (lab_test_id, consumable_id, qty_per_test, is_mandatory, tenant_id)
      VALUES (?, ?, 2, 1, ?)
    `).run(LAB_TEST_ID, consumableId, TENANT_ID);

    const billedUsage = await consumeMappedLabConsumables(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      labOrderItemId,
      labOrderId: LAB_ORDER_ID,
      labTestId: LAB_TEST_ID,
    });
    expect(billedUsage).toMatchObject({ mappings: 1, quantity: 2, cost: 150 });

    const afterBilling = firstRow<{ quantity_used: number; quantity_available: number }>(
      sqlite,
      'SELECT quantity_used, quantity_available FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(afterBilling).toMatchObject({ quantity_used: 2, quantity_available: 8 });

    const resultFinalizeRetry = await consumeMappedLabConsumables(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      labOrderItemId,
      labOrderId: LAB_ORDER_ID,
      labTestId: LAB_TEST_ID,
    });
    expect(resultFinalizeRetry).toMatchObject({ mappings: 0, quantity: 0, cost: 0 });

    const afterResultRetry = firstRow<{ quantity_used: number; quantity_available: number }>(
      sqlite,
      'SELECT quantity_used, quantity_available FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(afterResultRetry).toMatchObject({ quantity_used: 2, quantity_available: 8 });

    const reversal = await reverseMappedLabConsumablesForOrderItem(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      labOrderItemId,
      reason: 'cancelled before sample processing',
    });
    expect(reversal).toMatchObject({ reversed: 1, quantity: 2, cost: 150 });

    const afterCancel = firstRow<{ quantity_used: number; quantity_available: number }>(
      sqlite,
      'SELECT quantity_used, quantity_available FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(afterCancel).toMatchObject({ quantity_used: 0, quantity_available: 10 });

    const secondReversal = await reverseMappedLabConsumablesForOrderItem(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      labOrderItemId,
      reason: 'duplicate cancellation retry',
    });
    expect(secondReversal).toMatchObject({ reversed: 0, quantity: 0, cost: 0 });

    const movementCounts = firstRow<{ usage_count: number; reversal_count: number }>(
      sqlite,
      `SELECT
         SUM(CASE WHEN reference_type = 'lab_order_item' THEN 1 ELSE 0 END) as usage_count,
         SUM(CASE WHEN reference_type = 'lab_order_item_reversal' THEN 1 ELSE 0 END) as reversal_count
       FROM lab_consumable_movements
       WHERE reference_id = ?`,
      labOrderItemId,
    );
    expect(movementCounts).toMatchObject({ usage_count: 1, reversal_count: 1 });
  });

  it('retries a partially recorded reversal without double-returning completed source movements', async () => {
    const { sqlite, d1 } = createHarness();
    const firstConsumableId = insertConsumable(sqlite, 'reagent');
    const secondConsumableId = insertConsumable(sqlite, 'reagent');
    const firstStockId = insertStock(sqlite, firstConsumableId, { quantity: 10, qcStatus: 'passed' });
    const secondStockId = insertStock(sqlite, secondConsumableId, { quantity: 10, qcStatus: 'passed' });
    const labOrderItemId = 83002;

    sqlite.prepare('UPDATE lab_consumable_stock SET quantity_used = 1 WHERE id IN (?, ?)').run(firstStockId, secondStockId);
    const firstUsageResult = sqlite.prepare(`
      INSERT INTO lab_consumable_movements
        (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, reference_id,
         performed_by, remarks, tenant_id, ledger_type, lab_stock_id)
      VALUES (?, ?, 'usage_out', 1, 75, 'lab_order_item', ?, ?, 'first source usage', ?, 'lab', ?)
    `).run(firstConsumableId, firstStockId, labOrderItemId, USER_ID, TENANT_ID, firstStockId);
    sqlite.prepare(`
      INSERT INTO lab_consumable_movements
        (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, reference_id,
         performed_by, remarks, tenant_id, ledger_type, lab_stock_id)
      VALUES (?, ?, 'usage_out', 1, 75, 'lab_order_item', ?, ?, 'second source usage', ?, 'lab', ?)
    `).run(secondConsumableId, secondStockId, labOrderItemId, USER_ID, TENANT_ID, secondStockId);
    const firstUsage = { id: Number(firstUsageResult.lastInsertRowid) };
    sqlite.prepare('UPDATE lab_consumable_stock SET quantity_used = quantity_used - 1 WHERE id = ?').run(firstStockId);
    sqlite.prepare(`
      INSERT INTO lab_consumable_movements
        (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, reference_id,
         performed_by, remarks, tenant_id, ledger_type, lab_stock_id, reverses_movement_id)
      VALUES (?, ?, 'return', 1, 75, 'lab_order_item_reversal', ?, ?, 'partial previous reversal', ?, 'lab', ?, ?)
    `).run(
      firstConsumableId,
      firstStockId,
      labOrderItemId,
      USER_ID,
      TENANT_ID,
      firstStockId,
      firstUsage.id,
    );

    const reversal = await reverseMappedLabConsumablesForOrderItem(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      labOrderItemId,
      reason: 'retry after interrupted reversal',
    });

    expect(reversal).toMatchObject({ reversed: 1, quantity: 1, cost: 75 });
    expect(firstRow<{ quantity_used: number }>(sqlite, 'SELECT quantity_used FROM lab_consumable_stock WHERE id = ?', firstStockId).quantity_used).toBe(0);
    expect(firstRow<{ quantity_used: number }>(sqlite, 'SELECT quantity_used FROM lab_consumable_stock WHERE id = ?', secondStockId).quantity_used).toBe(0);
    const counts = firstRow<{ count: number }>(
      sqlite,
      `SELECT COUNT(*) AS count FROM lab_consumable_movements
       WHERE tenant_id = ? AND reference_type = 'lab_order_item_reversal' AND reference_id = ?`,
      TENANT_ID,
      labOrderItemId,
    );
    expect(counts.count).toBe(2);
  });

  it('rolls back every reagent return when any source movement cannot be reversed', async () => {
    const { sqlite, d1 } = createHarness();
    const firstConsumableId = insertConsumable(sqlite, 'reagent');
    const secondConsumableId = insertConsumable(sqlite, 'reagent');
    const firstStockId = insertStock(sqlite, firstConsumableId, { quantity: 10, qcStatus: 'passed' });
    const secondStockId = insertStock(sqlite, secondConsumableId, { quantity: 10, qcStatus: 'passed' });
    const labOrderItemId = 83003;

    sqlite.prepare('UPDATE lab_consumable_stock SET quantity_used = 1 WHERE id IN (?, ?)').run(firstStockId, secondStockId);
    sqlite.prepare(`
      INSERT INTO lab_consumable_movements
        (consumable_id, stock_id, movement_type, quantity, unit_cost, reference_type, reference_id,
         performed_by, remarks, tenant_id, ledger_type, lab_stock_id)
      VALUES (?, ?, 'usage_out', 1, 75, 'lab_order_item', ?, ?, 'first source usage', ?, 'lab', ?),
             (?, ?, 'usage_out', 1, 75, 'lab_order_item', ?, ?, 'second source usage', ?, 'lab', ?)
    `).run(
      firstConsumableId, firstStockId, labOrderItemId, USER_ID, TENANT_ID, firstStockId,
      secondConsumableId, secondStockId, labOrderItemId, USER_ID, TENANT_ID, secondStockId,
    );
    sqlite.exec(`
      CREATE TRIGGER abort_second_reagent_return
      BEFORE INSERT ON lab_consumable_movements
      WHEN NEW.movement_type = 'return' AND NEW.consumable_id = ${secondConsumableId}
      BEGIN
        SELECT RAISE(ABORT, 'SECOND_RETURN_BLOCKED');
      END;
    `);

    await expect(reverseMappedLabConsumablesForOrderItem(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      labOrderItemId,
      reason: 'atomic rollback test',
    })).rejects.toThrow('Reagent reversal could not be completed atomically');

    expect(firstRow<{ quantity_used: number }>(sqlite, 'SELECT quantity_used FROM lab_consumable_stock WHERE id = ?', firstStockId).quantity_used).toBe(1);
    expect(firstRow<{ quantity_used: number }>(sqlite, 'SELECT quantity_used FROM lab_consumable_stock WHERE id = ?', secondStockId).quantity_used).toBe(1);
    const returns = firstRow<{ count: number }>(
      sqlite,
      `SELECT COUNT(*) AS count FROM lab_consumable_movements
       WHERE tenant_id = ? AND reference_type = 'lab_order_item_reversal' AND reference_id = ?`,
      TENANT_ID,
      labOrderItemId,
    );
    expect(returns.count).toBe(0);
  });

  it('records manual control consumable usage through the lab monitoring API with canonical references and audit trail', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });

    const response = await postJson<{
      usage_type: string;
      reference_type: string;
      quantity_used: number;
      movements: number;
      cost: number;
    }>(app, `/lab-monitoring/consumables/${consumableId}/manual-usage`, {
      quantity: 2,
      usage_type: 'control',
      reference_type: 'tampered_reference',
      reference_id: 9001,
      remarks: 'Daily control run',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ usage_type: 'control', reference_type: 'manual_control', quantity_used: 2, movements: 1, cost: 150 });

    const stock = firstRow<{ quantity_used: number; quantity_available: number }>(
      sqlite,
      'SELECT quantity_used, quantity_available FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(stock).toMatchObject({ quantity_used: 2, quantity_available: 8 });

    const movement = firstRow<{
      id: number;
      movement_type: string;
      reference_type: string;
      reference_id: number;
      quantity: number;
      remarks: string;
      ledger_type: string;
      lab_stock_id: number;
      inventory_stock_id: number | null;
    }>(
      sqlite,
      'SELECT id, movement_type, reference_type, reference_id, quantity, remarks, ledger_type, lab_stock_id, inventory_stock_id FROM lab_consumable_movements WHERE stock_id = ? ORDER BY id DESC LIMIT 1',
      stockId,
    );
    expect(movement).toMatchObject({
      movement_type: 'usage_out',
      reference_type: 'manual_control',
      reference_id: 9001,
      quantity: 2,
      remarks: 'Daily control run',
      ledger_type: 'lab',
      lab_stock_id: stockId,
      inventory_stock_id: null,
    });

    const log = firstRow<{ log_type: string; consumable_id: number; quantity: number; description: string }>(
      sqlite,
      'SELECT log_type, consumable_id, quantity, description FROM lab_operation_logs WHERE consumable_id = ? ORDER BY id DESC LIMIT 1',
      consumableId,
    );
    expect(log).toMatchObject({ log_type: 'reagent_used', consumable_id: consumableId, quantity: 2 });
    expect(log.description).toContain('control');
    expect(log.description).toContain('Daily control run');

    const audit = firstRow<{ action: string; table_name: string; record_id: number; new_value: string }>(
      sqlite,
      'SELECT action, table_name, record_id, new_value FROM audit_logs WHERE table_name = ? ORDER BY id DESC LIMIT 1',
      'lab_consumable_movements',
    );
    expect(audit).toMatchObject({ action: 'CREATE', table_name: 'lab_consumable_movements', record_id: movement.id });
    expect(JSON.parse(audit.new_value)).toMatchObject({
      usage_type: 'control',
      reference_type: 'manual_control',
      quantity_used: 2,
      movement_ids: [movement.id],
    });
  });

  it('records every supported manual usage type with server-owned canonical reference types', async () => {
    const supportedUsageTypes = ['rerun', 'control', 'qc', 'calibration', 'manual', 'other'] as const;

    for (const usageType of supportedUsageTypes) {
      const { app, sqlite } = createHarness();
      const consumableId = insertConsumable(sqlite, 'reagent');
      const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });

      const response = await postJson<{
        usage_type: string;
        reference_type: string;
        quantity_used: number;
        movements: number;
      }>(app, `/lab-monitoring/consumables/${consumableId}/manual-usage`, {
        quantity: 1,
        usage_type: usageType,
        reference_type: 'client_supplied_should_not_win',
        remarks: `${usageType} reagent usage SOP record`,
      });

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({
        usage_type: usageType,
        reference_type: `manual_${usageType}`,
        quantity_used: 1,
        movements: 1,
      });

      const movement = firstRow<{ reference_type: string; quantity: number; remarks: string }>(
        sqlite,
        'SELECT reference_type, quantity, remarks FROM lab_consumable_movements WHERE stock_id = ? ORDER BY id DESC LIMIT 1',
        stockId,
      );
      expect(movement).toMatchObject({
        reference_type: `manual_${usageType}`,
        quantity: 1,
        remarks: `${usageType} reagent usage SOP record`,
      });
    }
  });

  it('rejects unsupported manual reagent usage types before stock deduction', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });

    const response = await postJson(app, `/lab-monitoring/consumables/${consumableId}/manual-usage`, {
      quantity: 2,
      usage_type: 'maintenance_bypass',
      remarks: 'Invalid use case should not be accepted',
    });

    expect(response.status).toBe(400);
    const stock = firstRow<{ quantity_used: number; quantity_available: number }>(
      sqlite,
      'SELECT quantity_used, quantity_available FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(stock).toMatchObject({ quantity_used: 0, quantity_available: 10 });
  });

  it('rejects manual reagent usage without meaningful audit remarks', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });

    const response = await postJson(app, `/lab-monitoring/consumables/${consumableId}/manual-usage`, {
      quantity: 2,
      usage_type: 'control',
      remarks: ' ',
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('Remarks are required');
  });

  it('QC pass makes a reagent lot usable', async () => {
    const { app, sqlite, d1 } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'pending' });

    const qcResponse = await postJson(app, `/lab-monitoring/stock/${stockId}/qc`, {
      qc_status: 'passed',
      remarks: 'control ok',
    });
    expect(qcResponse.status).toBe(200);

    const result = await consumeLabConsumableStock(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      consumableId,
      quantity: 2,
      referenceType: 'manual',
      referenceId: 123,
      remarks: 'manual test usage',
    });

    expect(result.quantity_used).toBe(2);
    const stock = firstRow<{ quantity_used: number; quantity_available: number }>(
      sqlite,
      'SELECT quantity_used, quantity_available FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(stock).toMatchObject({ quantity_used: 2, quantity_available: 8 });
  });

  it('QC fail keeps a reagent lot unusable', async () => {
    const { app, sqlite, d1 } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'pending' });

    const qcResponse = await postJson(app, `/lab-monitoring/stock/${stockId}/qc`, {
      qc_status: 'failed',
      remarks: 'control failed',
    });
    expect(qcResponse.status).toBe(200);

    await expectHttpStatus(consumeLabConsumableStock(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      consumableId,
      quantity: 1,
      referenceType: 'manual',
    }), 400);

    const stock = firstRow<{ quantity_used: number; quantity_available: number; qc_status: string }>(
      sqlite,
      'SELECT quantity_used, quantity_available, qc_status FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(stock).toMatchObject({ quantity_used: 0, quantity_available: 10, qc_status: 'failed' });
  });

  it('open-vial onboard expiry blocks usage after expiry', async () => {
    const { app, sqlite, d1 } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });

    const openResponse = await postJson(app, `/lab-monitoring/stock/${stockId}/open`, {
      onboard_expiry_days: 1,
      remarks: 'opened on analyzer',
    });
    expect(openResponse.status, JSON.stringify(openResponse.body)).toBe(200);

    sqlite.prepare('UPDATE lab_consumable_stock SET onboard_expires_at = date(\'now\', \'-1 day\') WHERE id = ?')
      .run(stockId);

    await expectHttpStatus(consumeLabConsumableStock(d1, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      consumableId,
      quantity: 1,
      referenceType: 'manual',
    }), 400);
  });

  it('returns open-vial dates and writes a stock-opened log for legacy lab stock lots', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });

    const openResponse = await postJson<{
      onboard_expiry_days: number;
      opened_at: string;
      onboard_expires_at: string;
      ledger_type: string;
    }>(app, `/lab-monitoring/stock/${stockId}/open`, {
      onboard_expiry_days: 30,
      remarks: 'Opened for hematology analyzer',
    });

    expect(openResponse.status, JSON.stringify(openResponse.body)).toBe(200);
    expect(openResponse.body).toMatchObject({
      onboard_expiry_days: 30,
      ledger_type: 'lab',
    });
    expect(openResponse.body.opened_at).toBeTruthy();
    expect(openResponse.body.onboard_expires_at).toBeTruthy();

    const stock = firstRow<{
      opened_by: number;
      onboard_expiry_days: number;
      onboard_expires_at: string;
      opened_remarks: string;
    }>(
      sqlite,
      'SELECT opened_by, onboard_expiry_days, onboard_expires_at, opened_remarks FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(stock).toMatchObject({
      opened_by: USER_ID,
      onboard_expiry_days: 30,
      onboard_expires_at: openResponse.body.onboard_expires_at,
      opened_remarks: 'Opened for hematology analyzer',
    });

    const operationLog = firstRow<{ log_type: string; description: string }>(
      sqlite,
      'SELECT log_type, description FROM lab_operation_logs WHERE consumable_id = ? ORDER BY id DESC LIMIT 1',
      consumableId,
    );
    expect(operationLog.log_type).toBe('stock_opened');
    expect(operationLog.description).toContain(`Stock lot ${stockId} opened for 30 days`);
  });

  it('requires explicit ledger type when legacy lab and canonical inventory stock ids overlap', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const legacyStockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });

    sqlite.exec(`
      ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ItemId INTEGER,
        StoreId INTEGER,
        BatchNo TEXT,
        ExpiryDate TEXT,
        AvailableQuantity REAL DEFAULT 0,
        CostPrice REAL DEFAULT 0,
        IsActive INTEGER DEFAULT 1,
        QCStatus TEXT DEFAULT 'passed',
        OpenDate TEXT,
        AfterOpenExpiryDate TEXT,
        StockStatus TEXT DEFAULT 'available',
        ModifiedBy TEXT,
        ModifiedOn TEXT
      );
      CREATE TABLE InventoryAuditLog (
        AuditId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT,
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
    `);
    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = ? WHERE id = ?').run(7701, consumableId);
    sqlite.prepare(`
      INSERT INTO InventoryStock (StockId, tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, CostPrice, QCStatus, StockStatus, IsActive)
      VALUES (?, ?, 7701, 1, 'CAN-OVERLAP-1', '2099-12-31', 8, 75, 'passed', 'available', 1)
    `).run(legacyStockId, String(TENANT_ID));

    const ambiguousResponse = await postJson<{ error: string }>(app, `/lab-monitoring/stock/${legacyStockId}/open`, {
      onboard_expiry_days: 30,
      remarks: 'manual id should be explicit',
    });
    expect(ambiguousResponse.status).toBe(409);
    expect(ambiguousResponse.body.error).toContain('ledger_type');

    expect(firstRow<{ opened_at: string | null }>(
      sqlite,
      'SELECT opened_at FROM lab_consumable_stock WHERE id = ?',
      legacyStockId,
    ).opened_at).toBeNull();
    expect(firstRow<{ OpenDate: string | null }>(
      sqlite,
      'SELECT OpenDate FROM InventoryStock WHERE StockId = ?',
      legacyStockId,
    ).OpenDate).toBeNull();

    const inventoryResponse = await postJson<{ ledger_type: string; onboard_expires_at: string }>(app, `/lab-monitoring/stock/${legacyStockId}/open`, {
      onboard_expiry_days: 30,
      remarks: 'explicit inventory stock open',
      ledger_type: 'inventory',
    });
    expect(inventoryResponse.status, JSON.stringify(inventoryResponse.body)).toBe(200);
    expect(inventoryResponse.body).toMatchObject({ ledger_type: 'inventory' });
    expect(inventoryResponse.body.onboard_expires_at).toBeTruthy();
    expect(firstRow<{ opened_at: string | null }>(
      sqlite,
      'SELECT opened_at FROM lab_consumable_stock WHERE id = ?',
      legacyStockId,
    ).opened_at).toBeNull();
    expect(firstRow<{ OpenDate: string | null }>(
      sqlite,
      'SELECT OpenDate FROM InventoryStock WHERE StockId = ?',
      legacyStockId,
    ).OpenDate).toBeTruthy();
  });

  it('rejects invalid open-vial payloads before changing stock metadata', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });

    const zeroDays = await postJson(app, `/lab-monitoring/stock/${stockId}/open`, {
      onboard_expiry_days: 0,
      remarks: 'invalid zero days',
    });
    expect(zeroDays.status).toBe(400);

    const tooManyDays = await postJson(app, `/lab-monitoring/stock/${stockId}/open`, {
      onboard_expiry_days: 366,
      remarks: 'invalid too many days',
    });
    expect(tooManyDays.status).toBe(400);

    const tooLongRemarks = await postJson(app, `/lab-monitoring/stock/${stockId}/open`, {
      onboard_expiry_days: 30,
      remarks: 'x'.repeat(501),
    });
    expect(tooLongRemarks.status).toBe(400);

    const stock = firstRow<{
      opened_at: string | null;
      onboard_expiry_days: number | null;
      onboard_expires_at: string | null;
      opened_remarks: string | null;
    }>(
      sqlite,
      'SELECT opened_at, onboard_expiry_days, onboard_expires_at, opened_remarks FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(stock).toMatchObject({
      opened_at: null,
      onboard_expiry_days: null,
      onboard_expires_at: null,
      opened_remarks: null,
    });
  });

  it('waste approval increases quantity_wasted and writes waste movement', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });

    const seededStock = firstRow<{ id: number; tenant_id: number; quantity_available: number }>(
      sqlite,
      'SELECT id, tenant_id, quantity_available FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(seededStock).toMatchObject({ id: stockId, tenant_id: TENANT_ID, quantity_available: 10 });
    const requestResponse = await postJson<{ id: number; status: string }>(app, '/lab-monitoring/stock/waste-requests', {
      stock_id: stockId,
      quantity: 3,
      reason: 'spillage',
      remarks: 'bench spill',
    });
    expect(requestResponse.status, JSON.stringify(requestResponse.body)).toBe(201);
    expect(requestResponse.body.status).toBe('pending');

    const approveResponse = await postJson(app, `/lab-monitoring/stock/waste-requests/${requestResponse.body.id}/approve`, {
      review_remarks: 'approved by supervisor',
    });
    expect(approveResponse.status).toBe(200);

    const stock = firstRow<{ quantity_wasted: number; quantity_available: number }>(
      sqlite,
      'SELECT quantity_wasted, quantity_available FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(stock).toMatchObject({ quantity_wasted: 3, quantity_available: 7 });

    const wasteMovement = firstRow<{ movement_type: string; quantity: number }>(
      sqlite,
      "SELECT movement_type, quantity FROM lab_consumable_movements WHERE reference_type = 'waste_request' AND reference_id = ?",
      requestResponse.body.id,
    );
    expect(wasteMovement).toMatchObject({ movement_type: 'waste', quantity: 3 });
  });

  it('rejects invalid waste request payloads and invalid status filters', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 5, qcStatus: 'failed' });

    const invalidReason = await postJson(app, '/lab-monitoring/stock/waste-requests', {
      stock_id: stockId,
      quantity: 1,
      reason: 'damaged',
    });
    expect(invalidReason.status).toBe(400);

    const otherWithoutRemarks = await postJson(app, '/lab-monitoring/stock/waste-requests', {
      stock_id: stockId,
      quantity: 1,
      reason: 'other',
    });
    expect(otherWithoutRemarks.status).toBe(400);

    const tooLongRemarks = await postJson(app, '/lab-monitoring/stock/waste-requests', {
      stock_id: stockId,
      quantity: 1,
      reason: 'expired',
      remarks: 'x'.repeat(501),
    });
    expect(tooLongRemarks.status).toBe(400);

    const exceedsStock = await postJson(app, '/lab-monitoring/stock/waste-requests', {
      stock_id: stockId,
      quantity: 6,
      reason: 'qc_failed',
      remarks: 'QC failed lot quarantine',
    });
    expect(exceedsStock.status).toBe(400);

    const invalidFilter = await getJson(app, '/lab-monitoring/stock/waste-requests?status=unsafe');
    expect(invalidFilter.status).toBe(400);

    const wasteRequestCount = firstRow<{ count: number }>(
      sqlite,
      'SELECT COUNT(*) as count FROM lab_consumable_waste_requests WHERE stock_id = ?',
      stockId,
    );
    expect(wasteRequestCount.count).toBe(0);
  });

  it('waste rejection closes pending request without changing stock quantity', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'failed' });

    const requestResponse = await postJson<{ id: number; status: string }>(app, '/lab-monitoring/stock/waste-requests', {
      stock_id: stockId,
      quantity: 2,
      reason: 'qc_failed',
      remarks: 'QC failed lot quarantine',
    });
    expect(requestResponse.status, JSON.stringify(requestResponse.body)).toBe(201);

    const rejectResponse = await postJson(app, `/lab-monitoring/stock/waste-requests/${requestResponse.body.id}/reject`, {
      review_remarks: 'Physical lot rechecked and retained',
    });
    expect(rejectResponse.status).toBe(200);

    const stock = firstRow<{ quantity_wasted: number; quantity_available: number }>(
      sqlite,
      'SELECT quantity_wasted, quantity_available FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(stock).toMatchObject({ quantity_wasted: 0, quantity_available: 10 });

    const request = firstRow<{ status: string; review_remarks: string }>(
      sqlite,
      'SELECT status, review_remarks FROM lab_consumable_waste_requests WHERE id = ?',
      requestResponse.body.id,
    );
    expect(request).toMatchObject({ status: 'rejected', review_remarks: 'Physical lot rechecked and retained' });
  });

  it('whole-lot transfer changes location and writes transfer movements', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const sourceLocationId = insertLocation(sqlite, 'SRC');
    const targetLocationId = insertLocation(sqlite, 'DST');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed', locationId: sourceLocationId });

    const targetLocation = firstRow<{ id: number; tenant_id: number; is_active: number }>(
      sqlite,
      'SELECT id, tenant_id, is_active FROM lab_consumable_locations WHERE id = ?',
      targetLocationId,
    );
    expect(targetLocation).toMatchObject({ id: targetLocationId, tenant_id: TENANT_ID, is_active: 1 });
    const transferResponse = await postJson(app, `/lab-monitoring/stock/${stockId}/transfer-location`, {
      target_location_id: targetLocationId,
      remarks: 'move to analyzer',
    });
    expect(transferResponse.status, JSON.stringify(transferResponse.body)).toBe(200);

    const stock = firstRow<{ location_id: number }>(
      sqlite,
      'SELECT location_id FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(stock.location_id).toBe(targetLocationId);

    const movementCount = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM lab_consumable_movements WHERE stock_id = ? AND movement_type IN ('transfer_out','transfer_in')",
      stockId,
    );
    expect(movementCount.count).toBe(2);
  });

  it('detail projection uses canonical InventoryStock lots for linked reagents without LIS integration', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');

    sqlite.exec(`
      ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
      CREATE TABLE InventoryStore (
        StoreId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        StoreName TEXT NOT NULL,
        StoreCode TEXT,
        StoreType TEXT DEFAULT 'main',
        IsActive INTEGER DEFAULT 1
      );
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ItemId INTEGER,
        StoreId INTEGER,
        BatchNo TEXT,
        ExpiryDate TEXT,
        AvailableQuantity INTEGER DEFAULT 0,
        CostPrice REAL DEFAULT 0,
        IsActive INTEGER DEFAULT 1
      );
    `);

    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = ? WHERE id = ?').run(7001, consumableId);
    sqlite.prepare(`
      INSERT INTO InventoryStore (StoreId, tenant_id, StoreName, StoreCode, StoreType)
      VALUES (1, ?, 'Lab Main Store', 'LAB-MAIN', 'lab')
    `).run(String(TENANT_ID));
    sqlite.prepare(`
      INSERT INTO InventoryStock (tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, CostPrice, IsActive)
      VALUES (?, 7001, 1, 'INV-LOT-1', '2099-12-31', 12, 81, 1)
    `).run(String(TENANT_ID));
    insertStock(sqlite, consumableId, { quantity: 4, qcStatus: 'passed' });

    const response = await app.request(`/lab-monitoring/consumables/${consumableId}`);
    expect(response.status).toBe(200);
    const body = await response.json() as { consumable: { total_stock: number }; stock: Array<Record<string, unknown>> };

    expect(Number(body.consumable.total_stock)).toBe(12);
    expect(body.stock).toHaveLength(1);
    expect(body.stock[0]).toMatchObject({
      lot_number: 'INV-LOT-1',
      quantity_available: 12,
      ledger_type: 'inventory',
      location_code: 'LAB-MAIN',
    });
  });

  it('updates canonical InventoryStock QC and open-vial metadata for linked reagent lots', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');

    sqlite.exec(`
      ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ItemId INTEGER,
        StoreId INTEGER,
        BatchNo TEXT,
        ExpiryDate TEXT,
        AvailableQuantity REAL DEFAULT 0,
        CostPrice REAL DEFAULT 0,
        IsActive INTEGER DEFAULT 1,
        QCStatus TEXT DEFAULT 'pending',
        OpenDate TEXT,
        AfterOpenExpiryDate TEXT,
        StockStatus TEXT DEFAULT 'blocked',
        ModifiedBy TEXT,
        ModifiedOn TEXT
      );
      CREATE TABLE InventoryAuditLog (
        AuditId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT,
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
    `);

    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = ? WHERE id = ?').run(7002, consumableId);
    sqlite.prepare(`
      INSERT INTO InventoryStock (StockId, tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, CostPrice, QCStatus, StockStatus, IsActive)
      VALUES (44, ?, 7002, 1, 'CAN-QC-OPEN-1', '2099-12-31', 8, 75, 'pending', 'blocked', 1)
    `).run(String(TENANT_ID));

    const qcResponse = await postJson<{ qc_status: string; stock_status: string; ledger_type: string }>(
      app,
      '/lab-monitoring/stock/44/qc',
      { qc_status: 'passed', remarks: 'QC pass from lab monitoring' },
    );
    expect(qcResponse.status, JSON.stringify(qcResponse.body)).toBe(200);
    expect(qcResponse.body).toMatchObject({ qc_status: 'passed', stock_status: 'available', ledger_type: 'inventory' });

    const afterQc = firstRow<{ QCStatus: string; StockStatus: string; ModifiedBy: string }>(
      sqlite,
      'SELECT QCStatus, StockStatus, ModifiedBy FROM InventoryStock WHERE StockId = 44',
    );
    expect(afterQc).toMatchObject({ QCStatus: 'passed', StockStatus: 'available', ModifiedBy: String(USER_ID) });

    const openResponse = await postJson<{ onboard_expiry_days: number; onboard_expires_at: string; ledger_type: string }>(
      app,
      '/lab-monitoring/stock/44/open',
      { onboard_expiry_days: 7, remarks: 'opened on analyzer bench' },
    );
    expect(openResponse.status, JSON.stringify(openResponse.body)).toBe(200);
    expect(openResponse.body).toMatchObject({ onboard_expiry_days: 7, ledger_type: 'inventory' });
    expect(openResponse.body.onboard_expires_at).toBeTruthy();

    const afterOpen = firstRow<{ OpenDate: string; AfterOpenExpiryDate: string }>(
      sqlite,
      'SELECT OpenDate, AfterOpenExpiryDate FROM InventoryStock WHERE StockId = 44',
    );
    expect(afterOpen.OpenDate).toBeTruthy();
    expect(afterOpen.AfterOpenExpiryDate).toBe(openResponse.body.onboard_expires_at);

    const operationLogs = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM lab_operation_logs WHERE consumable_id = ? AND log_type IN ('qc_performed', 'stock_opened')",
      consumableId,
    );
    expect(operationLogs.count).toBe(2);

    const auditLogs = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM InventoryAuditLog WHERE StockId = 44 AND ReferenceType IN ('lab_reagent_qc', 'lab_reagent_open_vial')",
    );
    expect(auditLogs.count).toBe(2);
  });

  it('blocks canonical InventoryStock reagent lots when QC is failed from stock controls', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');

    sqlite.exec(`
      ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ItemId INTEGER,
        StoreId INTEGER,
        BatchNo TEXT,
        ExpiryDate TEXT,
        AvailableQuantity REAL DEFAULT 0,
        CostPrice REAL DEFAULT 0,
        IsActive INTEGER DEFAULT 1,
        QCStatus TEXT DEFAULT 'passed',
        StockStatus TEXT DEFAULT 'available',
        ModifiedBy TEXT,
        ModifiedOn TEXT
      );
      CREATE TABLE InventoryAuditLog (
        AuditId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT,
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
    `);

    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = ? WHERE id = ?').run(7003, consumableId);
    sqlite.prepare(`
      INSERT INTO InventoryStock (StockId, tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, CostPrice, QCStatus, StockStatus, IsActive)
      VALUES (45, ?, 7003, 1, 'CAN-QC-FAIL-1', '2099-12-31', 8, 75, 'passed', 'available', 1)
    `).run(String(TENANT_ID));

    const qcResponse = await postJson<{ qc_status: string; stock_status: string; ledger_type: string }>(
      app,
      '/lab-monitoring/stock/45/qc',
      { qc_status: 'failed', remarks: 'QC failed by lab control' },
    );

    expect(qcResponse.status, JSON.stringify(qcResponse.body)).toBe(200);
    expect(qcResponse.body).toMatchObject({ qc_status: 'failed', stock_status: 'blocked', ledger_type: 'inventory' });

    const afterQc = firstRow<{ QCStatus: string; StockStatus: string; ModifiedBy: string }>(
      sqlite,
      'SELECT QCStatus, StockStatus, ModifiedBy FROM InventoryStock WHERE StockId = 45',
    );
    expect(afterQc).toMatchObject({ QCStatus: 'failed', StockStatus: 'blocked', ModifiedBy: String(USER_ID) });

    const auditLog = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM InventoryAuditLog WHERE StockId = 45 AND ReferenceType = 'lab_reagent_qc'",
    );
    expect(auditLog.count).toBe(1);
  });

  it('summarizes analyzer health for lab monitoring overview', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');

    sqlite.exec(`
      ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
      ALTER TABLE lab_machines ADD COLUMN machine_name TEXT;
      ALTER TABLE lab_machines ADD COLUMN machine_code TEXT;
      ALTER TABLE lab_machines ADD COLUMN tenant_id TEXT;
      ALTER TABLE lab_machines ADD COLUMN is_active INTEGER DEFAULT 1;
      ALTER TABLE lab_machines ADD COLUMN status TEXT DEFAULT 'active';
      CREATE TABLE lis_unmatched_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        machine_id INTEGER,
        status TEXT NOT NULL DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ItemId INTEGER,
        StoreId INTEGER,
        BatchNo TEXT,
        ExpiryDate TEXT,
        AvailableQuantity REAL DEFAULT 0,
        CostPrice REAL DEFAULT 0,
        IsActive INTEGER DEFAULT 1,
        QCStatus TEXT DEFAULT 'passed',
        OpenDate TEXT,
        AfterOpenExpiryDate TEXT,
        StockStatus TEXT DEFAULT 'available'
      );
    `);

    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = ? WHERE id = ?').run(8801, consumableId);
    sqlite.prepare("INSERT INTO lab_machines (id, machine_name, machine_code, tenant_id, is_active, status) VALUES (701, 'Analyzer 701', 'A-701', ?, 1, 'active')").run(String(TENANT_ID));
    sqlite.prepare("INSERT INTO lab_machines (id, machine_name, machine_code, tenant_id, is_active, status) VALUES (702, 'Analyzer 702', 'A-702', ?, 1, 'active')").run(String(TENANT_ID));
    sqlite.prepare("INSERT INTO lis_unmatched_results (tenant_id, machine_id, status) VALUES (?, 701, 'open')").run(String(TENANT_ID));
    sqlite.prepare("INSERT INTO lis_unmatched_results (tenant_id, machine_id, status) VALUES (?, 701, 'resolved')").run(String(TENANT_ID));
    sqlite.prepare(`
      INSERT INTO InventoryStock (StockId, tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, CostPrice, QCStatus, StockStatus, IsActive)
      VALUES (901, ?, 8801, 1, 'AHL-1', '2099-12-31', 5, 100, 'passed', 'available', 1)
    `).run(String(TENANT_ID));
    sqlite.prepare(`
      INSERT INTO InventoryStock (StockId, tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, CostPrice, QCStatus, StockStatus, IsActive)
      VALUES (902, ?, 8801, 1, 'AHL-2', '2099-12-31', 5, 100, 'passed', 'available', 1)
    `).run(String(TENANT_ID));
    sqlite.prepare(`
      INSERT INTO lab_reagent_analyzer_assignments
        (tenant_id, stock_id, inventory_item_id, consumable_id, machine_id, status, assigned_by)
      VALUES (?, 901, 8801, ?, 701, 'active', ?)
    `).run(String(TENANT_ID), consumableId, String(USER_ID));

    const response = await app.request('/lab-monitoring/analyzer-health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        open_unmatched_results: 1,
        machines_total: 2,
        active_assignments: 1,
        machines_with_active_assignment: 1,
        inventory_reagent_lots: 2,
        unassigned_inventory_lots: 1,
        machine_breakdown: [
          { machine_id: 701, machine_name: 'Analyzer 701', machine_code: 'A-701', open_unmatched_results: 1, active_assignments: 1, needs_attention: true },
          { machine_id: 702, machine_name: 'Analyzer 702', machine_code: 'A-702', open_unmatched_results: 0, active_assignments: 0, needs_attention: true },
        ],
      },
    });
  });

  it('assigns canonical reagent stock lots to analyzer machines and replaces the active assignment', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');

    sqlite.exec(`
      ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ItemId INTEGER,
        StoreId INTEGER,
        BatchNo TEXT,
        ExpiryDate TEXT,
        AvailableQuantity REAL DEFAULT 0,
        CostPrice REAL DEFAULT 0,
        IsActive INTEGER DEFAULT 1,
        QCStatus TEXT DEFAULT 'passed',
        OpenDate TEXT,
        AfterOpenExpiryDate TEXT,
        StockStatus TEXT DEFAULT 'available',
        ModifiedBy TEXT,
        ModifiedOn TEXT
      );
      CREATE TABLE InventoryAuditLog (
        AuditId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT,
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
    `);

    sqlite.exec('CREATE TABLE InventoryStore (StoreId INTEGER PRIMARY KEY, tenant_id TEXT, StoreCode TEXT, StoreName TEXT, StoreType TEXT);');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN machine_name TEXT;');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN machine_code TEXT;');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN tenant_id TEXT;');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN is_active INTEGER DEFAULT 1;');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN status TEXT DEFAULT "active";');
    sqlite.prepare("INSERT INTO InventoryStore (StoreId, tenant_id, StoreCode, StoreName, StoreType) VALUES (1, ?, 'LAB-A', 'Lab Store A', 'lab')").run(String(TENANT_ID));
    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = ? WHERE id = ?').run(7003, consumableId);
    sqlite.prepare(`
      INSERT INTO InventoryStock (StockId, tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, CostPrice, QCStatus, StockStatus, IsActive)
      VALUES (55, ?, 7003, 1, 'CAN-ANALYZER-1', '2099-12-31', 8, 75, 'passed', 'available', 1)
    `).run(String(TENANT_ID));
    sqlite.prepare('INSERT INTO lab_machines (id, machine_name, machine_code, tenant_id, is_active, status) VALUES (?, ?, ?, ?, 1, ?)').run(501, 'Mindray BC-10', 'CBC-501', String(TENANT_ID), 'active');
    const analyzerLocationId = sqlite.prepare(`
      INSERT INTO lab_consumable_locations (location_code, location_name, location_type, tenant_id, created_by)
      VALUES ('AN-1', 'Analyzer Bench 1', 'analyzer', ?, ?)
    `).run(TENANT_ID, USER_ID).lastInsertRowid;
    const secondLocationId = sqlite.prepare(`
      INSERT INTO lab_consumable_locations (location_code, location_name, location_type, tenant_id, created_by)
      VALUES ('AN-2', 'Analyzer Bench 2', 'analyzer', ?, ?)
    `).run(TENANT_ID, USER_ID).lastInsertRowid;

    const firstResponse = await postJson<{ ledger_type: string; stock_id: number; machine_id: number; location_id: number }>(
      app,
      '/lab-monitoring/stock/55/analyzer-assignment',
      { machine_id: 501, location_id: Number(analyzerLocationId), remarks: 'CBC analyzer reagent bottle' },
    );
    expect(firstResponse.status, JSON.stringify(firstResponse.body)).toBe(201);
    expect(firstResponse.body).toMatchObject({ ledger_type: 'inventory', stock_id: 55, machine_id: 501, location_id: Number(analyzerLocationId) });

    const secondResponse = await postJson<{ ledger_type: string; stock_id: number; machine_id: number; location_id: number }>(
      app,
      '/lab-monitoring/stock/55/analyzer-assignment',
      { machine_id: 501, location_id: Number(secondLocationId), remarks: 'moved to second bench' },
    );
    expect(secondResponse.status, JSON.stringify(secondResponse.body)).toBe(201);
    expect(secondResponse.body).toMatchObject({ ledger_type: 'inventory', stock_id: 55, machine_id: 501, location_id: Number(secondLocationId) });

    const activeAssignments = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM lab_reagent_analyzer_assignments WHERE tenant_id = ? AND stock_id = 55 AND status = 'active'",
      String(TENANT_ID),
    );
    expect(activeAssignments.count).toBe(1);

    const endedAssignments = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM lab_reagent_analyzer_assignments WHERE tenant_id = ? AND stock_id = 55 AND status = 'ended'",
      String(TENANT_ID),
    );
    expect(endedAssignments.count).toBe(1);

    const active = firstRow<{ location_id: number; assigned_by: string }>(
      sqlite,
      "SELECT location_id, assigned_by FROM lab_reagent_analyzer_assignments WHERE tenant_id = ? AND stock_id = 55 AND status = 'active'",
      String(TENANT_ID),
    );
    expect(active).toMatchObject({ location_id: Number(secondLocationId), assigned_by: String(USER_ID) });

    const detailResponse = await app.request('/lab-monitoring/consumables/' + consumableId);
    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json() as { stock: Array<Record<string, unknown>> };
    expect(detailBody.stock[0]).toMatchObject({ id: 55, ledger_type: 'inventory', assigned_machine_id: 501, analyzer_location_id: Number(secondLocationId), analyzer_location_name: 'Analyzer Bench 2', analyzer_assignment_remarks: 'moved to second bench' });

    const machinesResponse = await app.request('/lab-monitoring/machines');
    expect(machinesResponse.status).toBe(200);
    const machinesBody = await machinesResponse.json() as { data: Array<Record<string, unknown>> };
    expect(machinesBody.data[0]).toMatchObject({ id: 501, machine_name: 'Mindray BC-10', machine_code: 'CBC-501', status: 'active' });

    const operationLogs = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM lab_operation_logs WHERE consumable_id = ? AND log_type = 'machine_run' AND machine_id = 501",
      consumableId,
    );
    expect(operationLogs.count).toBe(2);

    const auditLogs = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM InventoryAuditLog WHERE StockId = 55 AND ReferenceType = 'lab_reagent_analyzer_assignment'",
    );
    expect(auditLogs.count).toBe(2);
  });

  it('rejects analyzer assignment for legacy lab stock lots because only canonical InventoryStock lots are assignable', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const legacyStockId = insertStock(sqlite, consumableId, { quantity: 8, qcStatus: 'passed' });

    sqlite.exec(`
      ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ItemId INTEGER,
        StoreId INTEGER,
        BatchNo TEXT,
        ExpiryDate TEXT,
        AvailableQuantity REAL DEFAULT 0,
        CostPrice REAL DEFAULT 0,
        IsActive INTEGER DEFAULT 1,
        QCStatus TEXT DEFAULT 'passed',
        StockStatus TEXT DEFAULT 'available',
        ModifiedBy TEXT,
        ModifiedOn TEXT
      );
    `);
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN machine_name TEXT;');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN machine_code TEXT;');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN tenant_id TEXT;');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN is_active INTEGER DEFAULT 1;');
    sqlite.prepare('INSERT INTO lab_machines (id, machine_name, machine_code, tenant_id, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(601, 'Hematology Analyzer', 'HA-601', String(TENANT_ID));

    const response = await postJson<{ error: string }>(
      app,
      `/lab-monitoring/stock/${legacyStockId}/analyzer-assignment`,
      { machine_id: 601, remarks: 'should not assign legacy lot' },
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Linked inventory reagent stock lot not found');
    const assignments = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM lab_reagent_analyzer_assignments WHERE tenant_id = ?",
      String(TENANT_ID),
    );
    expect(assignments.count).toBe(0);
  });

  it('rejects analyzer assignment without machine/location or with inactive analyzer and writes no partial assignment', async () => {
    const { app, sqlite } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');

    sqlite.exec(`
      ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER;
      CREATE TABLE InventoryStock (
        StockId INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ItemId INTEGER,
        StoreId INTEGER,
        BatchNo TEXT,
        ExpiryDate TEXT,
        AvailableQuantity REAL DEFAULT 0,
        CostPrice REAL DEFAULT 0,
        IsActive INTEGER DEFAULT 1,
        QCStatus TEXT DEFAULT 'passed',
        StockStatus TEXT DEFAULT 'available',
        ModifiedBy TEXT,
        ModifiedOn TEXT
      );
    `);
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN machine_name TEXT;');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN machine_code TEXT;');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN tenant_id TEXT;');
    sqlite.exec('ALTER TABLE lab_machines ADD COLUMN is_active INTEGER DEFAULT 1;');
    sqlite.prepare('UPDATE lab_consumables SET inventory_item_id = ? WHERE id = ?').run(7004, consumableId);
    sqlite.prepare(`
      INSERT INTO InventoryStock (StockId, tenant_id, ItemId, StoreId, BatchNo, ExpiryDate, AvailableQuantity, CostPrice, QCStatus, StockStatus, IsActive)
      VALUES (56, ?, 7004, 1, 'CAN-ANALYZER-NEG', '2099-12-31', 8, 75, 'passed', 'available', 1)
    `).run(String(TENANT_ID));
    sqlite.prepare('INSERT INTO lab_machines (id, machine_name, machine_code, tenant_id, is_active) VALUES (?, ?, ?, ?, 0)')
      .run(602, 'Inactive Chemistry Analyzer', 'CA-602', String(TENANT_ID));

    const missingTargetResponse = await postJson<{ error?: string }>(
      app,
      '/lab-monitoring/stock/56/analyzer-assignment',
      { remarks: 'missing machine and location' },
    );
    expect(missingTargetResponse.status).toBe(400);

    const inactiveMachineResponse = await postJson<{ error: string }>(
      app,
      '/lab-monitoring/stock/56/analyzer-assignment',
      { machine_id: 602, remarks: 'inactive analyzer should fail' },
    );
    expect(inactiveMachineResponse.status).toBe(404);
    expect(inactiveMachineResponse.body.error).toBe('Analyzer machine not found');

    const assignments = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM lab_reagent_analyzer_assignments WHERE tenant_id = ? AND stock_id = 56",
      String(TENANT_ID),
    );
    expect(assignments.count).toBe(0);
  });

  it('duplicate lab-order-item auto-consumption does not double-deduct', async () => {
    const { sqlite, d1 } = createHarness();
    const consumableId = insertConsumable(sqlite, 'reagent');
    const stockId = insertStock(sqlite, consumableId, { quantity: 10, qcStatus: 'passed' });

    sqlite.prepare(`
      INSERT INTO lab_test_consumable_map (lab_test_id, consumable_id, qty_per_test, is_mandatory, tenant_id)
      VALUES (?, ?, 2, 1, ?)
    `).run(LAB_TEST_ID, consumableId, TENANT_ID);

    const input = {
      tenantId: TENANT_ID,
      userId: USER_ID,
      labOrderItemId: 83001,
      labOrderId: LAB_ORDER_ID,
      labTestId: LAB_TEST_ID,
    };

    const first = await consumeMappedLabConsumables(d1, input);
    const second = await consumeMappedLabConsumables(d1, input);

    expect(first.quantity).toBe(2);
    expect(second).toMatchObject({ mappings: 0, quantity: 0, cost: 0 });

    const stock = firstRow<{ quantity_used: number; quantity_available: number }>(
      sqlite,
      'SELECT quantity_used, quantity_available FROM lab_consumable_stock WHERE id = ?',
      stockId,
    );
    expect(stock).toMatchObject({ quantity_used: 2, quantity_available: 8 });

    const movementCount = firstRow<{ count: number }>(
      sqlite,
      "SELECT COUNT(*) as count FROM lab_consumable_movements WHERE reference_type = 'lab_order_item' AND reference_id = ?",
      input.labOrderItemId,
    );
    expect(movementCount.count).toBe(1);
  });
});
