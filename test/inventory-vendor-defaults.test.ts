import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INVENTORY_VENDOR_PROFILES, seedInventoryVendorDefaults } from '../src/lib/inventory-vendor-defaults.ts';

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
}

function createHarness(): { sqlite: DatabaseSync; d1: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE InventoryVendor (
      VendorId INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      VendorName TEXT NOT NULL,
      VendorCode TEXT,
      ContactPerson TEXT,
      ContactPhone TEXT,
      ContactEmail TEXT,
      ContactAddress TEXT,
      City TEXT,
      Country TEXT,
      PANNo TEXT,
      CreditPeriod INTEGER DEFAULT 30,
      IsActive INTEGER DEFAULT 1,
      IsTDSApplicable INTEGER DEFAULT 0,
      TDSPercent REAL DEFAULT 0,
      CreatedBy INTEGER,
      CreatedOn TEXT DEFAULT CURRENT_TIMESTAMP,
      ModifiedBy INTEGER,
      ModifiedOn TEXT
    );
  `);

  const d1 = {
    prepare(sql: string) {
      return new SqliteD1PreparedStatement(sqlite, sql);
    },
  } as unknown as D1Database;

  return { sqlite, d1 };
}

describe('inventory vendor default seeding', () => {
  it('includes professional starter suppliers for lab and diagnostic inventory', () => {
    const names = DEFAULT_INVENTORY_VENDOR_PROFILES.map((vendor) => vendor.name);
    const codes = DEFAULT_INVENTORY_VENDOR_PROFILES.map((vendor) => vendor.code);

    expect(names).toEqual(expect.arrayContaining([
      'Roche Diagnostics Supplier',
      'Mindray Biomedical Supplier',
      'Local Lab Consumables Supplier',
      'Tube & Needle Supplier',
    ]));
    expect(codes).toEqual(expect.arrayContaining([
      'VND-ROCHE-DX',
      'VND-MINDRAY-BIO',
      'VND-LAB-CONS',
      'VND-TUBE-NEEDLE',
    ]));
  });

  it('seeds vendor defaults per tenant and stays idempotent', async () => {
    const { sqlite, d1 } = createHarness();

    const first = await seedInventoryVendorDefaults(d1, 91001);
    expect(first.created).toBe(DEFAULT_INVENTORY_VENDOR_PROFILES.length);
    expect(first.skipped).toBe(0);

    const vendorSummary = sqlite.prepare(`
      SELECT COUNT(*) as total
      FROM InventoryVendor
      WHERE tenant_id = '91001' AND IsActive = 1
    `).get() as { total: number };
    expect(vendorSummary.total).toBe(DEFAULT_INVENTORY_VENDOR_PROFILES.length);

    const roche = sqlite.prepare(`
      SELECT VendorName, VendorCode, ContactPerson, City, Country, CreditPeriod
      FROM InventoryVendor
      WHERE VendorCode = 'VND-ROCHE-DX'
    `).get() as { VendorName: string; VendorCode: string; ContactPerson: string; City: string; Country: string; CreditPeriod: number };
    expect(roche).toMatchObject({
      VendorName: 'Roche Diagnostics Supplier',
      VendorCode: 'VND-ROCHE-DX',
      ContactPerson: 'Procurement Desk',
      City: 'Dhaka',
      Country: 'Bangladesh',
      CreditPeriod: 30,
    });

    const second = await seedInventoryVendorDefaults(d1, 91001);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(DEFAULT_INVENTORY_VENDOR_PROFILES.length);

    const afterSecond = sqlite.prepare(`
      SELECT COUNT(*) as total
      FROM InventoryVendor
      WHERE tenant_id = '91001'
    `).get() as { total: number };
    expect(afterSecond.total).toBe(DEFAULT_INVENTORY_VENDOR_PROFILES.length);
  });

  it('does not cross-seed duplicate checks between tenants', async () => {
    const { sqlite, d1 } = createHarness();

    await seedInventoryVendorDefaults(d1, 91001);
    await seedInventoryVendorDefaults(d1, 91002);

    const summary = sqlite.prepare(`
      SELECT tenant_id, COUNT(*) as total
      FROM InventoryVendor
      GROUP BY tenant_id
      ORDER BY tenant_id
    `).all() as Array<{ tenant_id: string; total: number }>;

    expect(summary).toEqual([
      { tenant_id: '91001', total: DEFAULT_INVENTORY_VENDOR_PROFILES.length },
      { tenant_id: '91002', total: DEFAULT_INVENTORY_VENDOR_PROFILES.length },
    ]);
  });
});
