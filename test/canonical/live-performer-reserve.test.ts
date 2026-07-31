import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { issueInvoice } from '../../src/lib/canonical/commands/issue-invoice';
import { buildLiveInvoiceProjection } from '../../src/lib/canonical/live-financial-projection';
import { executeLivePerformerReserveAccrual } from '../../src/lib/canonical/live-performer-reserve';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0510_canonical_invoices.sql',
    '0511_canonical_payments.sql',
    '0512_canonical_adjustments.sql',
    '0513_canonical_practitioner_compensation.sql',
    '0530_canonical_compensation_reporting_context.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec(`
    DROP INDEX uq_canonical_compensation_accruals_assigned;
    DROP INDEX uq_canonical_compensation_accruals_unassigned;
    CREATE UNIQUE INDEX uq_canonical_compensation_accruals_assigned
      ON canonical_compensation_accruals(
        tenant_id,invoice_line_public_id,practitioner_public_id,
        practitioner_role,rule_public_id,rule_version,source_evidence_sha256
      ) WHERE practitioner_public_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_canonical_compensation_accruals_unassigned
      ON canonical_compensation_accruals(
        tenant_id,invoice_line_public_id,practitioner_role,
        rule_public_id,rule_version,source_evidence_sha256
      ) WHERE practitioner_public_id IS NULL;
    CREATE TABLE diagnostic_performer_reserves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      canonical_source_key TEXT,
      reserved_amount REAL NOT NULL
    );
    CREATE UNIQUE INDEX uq_diagnostic_performer_reserve_canonical_source_key
      ON diagnostic_performer_reserves(tenant_id,canonical_source_key)
      WHERE canonical_source_key IS NOT NULL;
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      invoice_no TEXT,
      total REAL NOT NULL,
      paid REAL NOT NULL DEFAULT 0,
      due REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax_total REAL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      item_category TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      tax_amount REAL,
      reference_id INTEGER,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE TABLE billing_service_departments (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      department_code TEXT NOT NULL,
      department_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE billing_service_items (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      service_department_id INTEGER NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      price REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT
    );
  `);

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, db };
}

async function seedServiceAndFlag(sqlite: DatabaseSync): Promise<void> {
  const servicePublicId = await createDeterministicSourceId(
    'svc',
    '100',
    'legacy_billing_service_item',
    '44',
  );
  const evidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'legacy_billing_service_item',
    sourcePublicId: '44',
    departmentId: 5,
    code: 'USG',
    name: 'usg whole abdomen',
    price: '1000',
    active: true,
  });
  sqlite.exec(`
    INSERT INTO billing_service_departments (
      id,tenant_id,department_code,department_name,is_active
    ) VALUES (5,100,'RAD','Radiology and Imaging',1);
    INSERT INTO billing_service_items (
      id,tenant_id,service_department_id,item_code,item_name,price,is_active,created_at
    ) VALUES (44,100,5,'USG','USG Whole Abdomen',1000,1,'2026-01-01 00:00:00');
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,canonical_code,display_name,
      unit_code,status,source_evidence_sha256
    ) VALUES ('100','${servicePublicId}','radiology','USG','USG Whole Abdomen',
      'service','active','${evidenceSha256}');
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('100','service_catalog_item','${servicePublicId}','legacy_billing_service_item','44',
      'billing_service_items','mapped',1,'${evidenceSha256}');
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,version,config_json
    ) VALUES ('100','canonical_financial_dual_write_v1','financial','shadow',1,1,
      '{"tenantScope":["100"],"writePolicy":"strict"}');
  `);
}

async function seedInvoiceAndService(
  sqlite: DatabaseSync,
  db: CanonicalBatchDatabase,
): Promise<void> {
  await seedServiceAndFlag(sqlite);
  await issueInvoice(db, await buildLiveInvoiceProjection({
    tenantId: '100',
    patientId: 10,
    invoiceNo: 'INV-D-2026-000800',
    currencyCode: 'BDT',
    issuedAtUtc: '2026-07-20T11:00:00.000Z',
    items: [{
      sourceLineId: '1:usg:44',
      lineType: 'other_adjustment',
      adjustmentCode: 'LEGACY_USG',
      quantity: 1,
      unitAmount: 1000,
    }],
    discount: 100,
  }));
}

describe('live performer reserve canonical projection', () => {
  it('recovers a missing canonical invoice before accruing the reserve', async () => {
    const { sqlite, db } = harness();
    try {
      await seedServiceAndFlag(sqlite);
      sqlite.exec(`
        INSERT INTO bills (
          id,tenant_id,patient_id,invoice_no,total,paid,due,discount,tax_total,status,created_at
        ) VALUES (8001,100,10,'INV-D-2026-000801',900,900,0,100,0,'paid','2026-07-20 17:30:00');
        INSERT INTO invoice_items (
          id,tenant_id,bill_id,item_category,quantity,unit_price,line_total,tax_amount,reference_id,status,created_at
        ) VALUES (9001,100,8001,'usg',1,1000,900,0,44,'active','2026-07-20 17:30:00');
      `);

      const sourceKey = 'bill:8001:line:1:usg:44:rule:77:unit:1:performer-reserve';
      const result = await executeLivePerformerReserveAccrual(db, {
        tenantId: '100',
        legacyStatement: db.prepare(`
          INSERT INTO diagnostic_performer_reserves (
            tenant_id,canonical_source_key,reserved_amount
          ) VALUES (?,?,?)
        `).bind('100', sourceKey, 200),
        legacyReserveSourceKey: sourceKey,
        billId: 8001,
        billItemId: 9001,
        invoiceNo: 'INV-D-2026-000801',
        invoiceSourceLineId: '1:usg:44',
        unitSequence: 1,
        rule: {
          id: 77,
          billingServiceItemId: 44,
          diagnosticKind: 'radiology',
          rateType: 'flat',
          rateValue: 200,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
          createdAt: '2026-01-01 00:00:00',
          updatedAt: '2026-01-01 00:00:00',
        },
        lineGrossAmount: 1000,
        lineNetAmount: 900,
        grossAmount: 1000,
        discountAmount: 100,
        netAmount: 900,
        reservedAmount: 200,
        accruedAtUtc: '2026-07-20T11:30:00.000Z',
        businessDate: '2026-07-20',
        reportingContext: {
          sourceKind: 'performer_reserve',
          incentiveType: 'performer',
          legacyInvoiceItemId: 9001,
          detailName: 'USG Whole Abdomen',
          sourceReference: 'INV-D-2026-000801',
        },
      });

      expect(result.mode).toBe('strict');
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_invoices
        WHERE tenant_id='100' AND invoice_number='INV-D-2026-000801'
      `).get() as { count: number }).count)).toBe(1);
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_compensation_accruals
      `).get() as { count: number }).count)).toBe(1);
      expect(sqlite.prepare(`
        SELECT source_kind,incentive_type,legacy_bill_id,legacy_invoice_item_id,
               detail_name,source_reference,waiver_reason
        FROM canonical_compensation_reporting_context
      `).get()).toEqual({
        source_kind: 'performer_reserve',
        incentive_type: 'performer',
        legacy_bill_id: 8001,
        legacy_invoice_item_id: 9001,
        detail_name: 'USG Whole Abdomen',
        source_reference: 'INV-D-2026-000801',
        waiver_reason: null,
      });
    } finally {
      sqlite.close();
    }
  });

  it('uses a recovered invoice-item net line as performer reserve authority', async () => {
    const { sqlite, db } = harness();
    try {
      await seedServiceAndFlag(sqlite);
      sqlite.exec(`
        INSERT INTO bills (
          id,tenant_id,patient_id,invoice_no,total,paid,due,discount,tax_total,status,created_at
        ) VALUES (8002,100,10,'INV-D-2026-000802',900,900,0,100,0,'paid','2026-07-20 17:40:00');
        INSERT INTO invoice_items (
          id,tenant_id,bill_id,item_category,quantity,unit_price,line_total,tax_amount,reference_id,status,created_at
        ) VALUES (9002,100,8002,'usg',1,1000,900,0,44,'active','2026-07-20 17:40:00');
      `);
      await issueInvoice(db, await buildLiveInvoiceProjection({
        tenantId: '100',
        patientId: 10,
        invoiceNo: 'INV-D-2026-000802',
        currencyCode: 'BDT',
        issuedAtUtc: '2026-07-20T11:40:00.000Z',
        items: [{
          sourceLineId: 'invoice_item:9002',
          lineType: 'other_adjustment',
          adjustmentCode: 'LEGACY_USG',
          quantity: 1,
          unitAmount: 900,
        }],
      }));

      const sourceKey = 'bill:8002:line:1:usg:44:rule:77:unit:1:performer-reserve';
      await executeLivePerformerReserveAccrual(db, {
        tenantId: '100',
        legacyStatement: db.prepare(`
          INSERT INTO diagnostic_performer_reserves (
            tenant_id,canonical_source_key,reserved_amount
          ) VALUES (?,?,?)
        `).bind('100', sourceKey, 200),
        legacyReserveSourceKey: sourceKey,
        billId: 8002,
        billItemId: 9002,
        invoiceNo: 'INV-D-2026-000802',
        invoiceSourceLineId: '1:usg:44',
        unitSequence: 1,
        rule: {
          id: 77,
          billingServiceItemId: 44,
          diagnosticKind: 'radiology',
          rateType: 'flat',
          rateValue: 200,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
          createdAt: '2026-01-01 00:00:00',
          updatedAt: '2026-01-01 00:00:00',
        },
        lineGrossAmount: 1000,
        lineNetAmount: 900,
        grossAmount: 1000,
        discountAmount: 100,
        netAmount: 900,
        reservedAmount: 200,
        accruedAtUtc: '2026-07-20T11:40:00.000Z',
        businessDate: '2026-07-20',
      });

      expect(sqlite.prepare(`
        SELECT gross_minor,discount_minor,eligible_base_minor,earned_minor,payable_minor
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        gross_minor: 100000,
        discount_minor: 10000,
        eligible_base_minor: 90000,
        earned_minor: 20000,
        payable_minor: 20000,
      });
    } finally {
      sqlite.close();
    }
  });

  it('recovers a missing billing-service mapping before accruing the reserve', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_feature_flags (
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES ('100','canonical_financial_dual_write_v1','financial','shadow',1,1,
          '{"tenantScope":["100"],"writePolicy":"strict"}');
        INSERT INTO billing_service_departments (
          id,tenant_id,department_code,department_name,is_active
        ) VALUES (5,100,'RAD','Radiology and Imaging',1);
        INSERT INTO billing_service_items (
          id,tenant_id,service_department_id,item_code,item_name,price,is_active,created_at
        ) VALUES (45,100,5,'USG-NEW','USG New Service',1000,1,'2026-07-20 08:00:00');
      `);
      await issueInvoice(db, await buildLiveInvoiceProjection({
        tenantId: '100',
        patientId: 10,
        invoiceNo: 'INV-D-2026-000803',
        currencyCode: 'BDT',
        issuedAtUtc: '2026-07-20T12:00:00.000Z',
        items: [{
          sourceLineId: '1:usg:45',
          lineType: 'other_adjustment',
          adjustmentCode: 'LEGACY_USG',
          quantity: 1,
          unitAmount: 1000,
        }],
        discount: 100,
      }));

      const sourceKey = 'bill:8003:line:1:usg:45:rule:78:unit:1:performer-reserve';
      await executeLivePerformerReserveAccrual(db, {
        tenantId: '100',
        legacyStatement: db.prepare(`
          INSERT INTO diagnostic_performer_reserves (
            tenant_id,canonical_source_key,reserved_amount
          ) VALUES (?,?,?)
        `).bind('100', sourceKey, 200),
        legacyReserveSourceKey: sourceKey,
        billId: 8003,
        billItemId: 9003,
        invoiceNo: 'INV-D-2026-000803',
        invoiceSourceLineId: '1:usg:45',
        unitSequence: 1,
        rule: {
          id: 78,
          billingServiceItemId: 45,
          diagnosticKind: 'radiology',
          rateType: 'flat',
          rateValue: 200,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
          createdAt: '2026-01-01 00:00:00',
          updatedAt: '2026-01-01 00:00:00',
        },
        lineGrossAmount: 1000,
        lineNetAmount: 900,
        grossAmount: 1000,
        discountAmount: 100,
        netAmount: 900,
        reservedAmount: 200,
        accruedAtUtc: '2026-07-20T12:00:00.000Z',
        businessDate: '2026-07-20',
      });

      expect(sqlite.prepare(`
        SELECT i.item_kind,i.canonical_code,i.display_name,m.mapping_status
        FROM canonical_source_mappings m
        JOIN canonical_service_catalog_items i
          ON i.tenant_id=m.tenant_id AND i.service_public_id=m.canonical_public_id
        WHERE m.tenant_id='100' AND m.entity_type='service_catalog_item'
          AND m.source_type='legacy_billing_service_item' AND m.source_public_id='45'
      `).get()).toEqual({
        item_kind: 'radiology',
        canonical_code: 'USG-NEW',
        display_name: 'USG New Service',
        mapping_status: 'mapped',
      });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_service_prices WHERE tenant_id='100'
      `).get() as { count: number }).count)).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed without overwriting a conflicting billing-service mapping in shadow mode', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_feature_flags (
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES ('100','canonical_financial_dual_write_v1','financial','shadow',1,1,
          '{"tenantScope":["100"],"writePolicy":"shadow"}');
        INSERT INTO billing_service_departments (
          id,tenant_id,department_code,department_name,is_active
        ) VALUES (6,100,'RAD','Radiology and Imaging',1);
        INSERT INTO billing_service_items (
          id,tenant_id,service_department_id,item_code,item_name,price,is_active,created_at
        ) VALUES (46,100,6,'USG-CONFLICT','USG Conflict Service',1000,1,'2026-07-20 08:00:00');
        INSERT INTO canonical_service_catalog_items (
          tenant_id,service_public_id,item_kind,canonical_code,display_name,
          unit_code,status,source_evidence_sha256
        ) VALUES ('100','svc-conflicting','radiology','OLD-USG','Old USG Service',
          'service','active','${'d'.repeat(64)}');
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES ('100','service_catalog_item','svc-conflicting','legacy_billing_service_item','46',
          'billing_service_items','mapped',1,'${'e'.repeat(64)}');
      `);
      await issueInvoice(db, await buildLiveInvoiceProjection({
        tenantId: '100',
        patientId: 10,
        invoiceNo: 'INV-D-2026-000804',
        currencyCode: 'BDT',
        issuedAtUtc: '2026-07-20T12:10:00.000Z',
        items: [{
          sourceLineId: '1:usg:46',
          lineType: 'other_adjustment',
          adjustmentCode: 'LEGACY_USG',
          quantity: 1,
          unitAmount: 1000,
        }],
        discount: 100,
      }));

      const sourceKey = 'bill:8004:line:1:usg:46:rule:79:unit:1:performer-reserve';
      const execution = await executeLivePerformerReserveAccrual(db, {
        tenantId: '100',
        legacyStatement: db.prepare(`
          INSERT INTO diagnostic_performer_reserves (
            tenant_id,canonical_source_key,reserved_amount
          ) VALUES (?,?,?)
        `).bind('100', sourceKey, 200),
        legacyReserveSourceKey: sourceKey,
        billId: 8004,
        billItemId: 9004,
        invoiceNo: 'INV-D-2026-000804',
        invoiceSourceLineId: '1:usg:46',
        unitSequence: 1,
        rule: {
          id: 79,
          billingServiceItemId: 46,
          diagnosticKind: 'radiology',
          rateType: 'flat',
          rateValue: 200,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
          createdAt: '2026-01-01 00:00:00',
          updatedAt: '2026-01-01 00:00:00',
        },
        lineGrossAmount: 1000,
        lineNetAmount: 900,
        grossAmount: 1000,
        discountAmount: 100,
        netAmount: 900,
        reservedAmount: 200,
        accruedAtUtc: '2026-07-20T12:10:00.000Z',
        businessDate: '2026-07-20',
      });

      expect(execution).toMatchObject({
        mode: 'shadow',
        canonicalSucceeded: false,
      });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM diagnostic_performer_reserves
        WHERE tenant_id='100' AND canonical_source_key=?
      `).get(sourceKey) as { count: number }).count)).toBe(1);
      expect(sqlite.prepare(`
        SELECT canonical_public_id,mapping_status,evidence_sha256
        FROM canonical_source_mappings
        WHERE tenant_id='100' AND entity_type='service_catalog_item'
          AND source_type='legacy_billing_service_item' AND source_public_id='46'
      `).get()).toEqual({
        canonical_public_id: 'svc-conflicting',
        mapping_status: 'mapped',
        evidence_sha256: 'e'.repeat(64),
      });
    } finally {
      sqlite.close();
    }
  });

  it('dual-writes separate unassigned canonical accruals for each reserve unit', async () => {
    const { sqlite, db } = harness();
    try {
      await seedInvoiceAndService(sqlite, db);
      for (const unitSequence of [1, 2]) {
        const sourceKey = `bill:8000:line:1:usg:44:rule:77:unit:${unitSequence}:performer-reserve`;
        await executeLivePerformerReserveAccrual(db, {
          tenantId: '100',
          legacyStatement: db.prepare(`
            INSERT INTO diagnostic_performer_reserves (
              tenant_id,canonical_source_key,reserved_amount
            ) VALUES (?,?,?)
          `).bind('100', sourceKey, 200),
          legacyReserveSourceKey: sourceKey,
          billId: 8000,
          billItemId: 1,
          invoiceNo: 'INV-D-2026-000800',
          invoiceSourceLineId: '1:usg:44',
          unitSequence,
          rule: {
            id: 77,
            billingServiceItemId: 44,
            diagnosticKind: 'radiology',
            rateType: 'flat',
            rateValue: 200,
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            isActive: true,
            createdAt: '2026-01-01 00:00:00',
            updatedAt: '2026-01-01 00:00:00',
          },
          lineGrossAmount: 1000,
          lineNetAmount: 900,
          grossAmount: 500,
          discountAmount: 50,
          netAmount: 450,
          reservedAmount: 200,
          accruedAtUtc: '2026-07-20T11:00:00.000Z',
          businessDate: '2026-07-20',
        });
      }

      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM diagnostic_performer_reserves
      `).get() as { count: number }).count)).toBe(2);
      expect(sqlite.prepare(`
        SELECT COUNT(*) count,MIN(status) min_status,MAX(status) max_status,
               SUM(gross_minor) gross_minor,SUM(discount_minor) discount_minor,
               SUM(eligible_base_minor) eligible_base_minor,SUM(earned_minor) earned_minor,
               SUM(payable_minor) payable_minor
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        count: 2,
        min_status: 'unassigned',
        max_status: 'unassigned',
        gross_minor: 100000,
        discount_minor: 10000,
        eligible_base_minor: 90000,
        earned_minor: 40000,
        payable_minor: 40000,
      });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_compensation_rules
      `).get() as { count: number }).count)).toBe(1);
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_source_mappings
        WHERE entity_type IN ('compensation_rule','compensation_accrual')
      `).get() as { count: number }).count)).toBe(3);
    } finally {
      sqlite.close();
    }
  });
});
