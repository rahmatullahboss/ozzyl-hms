import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillCompensation,
  type CompensationBackfillDatabase,
  type CompensationBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-compensation';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CompensationBackfillPreparedStatement {
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

  async all<T = Record<string, unknown>>() {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function fixture(controls: { failBatch?: number } = {}) {
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
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));

  sqlite.exec(`
    CREATE TABLE doctor_commission_rules (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      lab_test_id INTEGER,
      category TEXT,
      incentive_type TEXT NOT NULL,
      rate_type TEXT NOT NULL,
      rate_value INTEGER NOT NULL,
      effective_from TEXT,
      effective_to TEXT,
      is_active INTEGER NOT NULL,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      patient_id INTEGER,
      visit_id INTEGER,
      bill_id INTEGER,
      lab_order_id INTEGER,
      lab_order_item_id INTEGER,
      lab_test_id INTEGER,
      settlement_id INTEGER,
      source_type TEXT NOT NULL,
      incentive_type TEXT NOT NULL,
      gross_amount INTEGER NOT NULL,
      commission_rule_id INTEGER,
      commission_rate_bps INTEGER NOT NULL,
      commission_flat_amount INTEGER NOT NULL,
      commission_amount INTEGER NOT NULL,
      earned_commission_amount REAL NOT NULL,
      doctor_waiver_amount REAL NOT NULL,
      payable_commission_amount REAL NOT NULL,
      paid_amount REAL NOT NULL,
      balance_amount REAL NOT NULL,
      waiver_reason TEXT,
      waiver_allocation_id INTEGER,
      status TEXT NOT NULL,
      accrued_date TEXT,
      paid_date TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT,
      updated_at TEXT,
      commission_base_amount REAL NOT NULL,
      performer_reserve_amount REAL NOT NULL,
      performer_reserve_id INTEGER,
      canonical_source_key TEXT
    );
    CREATE TABLE doctor_commission_settlements (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      settlement_date TEXT,
      total_amount REAL NOT NULL,
      payment_mode TEXT NOT NULL,
      reference_no TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT,
      settlement_no TEXT,
      gross_commission_amount REAL NOT NULL,
      advance_deduction REAL NOT NULL,
      other_adjustment REAL NOT NULL,
      rounding_adjustment REAL NOT NULL,
      net_paid_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      idempotency_key TEXT,
      reversed_at TEXT,
      reversal_reason TEXT
    );
    CREATE TABLE doctor_commission_settlement_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      settlement_id INTEGER NOT NULL,
      accrual_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      invoice_id INTEGER,
      bill_id INTEGER,
      patient_id INTEGER,
      service_date TEXT,
      gross_amount REAL NOT NULL,
      commission_amount REAL NOT NULL,
      created_at TEXT
    );
    CREATE TABLE diagnostic_performer_payout_rules (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      billing_service_item_id INTEGER NOT NULL,
      diagnostic_kind TEXT NOT NULL,
      rate_type TEXT NOT NULL,
      rate_value REAL NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      is_active INTEGER NOT NULL,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE diagnostic_performer_reserves (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      rule_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      invoice_item_id INTEGER NOT NULL,
      patient_id INTEGER,
      visit_id INTEGER,
      billing_service_item_id INTEGER NOT NULL,
      diagnostic_kind TEXT NOT NULL,
      lab_test_id INTEGER,
      radiology_imaging_item_id INTEGER,
      test_code TEXT,
      test_name TEXT NOT NULL,
      unit_sequence INTEGER NOT NULL,
      unit_service_amount REAL NOT NULL,
      unit_discount_amount REAL NOT NULL,
      net_unit_service_amount REAL NOT NULL,
      rule_rate_type TEXT NOT NULL,
      rule_rate_value REAL NOT NULL,
      reserved_amount REAL NOT NULL,
      status TEXT NOT NULL,
      assigned_doctor_id INTEGER,
      commission_accrual_id INTEGER,
      settlement_id INTEGER,
      reserved_at TEXT NOT NULL,
      paid_at TEXT,
      cancelled_at TEXT,
      reversed_at TEXT,
      cancel_reason TEXT,
      created_by INTEGER,
      updated_at TEXT,
      canonical_source_key TEXT
    );
  `);

  let batchNumber = 0;
  const db: CompensationBackfillDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      batchNumber += 1;
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        if (controls.failBatch === batchNumber) throw new Error('synthetic compensation batch failure');
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

function seedCanonicalAuthority(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES
      ('1','prac-performer','internal','Synthetic Performer','active'),
      ('1','prac-referrer','external','Synthetic Referrer','active');
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('1','svc-100','laboratory','Synthetic Test','service','active','${'1'.repeat(64)}');
    INSERT INTO canonical_service_events (
      tenant_id,event_public_id,service_public_id,event_type,quantity,status,
      occurred_at_utc,source_evidence_sha256
    ) VALUES ('1','evt-1000','svc-100','completed',1,'posted','2026-07-01T03:00:00.000Z','${'2'.repeat(64)}');
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('1','inv-500','INV-500',50,'BDT',10000,0,10000,0,10000,0,10000,1,
              'posted','2026-07-01T03:00:00.000Z','2026-07-01T03:00:00.000Z','${'3'.repeat(64)}');
    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES ('1','line-1000','inv-500','service','evt-1000',1,10000,10000,'${'4'.repeat(64)}');
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('1','practitioner','prac-performer','legacy_doctor','10','doctors','mapped',1,'${'5'.repeat(64)}'),
      ('1','practitioner','prac-referrer','legacy_doctor','20','doctors','mapped',1,'${'6'.repeat(64)}'),
      ('1','service_catalog_item','svc-100','legacy_billing_service_item','100','billing_service_items','mapped',1,'${'7'.repeat(64)}'),
      ('1','invoice','inv-500','legacy_bill','500','bills','mapped',1,'${'8'.repeat(64)}'),
      ('1','invoice_line','line-1000','legacy_invoice_item','1000','invoice_items','mapped',1,'${'9'.repeat(64)}');
  `);
}

function seedValidLegacy(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO diagnostic_performer_payout_rules VALUES
      (200,'1',100,'lab','flat',20,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
    INSERT INTO diagnostic_performer_reserves VALUES
      (300,'1',200,500,1000,50,60,100,'lab',NULL,NULL,'T-1','Synthetic Test',1,
       100,10,90,'flat',20,20,'reserved',10,NULL,NULL,'2026-07-01 09:00:00',
       NULL,NULL,NULL,NULL,1,'2026-07-01 09:00:00',NULL);

    INSERT INTO doctor_commission_rules VALUES
      (400,'1',20,'referral',NULL,NULL,'referrer','percent',1000,'2026-01-01',NULL,1,
       NULL,1,'2026-01-01 09:00:00',NULL);
    INSERT INTO doctor_commission_accruals VALUES
      (500,'1',20,50,60,500,NULL,NULL,NULL,600,'referral','referrer',100,400,1000,0,
       8,8,0,8,8,0,NULL,NULL,'paid','2026-07-01','2026-07-02',NULL,1,
       '2026-07-01 09:00:00',NULL,80,20,300,NULL);
    INSERT INTO doctor_commission_settlements VALUES
      (600,'1',20,'2026-07-02',8,'cash','REF-600',NULL,1,'2026-07-02 09:00:00',
       'SET-600',8,0,0,0,8,'cash','legacy-settlement-600',NULL,NULL);
    INSERT INTO doctor_commission_settlement_items VALUES
      (700,'1',600,500,20,'referral',NULL,500,50,'2026-07-01',100,8,
       '2026-07-02 09:00:00');
  `);
}

const options = {
  tenantId: '1',
  runPublicId: 'compensation-run-1',
  currencyCode: 'BDT',
  nowUtc: '2026-07-14T03:00:00.000Z',
};

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}${where}`).get() as { count: number }).count);
}

describe('canonical compensation backfill', () => {
  it('maps exact legacy reserve, commission, rules, settlement, and allocation authority', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    seedValidLegacy(sqlite);
    try {
      const first = await backfillCompensation(db, options);
      expect(first).toMatchObject({
        completed: true,
        counts: {
          scanned: 5,
          rulesCreated: 2,
          accrualsCreated: 2,
          settlementsCreated: 1,
          settlementAllocationsCreated: 1,
          issuesCreated: 0,
        },
      });
      expect(sqlite.prepare(`
        SELECT practitioner_role,accrual_stage,earned_minor,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals ORDER BY accrual_stage DESC
      `).all()).toEqual([
        {
          practitioner_role: 'performing',
          accrual_stage: 'performer_reserve',
          earned_minor: 2000,
          settled_minor: 0,
          payable_minor: 2000,
          status: 'accrued',
        },
        {
          practitioner_role: 'referring',
          accrual_stage: 'commission',
          earned_minor: 800,
          settled_minor: 800,
          payable_minor: 0,
          status: 'settled',
        },
      ]);
      expect(count(sqlite, 'canonical_compensation_rules')).toBe(2);
      expect(count(sqlite, 'canonical_compensation_settlements')).toBe(1);
      expect(count(sqlite, 'canonical_compensation_settlement_allocations')).toBe(1);
      expect(sqlite.prepare(`
        SELECT source_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE entity_type='compensation_settlement'
      `).get()).toEqual({
        source_public_id: 'legacy-settlement-600',
        mapping_status: 'mapped',
      });
      expect(sqlite.prepare(`
        SELECT source_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE entity_type='compensation_settlement_allocation'
      `).get()).toEqual({
        source_public_id: 'legacy-settlement-600:legacy_doctor_commission_accrual:500',
        mapping_status: 'mapped',
      });
      const second = await backfillCompensation(db, options);
      expect(second.counts).toMatchObject({ scanned: 0, rulesCreated: 0, accrualsCreated: 0, settlementsCreated: 0, mappingsCreated: 0, issuesCreated: 0 });
      const third = await backfillCompensation(db, { ...options, runPublicId: 'compensation-run-2' });
      expect(third.counts).toMatchObject({
        rulesCreated: 0,
        accrualsCreated: 0,
        adjustmentsCreated: 0,
        settlementsCreated: 0,
        settlementAllocationsCreated: 0,
        mappingsCreated: 0,
        issuesCreated: 0,
      });
    } finally { sqlite.close(); }
  });

  it('imports legacy payout deductions as canonical adjustments plus net allocations', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    seedValidLegacy(sqlite);
    sqlite.exec(`
      UPDATE doctor_commission_settlements
      SET total_amount=6,
          gross_commission_amount=8,
          advance_deduction=2,
          net_paid_amount=6
      WHERE id=600;
    `);
    try {
      const result = await backfillCompensation(db, options);
      expect(result.counts).toMatchObject({
        adjustmentsCreated: 1,
        settlementsCreated: 1,
        settlementAllocationsCreated: 1,
        issuesCreated: 0,
      });
      expect(sqlite.prepare(`
        SELECT total_minor,allocated_minor,net_paid_minor,status
        FROM canonical_compensation_settlements
      `).get()).toEqual({
        total_minor: 600,
        allocated_minor: 600,
        net_paid_minor: 600,
        status: 'posted',
      });
      expect(sqlite.prepare(`
        SELECT adjustment_type,reason_code,amount_minor,
               accrual_adjusted_before_minor,accrual_adjusted_after_minor,
               accrual_payable_before_minor,accrual_payable_after_minor
        FROM canonical_compensation_adjustments
      `).get()).toEqual({
        adjustment_type: 'manual_recovery',
        reason_code: 'settlement_deduction',
        amount_minor: 200,
        accrual_adjusted_before_minor: 0,
        accrual_adjusted_after_minor: 200,
        accrual_payable_before_minor: 800,
        accrual_payable_after_minor: 600,
      });
      expect(sqlite.prepare(`
        SELECT adjusted_minor,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals
        WHERE practitioner_role='referring'
      `).get()).toEqual({
        adjusted_minor: 200,
        settled_minor: 600,
        payable_minor: 0,
        status: 'settled',
      });
      expect(sqlite.prepare(`
        SELECT amount_minor,accrual_payable_before_minor,accrual_payable_after_minor
        FROM canonical_compensation_settlement_allocations
      `).get()).toEqual({
        amount_minor: 600,
        accrual_payable_before_minor: 600,
        accrual_payable_after_minor: 0,
      });
      expect(sqlite.prepare(`
        SELECT source_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE entity_type='compensation_adjustment'
      `).get()).toEqual({
        source_public_id: 'legacy-settlement-600:deduction:legacy_doctor_commission_accrual:500',
        mapping_status: 'mapped',
      });
    } finally { sqlite.close(); }
  });

  it('classifies duplicate settlement items that resolve to one canonical accrual', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    seedValidLegacy(sqlite);
    sqlite.exec(`
      UPDATE doctor_commission_settlements
      SET total_amount=16,gross_commission_amount=16,net_paid_amount=16
      WHERE id=600;
      INSERT INTO doctor_commission_settlement_items VALUES
        (701,'1',600,500,20,'referral',NULL,500,50,'2026-07-01',100,8,
         '2026-07-02 09:00:01');
    `);
    try {
      const result = await backfillCompensation(db, options);
      expect(result.counts.issuesCreated).toBe(1);
      expect(count(sqlite, 'canonical_compensation_settlements')).toBe(0);
      expect(count(sqlite, 'canonical_compensation_settlement_allocations')).toBe(0);
      expect(sqlite.prepare(`
        SELECT issue_code,status
        FROM canonical_processing_issues
        WHERE source_type='legacy_doctor_commission_settlement'
          AND source_public_id='legacy-settlement-600'
      `).get()).toEqual({
        issue_code: 'COMPENSATION_SETTLEMENT_DUPLICATE_ACCRUAL',
        status: 'open',
      });
    } finally { sqlite.close(); }
  });

  it('uses remaining-after-performer basis for prescribing diagnostic rules', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO doctor_commission_rules VALUES
        (410,'1',20,'lab_test',NULL,NULL,'prescriber','percent',2500,'2026-01-01',NULL,1,
         NULL,1,'2026-01-01 09:00:00',NULL);
    `);
    try {
      await backfillCompensation(db, options);
      expect(sqlite.prepare(`
        SELECT practitioner_role,calculation_basis
        FROM canonical_compensation_rules
        WHERE practitioner_role='prescribing'
      `).get()).toEqual({
        practitioner_role: 'prescribing',
        calculation_basis: 'remaining_after_performer',
      });
    } finally { sqlite.close(); }
  });

  it('reuses a stable canonical source key for live accrual backfill identity', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    const sourceKey = 'bill:500:line:1:test:1000:doctor:20:rule:400:referring';
    sqlite.exec(`
      INSERT INTO doctor_commission_rules VALUES
        (400,'1',20,'referral',NULL,NULL,'referrer','percent',1000,'2026-01-01',NULL,1,
         NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO doctor_commission_accruals VALUES
        (500,'1',20,50,60,500,NULL,NULL,NULL,NULL,'referral','referrer',100,400,1000,0,
         8,8,0,8,0,8,NULL,NULL,'accrued','2026-07-01',NULL,NULL,1,
         '2026-07-01 09:00:00',NULL,80,20,NULL,'${sourceKey}');
    `);
    try {
      await backfillCompensation(db, options);
      expect(sqlite.prepare(`
        SELECT source_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE entity_type='compensation_accrual'
      `).get()).toEqual({
        source_public_id: sourceKey,
        mapping_status: 'mapped',
      });
      expect(count(sqlite, 'canonical_compensation_accruals')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('imports compensation from a posted invoice line without a service event', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      DELETE FROM canonical_source_mappings
      WHERE entity_type='invoice_line' AND source_public_id='1000';
      DELETE FROM canonical_invoice_lines WHERE line_public_id='line-1000';
      INSERT INTO canonical_invoice_lines (
        tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
        adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
      ) VALUES ('1','line-1000','inv-500','other_adjustment',NULL,'LEGACY_TEST',1,10000,10000,'${'9'.repeat(64)}');
      INSERT INTO doctor_commission_rules VALUES
        (400,'1',20,'referral',NULL,NULL,'referrer','percent',1000,'2026-01-01',NULL,1,
         NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO doctor_commission_accruals VALUES
        (500,'1',20,50,60,500,NULL,NULL,NULL,NULL,'referral','referrer',100,400,1000,0,
         8,8,0,8,0,8,NULL,NULL,'accrued','2026-07-01',NULL,NULL,1,
         '2026-07-01 09:00:00',NULL,80,20,NULL,NULL);
    `);
    try {
      const result = await backfillCompensation(db, options);
      expect(result.counts.accrualsCreated).toBe(1);
      expect(sqlite.prepare(`
        SELECT service_event_public_id,status
        FROM canonical_compensation_accruals
      `).get()).toEqual({ service_event_public_id: null, status: 'accrued' });
    } finally { sqlite.close(); }
  });

  it('aliases a payout-created performer accrual to the existing canonical reserve identity', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO diagnostic_performer_payout_rules VALUES
        (200,'1',100,'lab','flat',20,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO diagnostic_performer_reserves VALUES
        (300,'1',200,500,1000,50,60,100,'lab',NULL,NULL,'T-1','Synthetic Test',1,
         100,10,90,'flat',20,20,'reserved',10,NULL,NULL,'2026-07-01 09:00:00',
         NULL,NULL,NULL,NULL,1,'2026-07-01 09:00:00','reserve-key-300');
    `);
    try {
      await backfillCompensation(db, { ...options, runPublicId: 'performer-alias-run-1' });
      const reserveAccrualId = (sqlite.prepare(`
        SELECT canonical_public_id
        FROM canonical_source_mappings
        WHERE entity_type='compensation_accrual'
          AND source_type='legacy_diagnostic_performer_reserve'
          AND source_public_id='reserve-key-300'
      `).get() as { canonical_public_id: string }).canonical_public_id;

      sqlite.exec(`
        UPDATE diagnostic_performer_reserves
        SET status='paid',commission_accrual_id=500,settlement_id=600,paid_at='2026-07-02 09:00:00'
        WHERE id=300;
        INSERT INTO doctor_commission_accruals VALUES
          (500,'1',10,50,60,500,NULL,NULL,NULL,600,'lab_test','performer',90,NULL,0,20,
           20,20,0,20,20,0,NULL,NULL,'paid','2026-07-02','2026-07-02',NULL,1,
           '2026-07-02 09:00:00',NULL,90,20,300,'performer-reserve-payout:reserve-key-300');
        INSERT INTO doctor_commission_settlements VALUES
          (600,'1',10,'2026-07-02',20,'cash','REF-600',NULL,1,'2026-07-02 09:00:00',
           'SET-600',20,0,0,0,20,'cash','legacy-settlement-600',NULL,NULL);
        INSERT INTO doctor_commission_settlement_items VALUES
          (700,'1',600,500,10,'lab_test',NULL,500,50,'2026-07-02',90,20,
           '2026-07-02 09:00:00');
      `);

      const result = await backfillCompensation(db, { ...options, runPublicId: 'performer-alias-run-2' });
      expect(result.counts.issuesCreated).toBe(0);
      expect(count(sqlite, 'canonical_compensation_accruals')).toBe(1);
      expect(sqlite.prepare(`
        SELECT canonical_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE entity_type='compensation_accrual'
          AND source_type='legacy_doctor_commission_accrual'
          AND source_public_id='performer-reserve-payout:reserve-key-300'
      `).get()).toEqual({ canonical_public_id: reserveAccrualId, mapping_status: 'mapped' });
      expect(sqlite.prepare(`
        SELECT source_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE entity_type='compensation_settlement_allocation'
      `).get()).toEqual({
        source_public_id: 'legacy-settlement-600:legacy_diagnostic_performer_reserve:reserve-key-300',
        mapping_status: 'mapped',
      });
      expect(sqlite.prepare(`
        SELECT practitioner_public_id,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals
        WHERE accrual_public_id=?
      `).get(reserveAccrualId)).toEqual({
        practitioner_public_id: 'prac-performer',
        settled_minor: 2000,
        payable_minor: 0,
        status: 'settled',
      });
    } finally { sqlite.close(); }
  });

  it('imports a historical paid performer reserve and linked payout in one pass', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO diagnostic_performer_payout_rules VALUES
        (200,'1',100,'lab','flat',20,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO diagnostic_performer_reserves VALUES
        (300,'1',200,500,1000,50,60,100,'lab',NULL,NULL,'T-1','Synthetic Test',1,
         100,10,90,'flat',20,20,'paid',10,500,600,'2026-07-01 09:00:00',
         '2026-07-02 09:00:00',NULL,NULL,NULL,1,'2026-07-02 09:00:00','reserve-key-300');
      INSERT INTO doctor_commission_accruals VALUES
        (500,'1',10,50,60,500,NULL,NULL,NULL,600,'lab_test','performer',90,NULL,0,20,
         20,20,0,20,20,0,NULL,NULL,'paid','2026-07-02','2026-07-02',NULL,1,
         '2026-07-02 09:00:00',NULL,90,20,300,'performer-reserve-payout:reserve-key-300');
      INSERT INTO doctor_commission_settlements VALUES
        (600,'1',10,'2026-07-02',20,'cash','REF-600',NULL,1,'2026-07-02 09:00:00',
         'SET-600',20,0,0,0,20,'cash','legacy-settlement-600',NULL,NULL);
      INSERT INTO doctor_commission_settlement_items VALUES
        (700,'1',600,500,10,'lab_test',NULL,500,50,'2026-07-02',90,20,
         '2026-07-02 09:00:00');
    `);
    try {
      const result = await backfillCompensation(db, { ...options, runPublicId: 'historical-performer-run' });
      expect(result.counts.issuesCreated).toBe(0);
      expect(count(sqlite, 'canonical_compensation_accruals')).toBe(1);
      expect(count(sqlite, 'canonical_compensation_settlements')).toBe(1);
      expect(count(sqlite, 'canonical_compensation_settlement_allocations')).toBe(1);
      expect(sqlite.prepare(`
        SELECT practitioner_public_id,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        practitioner_public_id: 'prac-performer',
        settled_minor: 2000,
        payable_minor: 0,
        status: 'settled',
      });
    } finally { sqlite.close(); }
  });

  it('does not import paid compensation as payable when the linked settlement is reversed', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO diagnostic_performer_payout_rules VALUES
        (200,'1',100,'lab','flat',20,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO diagnostic_performer_reserves VALUES
        (300,'1',200,500,1000,50,60,100,'lab',NULL,NULL,'T-1','Synthetic Test',1,
         100,10,90,'flat',20,20,'paid',10,500,600,'2026-07-01 09:00:00',
         '2026-07-02 09:00:00',NULL,NULL,NULL,1,'2026-07-02 09:00:00','reserve-key-300');
      INSERT INTO doctor_commission_accruals VALUES
        (500,'1',10,50,60,500,NULL,NULL,NULL,600,'lab_test','performer',90,NULL,0,20,
         20,20,0,20,20,0,NULL,NULL,'paid','2026-07-02','2026-07-02',NULL,1,
         '2026-07-02 09:00:00',NULL,90,20,300,'performer-reserve-payout:reserve-key-300');
      INSERT INTO doctor_commission_settlements VALUES
        (600,'1',10,'2026-07-02',20,'cash','REF-600',NULL,1,'2026-07-02 09:00:00',
         'SET-600',20,0,0,0,20,'cash','legacy-settlement-600','2026-07-03 09:00:00','cancelled');
      INSERT INTO doctor_commission_settlement_items VALUES
        (700,'1',600,500,10,'lab_test',NULL,500,50,'2026-07-02',90,20,
         '2026-07-02 09:00:00');
    `);
    try {
      const result = await backfillCompensation(db, { ...options, runPublicId: 'reversed-performer-run' });
      expect(result.counts.issuesCreated).toBe(3);
      expect(count(sqlite, 'canonical_compensation_accruals')).toBe(0);
      expect(count(sqlite, 'canonical_compensation_settlements')).toBe(0);
      expect(sqlite.prepare(`
        SELECT issue_code,COUNT(*) issue_count
        FROM canonical_processing_issues
        GROUP BY issue_code
        ORDER BY issue_code
      `).all()).toEqual([
        { issue_code: 'COMPENSATION_PAID_SETTLEMENT_UNRESOLVED', issue_count: 2 },
        { issue_code: 'COMPENSATION_SETTLEMENT_REVERSAL_UNRESOLVED', issue_count: 1 },
      ]);
    } finally { sqlite.close(); }
  });

  it('keeps unresolved doctor, invoice line, and paid settlement evidence ambiguous', async () => {
    const { sqlite, db } = fixture();
    sqlite.exec(`
      INSERT INTO diagnostic_performer_payout_rules VALUES
        (200,'1',100,'lab','flat',20,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO diagnostic_performer_reserves VALUES
        (300,'1',200,500,1000,50,60,100,'lab',NULL,NULL,'T-1','Synthetic Test',1,
         100,10,90,'flat',20,20,'paid',10,NULL,NULL,'2026-07-01 09:00:00',
         '2026-07-02 09:00:00',NULL,NULL,NULL,1,'2026-07-02 09:00:00',NULL);
      INSERT INTO doctor_commission_rules VALUES
        (400,'1',20,'referral',NULL,NULL,'referrer','percent',1000,'2026-01-01',NULL,1,
         NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO doctor_commission_accruals VALUES
        (500,'1',20,50,60,500,NULL,NULL,NULL,NULL,'referral','referrer',100,400,1000,0,
         8,8,0,8,8,0,NULL,NULL,'paid','2026-07-01','2026-07-02',NULL,1,
         '2026-07-01 09:00:00',NULL,80,20,300,NULL);
    `);
    try {
      const result = await backfillCompensation(db, options);
      expect(result.counts).toMatchObject({ scanned: 4, rulesCreated: 0, accrualsCreated: 0, settlementsCreated: 0 });
      expect(sqlite.prepare(`
        SELECT issue_code FROM canonical_processing_issues
        WHERE issue_type='compensation_backfill' ORDER BY issue_code
      `).all()).toEqual([
        { issue_code: 'COMPENSATION_INVOICE_LINE_UNRESOLVED' },
        { issue_code: 'COMPENSATION_PAID_SETTLEMENT_UNRESOLVED' },
        { issue_code: 'COMPENSATION_PRACTITIONER_UNRESOLVED' },
        { issue_code: 'COMPENSATION_SERVICE_UNRESOLVED' },
      ]);
      expect(count(sqlite, 'canonical_source_mappings', ` WHERE entity_type IN ('compensation_rule','compensation_accrual','compensation_settlement','compensation_settlement_allocation') AND mapping_status='ambiguous'`)).toBe(4);
    } finally { sqlite.close(); }
  });

  it('records unassigned performer reserve rather than inferring the referrer', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO diagnostic_performer_payout_rules VALUES
        (200,'1',100,'lab','flat',20,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO diagnostic_performer_reserves VALUES
        (300,'1',200,500,1000,50,60,100,'lab',NULL,NULL,'T-1','Synthetic Test',1,
         100,10,90,'flat',20,20,'reserved',NULL,NULL,NULL,'2026-07-01 09:00:00',
         NULL,NULL,NULL,NULL,1,'2026-07-01 09:00:00',NULL);
    `);
    try {
      await backfillCompensation(db, options);
      expect(sqlite.prepare(`
        SELECT practitioner_public_id,practitioner_role,status
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        practitioner_public_id: null,
        practitioner_role: 'performing',
        status: 'unassigned',
      });
    } finally { sqlite.close(); }
  });

  it('uses one exact applicable legacy rule when an accrual omitted its rule id', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO doctor_commission_rules VALUES
        (400,'1',20,'referral',NULL,NULL,'referrer','percent',1000,'2026-01-01',NULL,1,
         NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO doctor_commission_accruals VALUES
        (500,'1',20,50,60,500,NULL,NULL,NULL,NULL,'referral','referrer',100,NULL,1000,0,
         8,8,0,8,0,8,NULL,NULL,'accrued','2026-07-01',NULL,NULL,1,
         '2026-07-01 09:00:00',NULL,80,20,NULL,NULL);
    `);
    try {
      const result = await backfillCompensation(db, options);
      expect(result.counts.accrualsCreated).toBe(1);
      expect(sqlite.prepare(`
        SELECT mapping_status FROM canonical_source_mappings
        WHERE entity_type='compensation_accrual' AND source_public_id='500'
      `).get()).toEqual({ mapping_status: 'mapped' });
      expect(count(sqlite, 'canonical_processing_issues', ` WHERE issue_type='compensation_backfill' AND status='open'`)).toBe(0);
    } finally { sqlite.close(); }
  });

  it('keeps a missing rule unresolved when more than one exact legacy rule applies', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO doctor_commission_rules VALUES
        (400,'1',20,'referral',NULL,NULL,'referrer','percent',1000,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL),
        (401,'1',20,'referral',NULL,NULL,'referrer','percent',900,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO doctor_commission_accruals VALUES
        (500,'1',20,50,60,500,NULL,NULL,NULL,NULL,'referral','referrer',100,NULL,1000,0,
         8,8,0,8,0,8,NULL,NULL,'accrued','2026-07-01',NULL,NULL,1,
         '2026-07-01 09:00:00',NULL,80,20,NULL,NULL);
    `);
    try {
      await backfillCompensation(db, options);
      expect(sqlite.prepare(`
        SELECT issue_code,status FROM canonical_processing_issues
        WHERE source_type='legacy_doctor_commission_accrual' AND source_public_id='500'
      `).get()).toEqual({ issue_code: 'COMPENSATION_RULE_UNRESOLVED', status: 'open' });
    } finally { sqlite.close(); }
  });

  it('classifies a multi-line legacy category accrual as a waived non-importable aggregate', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO canonical_service_catalog_items (
        tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
      ) VALUES ('1','svc-101','laboratory','Synthetic Test 2','service','active','${'a'.repeat(64)}');
      INSERT INTO canonical_service_events (
        tenant_id,event_public_id,service_public_id,event_type,quantity,status,occurred_at_utc,source_evidence_sha256
      ) VALUES ('1','evt-1001','svc-101','completed',1,'posted','2026-07-01T03:00:00.000Z','${'b'.repeat(64)}');
      INSERT INTO canonical_invoice_lines (
        tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
      ) VALUES ('1','line-1001','inv-500','service','evt-1001',1,5000,5000,'${'c'.repeat(64)}');
      UPDATE canonical_invoices SET subtotal_minor=15000,total_minor=15000,due_minor=15000,net_due_minor=15000 WHERE invoice_public_id='inv-500';
      INSERT INTO doctor_commission_rules VALUES
        (400,'1',20,'referral',NULL,'test','referrer','percent',1000,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO doctor_commission_accruals VALUES
        (500,'1',20,50,60,500,NULL,NULL,NULL,NULL,'referral','referrer',150,400,1000,0,
         12,12,0,12,0,12,NULL,NULL,'accrued','2026-07-01',NULL,NULL,1,
         '2026-07-01 09:00:00',NULL,120,30,NULL,NULL);
    `);
    try {
      await backfillCompensation(db, options);
      expect(sqlite.prepare(`
        SELECT mapping_status FROM canonical_source_mappings
        WHERE entity_type='compensation_accrual' AND source_public_id='500'
      `).get()).toEqual({ mapping_status: 'rejected' });
      expect(sqlite.prepare(`
        SELECT issue_code,severity,status,resolution_code FROM canonical_processing_issues
        WHERE source_type='legacy_doctor_commission_accrual' AND source_public_id='500'
      `).get()).toEqual({
        issue_code: 'COMPENSATION_AGGREGATE_ACCRUAL_NOT_LINE_IMPORTABLE',
        severity: 'warning',
        status: 'waived',
        resolution_code: 'DETERMINISTIC_NONIMPORTABLE_LEGACY_AGGREGATE',
      });
    } finally { sqlite.close(); }
  });

  it('classifies an exact-line financial snapshot conflict without changing either authority', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO doctor_commission_rules VALUES
        (400,'1',20,'referral',NULL,NULL,'referrer','percent',1000,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO doctor_commission_accruals VALUES
        (500,'1',20,50,60,500,NULL,NULL,NULL,NULL,'referral','referrer',120,400,1000,0,
         8,8,0,8,0,8,NULL,NULL,'accrued','2026-07-01',NULL,NULL,1,
         '2026-07-01 09:00:00',NULL,80,20,NULL,NULL);
    `);
    try {
      await backfillCompensation(db, options);
      expect(sqlite.prepare(`
        SELECT mapping_status FROM canonical_source_mappings
        WHERE entity_type='compensation_accrual' AND source_public_id='500'
      `).get()).toEqual({ mapping_status: 'rejected' });
      expect(sqlite.prepare(`
        SELECT issue_code,status,resolution_code FROM canonical_processing_issues
        WHERE source_type='legacy_doctor_commission_accrual' AND source_public_id='500'
      `).get()).toEqual({
        issue_code: 'COMPENSATION_SNAPSHOT_CONFLICT_NOT_IMPORTABLE',
        status: 'waived',
        resolution_code: 'DETERMINISTIC_NONIMPORTABLE_SNAPSHOT_CONFLICT',
      });
    } finally { sqlite.close(); }
  });

  it('classifies a settlement containing a rejected accrual as non-importable', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO doctor_commission_rules VALUES
        (400,'1',20,'referral',NULL,NULL,'referrer','percent',1000,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
      INSERT INTO doctor_commission_accruals VALUES
        (500,'1',20,50,60,500,NULL,NULL,NULL,600,'referral','referrer',120,400,1000,0,
         8,8,0,8,8,0,NULL,NULL,'paid','2026-07-01','2026-07-02',NULL,1,
         '2026-07-01 09:00:00',NULL,80,20,NULL,NULL);
      INSERT INTO doctor_commission_settlements VALUES
        (600,'1',20,'2026-07-02',8,'cash','REF-600',NULL,1,'2026-07-02 09:00:00',
         'SET-600',8,0,0,0,8,'cash','legacy-settlement-600',NULL,NULL);
      INSERT INTO doctor_commission_settlement_items VALUES
        (700,'1',600,500,20,'referral',NULL,500,50,'2026-07-01',120,8,'2026-07-02 09:00:00');
    `);
    try {
      await backfillCompensation(db, options);
      expect(sqlite.prepare(`
        SELECT mapping_status FROM canonical_source_mappings
        WHERE entity_type='compensation_settlement' AND source_public_id='legacy-settlement-600'
      `).get()).toEqual({ mapping_status: 'rejected' });
      expect(sqlite.prepare(`
        SELECT issue_code,status,resolution_code FROM canonical_processing_issues
        WHERE source_type='legacy_doctor_commission_settlement' AND source_public_id='legacy-settlement-600'
      `).get()).toEqual({
        issue_code: 'COMPENSATION_SETTLEMENT_CONTAINS_NONIMPORTABLE_ACCRUAL',
        status: 'waived',
        resolution_code: 'DETERMINISTIC_NONIMPORTABLE_SETTLEMENT',
      });
    } finally { sqlite.close(); }
  });

  it('stops at a checkpoint limit and resumes without duplicate authority', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    seedValidLegacy(sqlite);
    try {
      const first = await backfillCompensation(db, { ...options, maxSourceRecords: 2 });
      expect(first.completed).toBe(false);
      expect(first.counts.scanned).toBe(2);
      const second = await backfillCompensation(db, { ...options, maxSourceRecords: 10 });
      expect(second.completed).toBe(true);
      expect(second.counts.scanned).toBe(3);
      expect(count(sqlite, 'canonical_compensation_rules')).toBe(2);
      expect(count(sqlite, 'canonical_compensation_accruals')).toBe(2);
      expect(count(sqlite, 'canonical_compensation_settlements')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('rolls back a failed source batch and retains the prior checkpoint', async () => {
    const { sqlite, db } = fixture({ failBatch: 1 });
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO diagnostic_performer_payout_rules VALUES
        (200,'1',100,'lab','flat',20,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
    `);
    try {
      await expect(backfillCompensation(db, options)).rejects.toThrow(/synthetic compensation batch failure/);
      expect(count(sqlite, 'canonical_compensation_rules')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings', ` WHERE entity_type='compensation_rule'`)).toBe(0);
    } finally { sqlite.close(); }
  });

  it('reuses an exact historical commission-accrual evidence hash', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    seedValidLegacy(sqlite);
    try {
      await backfillCompensation(db, options);
      sqlite.prepare(`
        UPDATE canonical_source_mappings
        SET evidence_sha256=?
        WHERE tenant_id='1' AND entity_type='compensation_accrual'
          AND source_type='legacy_doctor_commission_accrual' AND source_public_id='500'
      `).run('00a5f226d3610772517c236418c37e9a844a588a51c01d7d1fda8010ae877faf');

      await expect(backfillCompensation(db, {
        ...options,
        runPublicId: 'compensation-run-historical-evidence',
      })).resolves.toMatchObject({ completed: true });
    } finally { sqlite.close(); }
  });

  it('rejects source-evidence drift and failed terminal run reuse', async () => {
    const { sqlite, db } = fixture();
    seedCanonicalAuthority(sqlite);
    sqlite.exec(`
      INSERT INTO diagnostic_performer_payout_rules VALUES
        (200,'1',100,'lab','flat',20,'2026-01-01',NULL,1,NULL,1,'2026-01-01 09:00:00',NULL);
    `);
    try {
      await backfillCompensation(db, options);
      sqlite.prepare(`UPDATE diagnostic_performer_payout_rules SET rate_value=25 WHERE id=200`).run();
      await expect(backfillCompensation(db, { ...options, runPublicId: 'compensation-run-2' })).rejects.toThrow(/evidence drift/i);

      sqlite.prepare(`
        INSERT INTO canonical_migration_runs (
          tenant_id,run_public_id,migration_name,migration_kind,status,
          started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
        ) VALUES ('1','compensation-run-failed','0513_canonical_practitioner_compensation.sql',
                  'backfill','failed',?,?,?,?)
      `).run(options.nowUtc, options.nowUtc, options.nowUtc, options.nowUtc);
      await expect(backfillCompensation(db, { ...options, runPublicId: 'compensation-run-failed' }))
        .rejects.toThrow(/terminal: failed/i);
    } finally { sqlite.close(); }
  });
});
