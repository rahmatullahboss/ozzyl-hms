import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { backfillCanonicalCompensationReportingContext } from '../../src/lib/canonical/backfill-compensation-reporting-context';

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
  sqlite.exec(`
    CREATE TABLE canonical_compensation_accruals (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      accrual_public_id TEXT NOT NULL,
      earned_minor INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'accrued'
    );
    CREATE TABLE canonical_source_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      canonical_public_id TEXT,
      source_type TEXT NOT NULL,
      source_public_id TEXT NOT NULL,
      mapping_status TEXT NOT NULL
    );
    CREATE TABLE canonical_compensation_reporting_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      accrual_public_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      incentive_type TEXT,
      legacy_bill_id INTEGER,
      legacy_invoice_item_id INTEGER,
      legacy_lab_order_item_id INTEGER,
      detail_name TEXT,
      source_reference TEXT,
      waiver_reason TEXT,
      doctor_waiver_minor INTEGER NOT NULL DEFAULT 0,
      source_evidence_sha256 TEXT NOT NULL,
      UNIQUE (tenant_id, accrual_public_id)
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      canonical_source_key TEXT,
      source_type TEXT NOT NULL,
      incentive_type TEXT,
      bill_id INTEGER,
      lab_order_item_id INTEGER,
      lab_test_id INTEGER,
      doctor_waiver_amount REAL,
      waiver_reason TEXT
    );
    CREATE TABLE diagnostic_performer_reserves (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      canonical_source_key TEXT,
      bill_id INTEGER NOT NULL,
      invoice_item_id INTEGER NOT NULL,
      test_name TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      invoice_no TEXT
    );
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      test_name TEXT
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      reference_id INTEGER,
      description TEXT,
      status TEXT
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

const HASH = 'a'.repeat(64);

describe('canonical compensation reporting context backfill', () => {
  it('recovers doctor and performer source semantics idempotently', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_compensation_accruals (id,tenant_id,accrual_public_id,earned_minor)
        VALUES
          (1,'102','acc-doctor',17500),
          (2,'102','acc-reserve',20000),
          (3,'102','acc-existing',10000);
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,mapping_status
        ) VALUES
          ('102','compensation_accrual','acc-doctor','legacy_doctor_commission_accrual',
           'bill:7001:line:1:test:44:doctor:7:rule:9:prescribing','mapped'),
          ('102','compensation_accrual','acc-doctor','legacy_doctor_commission_accrual','11','mapped'),
          ('102','compensation_accrual','acc-reserve','legacy_diagnostic_performer_reserve',
           'bill:7001:line:1:test:44:rule:77:unit:1:performer-reserve','mapped');
        INSERT INTO doctor_commission_accruals (
          id,tenant_id,canonical_source_key,source_type,incentive_type,bill_id,
          lab_order_item_id,lab_test_id,doctor_waiver_amount,waiver_reason
        ) VALUES (
          11,'102','bill:7001:line:1:test:44:doctor:7:rule:9:prescribing',
          'lab_test','prescriber',7001,9001,44,25,'patient_discount_allocation'
        );
        INSERT INTO diagnostic_performer_reserves (
          id,tenant_id,canonical_source_key,bill_id,invoice_item_id,test_name,status
        ) VALUES (
          22,'102','bill:7001:line:1:test:44:rule:77:unit:1:performer-reserve',
          7001,8001,'CBC','reserved'
        );
        INSERT INTO bills (id,tenant_id,invoice_no) VALUES (7001,'102','INV-D-7001');
        INSERT INTO lab_order_items (id,tenant_id,test_name) VALUES (9001,'102','CBC');
        INSERT INTO invoice_items (
          id,tenant_id,bill_id,reference_id,description,status
        ) VALUES (8001,'102',7001,9001,'CBC','active');
        INSERT INTO canonical_compensation_reporting_context (
          tenant_id,accrual_public_id,source_kind,doctor_waiver_minor,source_evidence_sha256
        ) VALUES ('102','acc-existing','consultation_fee',0,'${HASH}');
      `);

      await expect(backfillCanonicalCompensationReportingContext(db, {
        tenantId: '102',
        maxRows: 100,
      })).resolves.toEqual({
        doctorContextsCreated: 1,
        performerContextsCreated: 1,
        totalContextsCreated: 2,
        remainingActiveAccrualsWithoutContext: 0,
      });

      expect(sqlite.prepare(`
        SELECT accrual_public_id,source_kind,incentive_type,legacy_bill_id,
               legacy_invoice_item_id,legacy_lab_order_item_id,detail_name,
               source_reference,waiver_reason,doctor_waiver_minor
        FROM canonical_compensation_reporting_context
        WHERE tenant_id='102'
        ORDER BY accrual_public_id
      `).all()).toEqual([
        {
          accrual_public_id: 'acc-doctor',
          source_kind: 'lab_test',
          incentive_type: 'prescriber',
          legacy_bill_id: 7001,
          legacy_invoice_item_id: 8001,
          legacy_lab_order_item_id: 9001,
          detail_name: 'CBC',
          source_reference: 'INV-D-7001',
          waiver_reason: 'patient_discount_allocation',
          doctor_waiver_minor: 2500,
        },
        {
          accrual_public_id: 'acc-existing',
          source_kind: 'consultation_fee',
          incentive_type: null,
          legacy_bill_id: null,
          legacy_invoice_item_id: null,
          legacy_lab_order_item_id: null,
          detail_name: null,
          source_reference: null,
          waiver_reason: null,
          doctor_waiver_minor: 0,
        },
        {
          accrual_public_id: 'acc-reserve',
          source_kind: 'performer_reserve',
          incentive_type: 'performer',
          legacy_bill_id: 7001,
          legacy_invoice_item_id: 8001,
          legacy_lab_order_item_id: null,
          detail_name: 'CBC',
          source_reference: 'INV-D-7001',
          waiver_reason: null,
          doctor_waiver_minor: 0,
        },
      ]);

      await expect(backfillCanonicalCompensationReportingContext(db, {
        tenantId: '102',
        maxRows: 100,
      })).resolves.toEqual({
        doctorContextsCreated: 0,
        performerContextsCreated: 0,
        totalContextsCreated: 0,
        remainingActiveAccrualsWithoutContext: 0,
      });
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when legacy doctor waiver exceeds canonical earned commission', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_compensation_accruals (id,tenant_id,accrual_public_id,earned_minor)
        VALUES (1,'102','acc-bad',1000);
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,mapping_status
        ) VALUES ('102','compensation_accrual','acc-bad','legacy_doctor_commission_accrual','bad-key','mapped');
        INSERT INTO doctor_commission_accruals (
          id,tenant_id,canonical_source_key,source_type,incentive_type,bill_id,
          doctor_waiver_amount,waiver_reason
        ) VALUES (1,'102','bad-key','lab_test','prescriber',7001,20,'invalid');
        INSERT INTO bills (id,tenant_id,invoice_no) VALUES (7001,'102','INV-BAD');
      `);

      await expect(backfillCanonicalCompensationReportingContext(db, {
        tenantId: '102',
        maxRows: 100,
      })).rejects.toThrow('Legacy doctor waiver exceeds canonical earned commission');
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_compensation_reporting_context
      `).get() as { count: number }).count)).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
