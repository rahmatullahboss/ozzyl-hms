import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { PharmacySaleContext } from '../../src/lib/canonical/pharmacy-sale-types';
import { hydratePharmacySaleCanonicalAuthority } from '../../src/lib/canonical/pharmacy-sale-authority';

type SqlValue = string | number | bigint | null | Uint8Array;
const HASH = 'a'.repeat(64);

class Statement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement { return new Statement(this.sqlite, this.sql, values as SqlValue[]); }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('migrations/0508_canonical_service_catalog.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0514_canonical_inventory_links.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE pharmacy_uom (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,name TEXT NOT NULL
    );
    CREATE TABLE pharmacy_items (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,uom_id INTEGER,name TEXT,is_active INTEGER
    );
    INSERT INTO pharmacy_uom VALUES (7,'100','BOX');
    INSERT INTO pharmacy_items VALUES (20,'100',7,'Test medicine',1);
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('100','svc_20','product','PHARMACY-20','Canonical medicine','EA','active','${HASH}');
    INSERT INTO canonical_inventory_items (
      tenant_id,item_public_id,item_kind,legacy_pharmacy_item_id,service_public_id,
      display_name,base_unit_code,status,source_evidence_sha256
    ) VALUES ('100','invitem_20','medicine',20,'svc_20','Canonical medicine','EA','active','${HASH}');
    INSERT INTO canonical_inventory_locations (
      tenant_id,location_public_id,location_type,location_code,display_name,status,source_evidence_sha256
    ) VALUES ('100','loc_pharm','pharmacy','PHARMACY-RICH','Pharmacy','active','${HASH}');
    INSERT INTO canonical_inventory_lots (
      tenant_id,lot_public_id,item_public_id,legacy_pharmacy_stock_id,lot_code,expiry_date,status,source_evidence_sha256
    ) VALUES ('100','lot_30','invitem_20',30,'B-001','2027-01-01','active','${HASH}');
    INSERT INTO canonical_inventory_unit_conversions (
      tenant_id,conversion_public_id,item_public_id,source_unit_code,base_unit_code,
      numerator,denominator,status,source_evidence_sha256
    ) VALUES ('100','conv_20_box','invitem_20','BOX','EA',10,1,'active','${HASH}');
    INSERT INTO canonical_inventory_stock_policies (
      tenant_id,item_public_id,location_public_id,allow_negative_stock,source_evidence_sha256
    ) VALUES ('100','invitem_20','loc_pharm',0,'${HASH}');
    INSERT INTO canonical_inventory_balances (
      tenant_id,item_public_id,location_public_id,lot_public_id,quantity_base,version,
      projection_guard,source_evidence_sha256
    ) VALUES ('100','invitem_20','loc_pharm','lot_30',100,4,1,'${HASH}');
  `);
  return {
    sqlite,
    db: { prepare(sql: string) { return new Statement(sqlite, sql); } },
  };
}

function context(): PharmacySaleContext {
  return {
    tenantId: '100', userId: 9, patientId: 501, patientVisitId: null,
    prescriberId: null, counterId: null, sourceKind: 'provisional_conversion',
    sourceDocumentId: 5, invoiceNo: 'PENDING', businessDate: '2026-07-24',
    occurredAtUtc: '2026-07-24T04:00:00.000Z', paymentMode: 'cash',
    externalTransactionId: null, tender: 100, subtotal: 100, sourceDiscountPct: 0,
    discountAmount: 0, total: 100, paidAmount: 100, creditAmount: 0,
    depositDeductAmount: 0, remarks: null,
    items: [{
      lineNumber: 1, duplicateOrdinal: 0, sourceItemId: 6,
      pharmacyItemId: 20, stockId: 30, itemName: 'Pharmacy item 20',
      batchNo: 'B-001', expiryDate: '2027-01-01', sourceUnitCode: null,
      quantity: 1, mrp: 100, price: 100, salePrice: 100,
      discountPct: 0, vatPct: 0, subtotal: 100, total: 100,
      costPrice: 50, legacyAvailableBefore: 10, canonical: null,
    }],
  };
}

describe('hydratePharmacySaleCanonicalAuthority', () => {
  it('resolves active service, item, lot, pharmacy location, conversion and balance authority', async () => {
    const { sqlite, db } = harness();
    try {
      const hydrated = await hydratePharmacySaleCanonicalAuthority(db, context());
      expect(hydrated.items[0]).toMatchObject({
        itemName: 'Test medicine',
        sourceUnitCode: 'BOX',
        canonical: {
          itemPublicId: 'invitem_20', servicePublicId: 'svc_20', lotPublicId: 'lot_30',
          locationPublicId: 'loc_pharm', baseUnitCode: 'EA',
          conversionNumerator: 10, conversionDenominator: 1,
          balanceBeforeBase: 100, balanceVersion: 4,
        },
      });
    } finally { sqlite.close(); }
  });

  it('fails closed when the canonical balance authority is absent', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec('DELETE FROM canonical_inventory_balances');
      await expect(hydratePharmacySaleCanonicalAuthority(db, context()))
        .rejects.toThrow(/authority is unavailable/i);
    } finally { sqlite.close(); }
  });
});
