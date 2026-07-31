import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  commitGoodsReceiptCore,
  prepareGoodsReceipt,
  type GoodsReceiptItemPolicy,
} from '../src/lib/inventory-goods-receipt-atomic';
import type { CreateGoodsReceiptInput } from '../src/schemas/inventory';

class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: Array<string | number | bigint | null | Uint8Array> = [],
  ) {}

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(
      this.database,
      this.sql,
      params.map((value) => value === undefined ? null : value) as Array<string | number | bigint | null | Uint8Array>,
    );
  }

  async run() {
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

  async all<T = Record<string, unknown>>() {
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
        const results = [];
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

    CREATE TABLE InventoryGoodsReceipt (
      GoodsReceiptId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      GRNumber TEXT,
      GRDate TEXT,
      VendorId INTEGER,
      PurchaseOrderId INTEGER,
      StoreId INTEGER,
      VendorBillNo TEXT,
      VendorBillDate TEXT,
      PaymentMode TEXT,
      SubTotal REAL,
      DiscountAmount REAL,
      VATAmount REAL,
      FreightAmount REAL,
      InsuranceAmount REAL,
      OtherCharges REAL,
      TotalAmount REAL,
      CreditPeriod INTEGER,
      IsDonation INTEGER DEFAULT 0,
      Remarks TEXT,
      IsCancelled INTEGER DEFAULT 0,
      CreatedBy TEXT,
      CreatedOn TEXT,
      ModifiedOn TEXT,
      OperationKey TEXT,
      RequestHash TEXT,
      OperationStatus TEXT NOT NULL DEFAULT 'completed',
      UNIQUE(tenant_id, OperationKey)
    );

    CREATE TABLE InventoryGoodsReceiptItem (
      GRItemId INTEGER PRIMARY KEY AUTOINCREMENT,
      GoodsReceiptId INTEGER NOT NULL,
      ItemId INTEGER NOT NULL,
      POItemId INTEGER,
      BatchNo TEXT,
      ExpiryDate TEXT,
      ManufactureDate TEXT,
      ReceivedQuantity REAL NOT NULL,
      FreeQuantity REAL DEFAULT 0,
      RejectedQuantity REAL DEFAULT 0,
      ItemRate REAL,
      MRP REAL,
      VATPercent REAL,
      VATAmount REAL,
      DiscountPercent REAL,
      DiscountAmount REAL,
      SubTotal REAL,
      TotalAmount REAL,
      Remarks TEXT,
      CreatedBy TEXT,
      CreatedOn TEXT,
      OperationLineKey TEXT,
      FOREIGN KEY(GoodsReceiptId) REFERENCES InventoryGoodsReceipt(GoodsReceiptId)
    );

    CREATE TABLE InventoryStock (
      StockId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      ItemId INTEGER NOT NULL,
      StoreId INTEGER NOT NULL,
      GRItemId INTEGER NOT NULL,
      BatchNo TEXT,
      ExpiryDate TEXT,
      CostPrice REAL,
      MRP REAL,
      AvailableQuantity REAL,
      QCStatus TEXT,
      StockStatus TEXT,
      CreatedBy TEXT,
      CreatedOn TEXT,
      ReceiptOperationLineKey TEXT,
      FOREIGN KEY(GRItemId) REFERENCES InventoryGoodsReceiptItem(GRItemId)
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

    CREATE TABLE InventoryPurchaseOrder (
      PurchaseOrderId INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      POStatus TEXT
    );

    CREATE TABLE InventoryPurchaseOrderItem (
      POItemId INTEGER PRIMARY KEY,
      PurchaseOrderId INTEGER NOT NULL,
      ItemId INTEGER NOT NULL,
      Quantity REAL NOT NULL
    );

    CREATE TABLE inventory_gr_batch_guard (
      tenant_id TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
      PRIMARY KEY(tenant_id, operation_key, item_id)
    );
  `);
  return { sqlite, d1: createTransactionalD1(sqlite) };
}

function body(items: CreateGoodsReceiptInput['Items'], purchaseOrderId?: number): CreateGoodsReceiptInput {
  return {
    IdempotencyKey: 'gr-atomic-test-key',
    VendorId: 10,
    PurchaseOrderId: purchaseOrderId,
    StoreId: 5,
    GRDate: '2026-07-10',
    PaymentMode: 'credit',
    DiscountPercent: 0,
    DiscountAmount: 0,
    FreightAmount: 0,
    InsuranceAmount: 0,
    OtherCharges: 0,
    CreditPeriod: 30,
    IsDonation: false,
    Items: items,
  };
}

function line(itemId: number, quantity = 2): CreateGoodsReceiptInput['Items'][number] {
  return {
    ItemId: itemId,
    BatchNo: `LOT-${itemId}`,
    ExpiryDate: '2027-12-31',
    ReceivedQuantity: quantity,
    FreeQuantity: 0,
    RejectedQuantity: 0,
    ItemRate: 100,
    MRP: 120,
    VATPercent: 0,
    DiscountPercent: 0,
  };
}

function policies(itemIds: number[]): Map<number, GoodsReceiptItemPolicy> {
  return new Map(itemIds.map((itemId) => [itemId, {
    ItemId: itemId,
    ItemType: 'lab_reagent',
    UnitConversionFactor: 10,
    IsBatchRequired: 1,
    IsExpiryRequired: 1,
  }]));
}

describe('atomic inventory goods receipt core', () => {
  it('commits header, lines, canonical stock and stock ledger in one transaction', async () => {
    const { sqlite, d1 } = createHarness();
    const requestBody = body([line(101)]);
    const prepared = prepareGoodsReceipt(requestBody, policies([101]));

    const result = await commitGoodsReceiptCore(d1, {
      tenantId: 'tenant-a',
      userId: '7',
      operationKey: 'gr-atomic-success',
      requestHash: 'hash-success',
      grNumber: 'GRN-1',
      today: '2026-07-10',
      body: requestBody,
      prepared,
    });

    expect(result.goodsReceiptId).toBeGreaterThan(0);
    expect(result.lines[0].grItemId).toBeGreaterThan(0);
    expect(result.lines[0].stockId).toBeGreaterThan(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM InventoryGoodsReceipt').get()).toMatchObject({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM InventoryGoodsReceiptItem').get()).toMatchObject({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM InventoryStock').get()).toMatchObject({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM InventoryStockTransaction').get()).toMatchObject({ count: 1 });
    expect(sqlite.prepare('SELECT OperationStatus, OperationKey FROM InventoryGoodsReceipt').get()).toMatchObject({
      OperationStatus: 'core_completed',
      OperationKey: 'gr-atomic-success',
    });
    expect(sqlite.prepare('SELECT AvailableQuantity, CostPrice, QCStatus, StockStatus FROM InventoryStock').get()).toMatchObject({
      AvailableQuantity: 20,
      CostPrice: 10,
      QCStatus: 'pending',
      StockStatus: 'blocked',
    });
  });

  it('rolls back the entire goods receipt when a later stock line fails', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      CREATE TRIGGER fail_second_stock
      BEFORE INSERT ON InventoryStock
      WHEN NEW.ItemId = 202
      BEGIN
        SELECT RAISE(ABORT, 'forced second stock failure');
      END;
    `);
    const requestBody = body([line(101), line(202)]);
    const prepared = prepareGoodsReceipt(requestBody, policies([101, 202]));

    await expect(commitGoodsReceiptCore(d1, {
      tenantId: 'tenant-a',
      userId: '7',
      operationKey: 'gr-atomic-rollback',
      requestHash: 'hash-rollback',
      grNumber: 'GRN-2',
      today: '2026-07-10',
      body: requestBody,
      prepared,
    })).rejects.toThrow('forced second stock failure');

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM InventoryGoodsReceipt').get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM InventoryGoodsReceiptItem').get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM InventoryStock').get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM InventoryStockTransaction').get()).toMatchObject({ count: 0 });
  });

  it('atomically rejects concurrent PO over-receipt without creating a new GR', async () => {
    const { sqlite, d1 } = createHarness();
    sqlite.exec(`
      INSERT INTO InventoryPurchaseOrder (PurchaseOrderId, tenant_id, POStatus) VALUES (50, 'tenant-a', 'partial');
      INSERT INTO InventoryPurchaseOrderItem (POItemId, PurchaseOrderId, ItemId, Quantity) VALUES (500, 50, 101, 5);
      INSERT INTO InventoryGoodsReceipt
        (GoodsReceiptId, tenant_id, GRNumber, GRDate, VendorId, PurchaseOrderId, StoreId,
         OperationKey, RequestHash, OperationStatus)
      VALUES (1, 'tenant-a', 'OLD-GR', '2026-07-01', 10, 50, 5, 'old-gr', 'old-hash', 'completed');
      INSERT INTO InventoryGoodsReceiptItem
        (GRItemId, GoodsReceiptId, ItemId, ReceivedQuantity, ItemRate)
      VALUES (1, 1, 101, 4, 100);
    `);
    const requestBody = body([line(101, 2)], 50);
    const prepared = prepareGoodsReceipt(requestBody, policies([101]));

    await expect(commitGoodsReceiptCore(d1, {
      tenantId: 'tenant-a',
      userId: '7',
      operationKey: 'gr-po-over-receipt',
      requestHash: 'hash-po',
      grNumber: 'GRN-3',
      today: '2026-07-10',
      body: requestBody,
      prepared,
    })).rejects.toMatchObject({ status: 409 });

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM InventoryGoodsReceipt').get()).toMatchObject({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM inventory_gr_batch_guard').get()).toMatchObject({ count: 0 });
  });
});
