import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { issueInvoice } from '../../src/lib/canonical/commands/issue-invoice';
import { buildLiveInvoiceProjection } from '../../src/lib/canonical/live-financial-projection';
import { executeLiveDoctorCommissionAccrual } from '../../src/lib/canonical/live-doctor-compensation';
import { resolveLegacyLiveInvoiceLineAuthority } from '../../src/lib/canonical/legacy-live-invoice-line-authority';
import { accrueBillCommissions } from '../../src/lib/lab-finance';

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
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      specialty TEXT,
      department TEXT,
      bmdc_reg_no TEXT,
      is_active INTEGER,
      user_id INTEGER,
      canonical_source_key TEXT
    );
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
    CREATE TABLE doctor_commission_rules (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      incentive_type TEXT NOT NULL,
      lab_test_id INTEGER,
      category TEXT,
      rate_type TEXT NOT NULL,
      rate_value REAL NOT NULL,
      effective_from TEXT,
      effective_to TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      canonical_source_key TEXT
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      patient_id INTEGER,
      visit_id INTEGER,
      bill_id INTEGER,
      lab_test_id INTEGER,
      canonical_source_key TEXT,
      source_type TEXT NOT NULL,
      incentive_type TEXT NOT NULL,
      gross_amount REAL NOT NULL DEFAULT 0,
      commission_base_amount REAL NOT NULL DEFAULT 0,
      performer_reserve_amount REAL NOT NULL DEFAULT 0,
      commission_rule_id INTEGER,
      commission_rate_bps REAL NOT NULL DEFAULT 0,
      commission_flat_amount REAL NOT NULL DEFAULT 0,
      commission_amount REAL NOT NULL DEFAULT 0,
      earned_commission_amount REAL NOT NULL DEFAULT 0,
      doctor_waiver_amount REAL NOT NULL DEFAULT 0,
      payable_commission_amount REAL NOT NULL DEFAULT 0,
      balance_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      accrued_date TEXT NOT NULL,
      created_by INTEGER,
      notes TEXT
    );
    CREATE UNIQUE INDEX uq_doctor_commission_accrual_canonical_source_key
      ON doctor_commission_accruals(tenant_id, canonical_source_key)
      WHERE canonical_source_key IS NOT NULL;
    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT,
      UNIQUE(tenant_id, source_event_key)
    );
  `);
  sqlite.exec(readFileSync('migrations/0539_doctor_protected_commission_floor.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0570_doctor_commission_rule_version_snapshot.sql', 'utf8'));

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

describe('live doctor compensation canonical projection', () => {
  it('recovers a missing legacy bill invoice through the shared line-authority resolver', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO bills (
          id,tenant_id,patient_id,invoice_no,total,paid,due,discount,tax_total,status,created_at
        ) VALUES (15034,102,2283,'INV-A-2026-0015034',400,400,0,100,0,'paid','2026-07-22 15:50:00')
      `).run();
      sqlite.prepare(`
        INSERT INTO invoice_items (
          id,tenant_id,bill_id,item_category,quantity,unit_price,line_total,tax_amount,reference_id,status,created_at
        ) VALUES (315034,102,15034,'doctor_visit',1,500,400,0,3,'active','2026-07-22 15:50:00')
      `).run();

      const authority = await resolveLegacyLiveInvoiceLineAuthority(db, {
        tenantId: '102',
        billId: 15034,
        invoiceNo: 'INV-A-2026-0015034',
        invoiceSourceLineId: '1:doctor_visit:3',
      });

      expect(authority).toMatchObject({
        lineAmountMinor: 50000,
        invoiceStatus: 'posted',
        authority: 'live_gross',
      });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_invoices
        WHERE tenant_id='102' AND invoice_number='INV-A-2026-0015034'
      `).get() as { count: number }).count)).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('uses legacy recovered net-line authority when the canonical invoice has the old line identity', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_feature_flags (
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES (?,?,?,?,?,?,?)
      `).run(
        '102',
        'canonical_financial_dual_write_v1',
        'financial',
        'shadow',
        1,
        1,
        JSON.stringify({ tenantScope: ['102'], writePolicy: 'shadow' }),
      );
      sqlite.prepare(`
        INSERT INTO doctors (id,tenant_id,name,is_active,user_id)
        VALUES (3,'102','Dr Appointment',1,33)
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_practitioners (
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status
        ) VALUES ('102','prc_existing_doctor_3','internal','Dr Appointment','active')
      `).run();
      sqlite.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,evidence_sha256
        ) VALUES ('102','practitioner','prc_existing_doctor_3','legacy_doctor','3',
          'doctors','mapped','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      `).run();
      sqlite.prepare(`
        INSERT INTO bills (
          id,tenant_id,patient_id,invoice_no,total,paid,due,discount,tax_total,status,created_at
        ) VALUES (15035,102,2283,'INV-A-2026-0015035',400,400,0,100,0,'paid','2026-07-22 15:55:00')
      `).run();
      sqlite.prepare(`
        INSERT INTO invoice_items (
          id,tenant_id,bill_id,item_category,quantity,unit_price,line_total,tax_amount,reference_id,status,created_at
        ) VALUES (315035,102,15035,'doctor_visit',1,500,400,0,3,'active','2026-07-22 15:55:00')
      `).run();
      await issueInvoice(db, await buildLiveInvoiceProjection({
        tenantId: '102',
        patientId: 2283,
        invoiceNo: 'INV-A-2026-0015035',
        currencyCode: 'BDT',
        issuedAtUtc: '2026-07-22T09:55:00.000Z',
        items: [{
          sourceLineId: 'invoice_item:315035',
          lineType: 'other_adjustment',
          adjustmentCode: 'LEGACY_DOCTOR_VISIT',
          quantity: 1,
          unitAmount: 400,
        }],
      }));

      const sourceKey = 'bill:15035:line:1:doctor_visit:3:doctor:3:rule:19:performing';
      const result = await executeLiveDoctorCommissionAccrual(db, {
        tenantId: '102',
        legacyStatement: db.prepare(`
          INSERT INTO doctor_commission_accruals (
            tenant_id,doctor_id,patient_id,bill_id,canonical_source_key,source_type,incentive_type,
            gross_amount,commission_base_amount,commission_rule_id,commission_rate_bps,
            commission_amount,earned_commission_amount,doctor_waiver_amount,payable_commission_amount,
            balance_amount,status,accrued_date,created_by
          ) VALUES (102,3,2283,15035,?,'consultation_fee','performer',500,400,19,2500,100,100,0,100,100,'accrued','2026-07-22',33)
        `).bind(sourceKey),
        legacyAccrualSourceKey: sourceKey,
        billId: 15035,
        invoiceNo: 'INV-A-2026-0015035',
        invoiceSourceLineId: '1:doctor_visit:3',
        doctorId: 3,
        doctorDisplayName: 'Dr Appointment',
        doctorIsActive: true,
        doctorUserId: 33,
        practitionerRole: 'performing',
        rule: {
          id: 19,
          serviceType: 'consultation_fee',
          incentiveType: 'performer',
          labTestId: null,
          category: 'doctor_visit',
          rateType: 'percent',
          rateValue: 2500,
          waiverPolicy: 'protected_floor',
          protectedRateValue: 500,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
          createdAt: '2026-01-01 00:00:00',
          updatedAt: '2026-01-01 00:00:00',
        },
        grossAmount: 500,
        discountAmount: 100,
        taxAmount: 0,
        performerReserveAmount: 0,
        eligibleBaseAmount: 400,
        earnedAmount: 100,
        protectedAmount: 20,
        waiverCapacityAmount: 80,
        requestedWaiverAmount: 80,
        hospitalFundedOverflowAmount: 0,
        adjustedAmount: 80,
        payableAmount: 20,
        accruedAtUtc: '2026-07-22T09:55:00.000Z',
        businessDate: '2026-07-22',
      });

      expect(result).toMatchObject({
        mode: 'shadow',
        canonicalSucceeded: true,
      });
      expect(sqlite.prepare(`
        SELECT canonical_public_id
        FROM canonical_source_mappings
        WHERE tenant_id='102' AND entity_type='practitioner'
          AND source_type='legacy_doctor' AND source_public_id='3'
      `).get()).toEqual({ canonical_public_id: 'prc_existing_doctor_3' });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_practitioners WHERE tenant_id='102'
      `).get() as { count: number }).count)).toBe(1);
      expect(sqlite.prepare(`
        SELECT practitioner_public_id FROM canonical_compensation_accruals
      `).get()).toEqual({ practitioner_public_id: 'prc_existing_doctor_3' });
      expect(sqlite.prepare(`
        SELECT gross_minor,discount_minor,eligible_base_minor,earned_minor,
               protected_minor,waiver_capacity_minor,requested_waiver_minor,
               hospital_funded_overflow_minor,adjusted_minor,payable_minor
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        gross_minor: 40000,
        discount_minor: 0,
        eligible_base_minor: 40000,
        earned_minor: 10000,
        protected_minor: 2000,
        waiver_capacity_minor: 8000,
        requested_waiver_minor: 8000,
        hospital_funded_overflow_minor: 0,
        adjusted_minor: 8000,
        payable_minor: 2000,
      });
      expect(sqlite.prepare(`
        SELECT waiver_policy,protected_rate_value
        FROM canonical_compensation_rules
      `).get()).toEqual({
        waiver_policy: 'protected_floor',
        protected_rate_value: 500,
      });
    } finally {
      sqlite.close();
    }
  });

  it('recovers the missing canonical appointment invoice line before shadow accrual', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_feature_flags (
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES (?,?,?,?,?,?,?)
      `).run(
        '102',
        'canonical_financial_dual_write_v1',
        'financial',
        'shadow',
        1,
        1,
        JSON.stringify({ tenantScope: ['102'], writePolicy: 'shadow' }),
      );
      sqlite.prepare(`
        INSERT INTO doctors (id,tenant_id,name,is_active,user_id)
        VALUES (3,'102','Dr Appointment',1,33)
      `).run();
      sqlite.prepare(`
        INSERT INTO bills (
          id,tenant_id,patient_id,invoice_no,total,paid,due,discount,tax_total,status,created_at
        ) VALUES (15036,102,2283,'INV-A-2026-0015036',400,400,0,100,0,'paid','2026-07-22 16:00:00')
      `).run();
      sqlite.prepare(`
        INSERT INTO invoice_items (
          id,tenant_id,bill_id,item_category,quantity,unit_price,line_total,tax_amount,reference_id,status,created_at
        ) VALUES (315036,102,15036,'doctor_visit',1,500,400,0,3,'active','2026-07-22 16:00:00')
      `).run();

      const sourceKey = 'bill:15036:line:1:doctor_visit:3:doctor:3:rule:19:performing';
      const result = await executeLiveDoctorCommissionAccrual(db, {
        tenantId: '102',
        legacyStatement: db.prepare(`
          INSERT INTO doctor_commission_accruals (
            tenant_id,doctor_id,patient_id,bill_id,canonical_source_key,source_type,incentive_type,
            gross_amount,commission_base_amount,commission_rule_id,commission_rate_bps,
            commission_amount,earned_commission_amount,doctor_waiver_amount,payable_commission_amount,
            balance_amount,status,accrued_date,created_by
          ) VALUES (102,3,2283,15036,?,'consultation_fee','performer',500,400,19,2500,100,100,0,100,100,'accrued','2026-07-22',33)
        `).bind(sourceKey),
        legacyAccrualSourceKey: sourceKey,
        billId: 15036,
        invoiceNo: 'INV-A-2026-0015036',
        invoiceSourceLineId: '1:doctor_visit:3',
        doctorId: 3,
        doctorDisplayName: 'Dr Appointment',
        doctorIsActive: true,
        doctorUserId: 33,
        practitionerRole: 'performing',
        rule: {
          id: 19,
          serviceType: 'consultation_fee',
          incentiveType: 'performer',
          labTestId: null,
          category: 'doctor_visit',
          rateType: 'percent',
          rateValue: 2500,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
          createdAt: '2026-01-01 00:00:00',
          updatedAt: '2026-01-01 00:00:00',
        },
        grossAmount: 500,
        discountAmount: 100,
        taxAmount: 0,
        performerReserveAmount: 0,
        eligibleBaseAmount: 400,
        earnedAmount: 100,
        adjustedAmount: 0,
        payableAmount: 100,
        accruedAtUtc: '2026-07-22T10:00:00.000Z',
        businessDate: '2026-07-22',
      });

      expect(result).toMatchObject({
        mode: 'shadow',
        canonicalSucceeded: true,
      });
      expect(sqlite.prepare(`
        SELECT subtotal_minor,adjustment_total_minor,total_minor
        FROM canonical_invoices
        WHERE tenant_id='102' AND invoice_number='INV-A-2026-0015036'
      `).get()).toEqual({
        subtotal_minor: 50000,
        adjustment_total_minor: -10000,
        total_minor: 40000,
      });
      expect(sqlite.prepare(`
        SELECT gross_minor,discount_minor,eligible_base_minor,earned_minor,payable_minor
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        gross_minor: 50000,
        discount_minor: 10000,
        eligible_base_minor: 40000,
        earned_minor: 10000,
        payable_minor: 10000,
      });
    } finally {
      sqlite.close();
    }
  });

  it('dual-writes the corrected discounted reserve-adjusted amount in shadow mode', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_feature_flags (
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES (?,?,?,?,?,?,?)
      `).run(
        '102',
        'canonical_financial_dual_write_v1',
        'financial',
        'shadow',
        1,
        1,
        JSON.stringify({ tenantScope: ['102'], writePolicy: 'shadow' }),
      );

      const invoiceProjection = await buildLiveInvoiceProjection({
        tenantId: '102',
        patientId: 10,
        invoiceNo: 'INV-D-2026-000700',
        currencyCode: 'BDT',
        issuedAtUtc: '2026-07-20T10:00:00.000Z',
        items: [{
          sourceLineId: '1:usg:44',
          lineType: 'other_adjustment',
          adjustmentCode: 'LEGACY_USG',
          quantity: 1,
          unitAmount: 1000,
        }],
        discount: 100,
      });
      await issueInvoice(db, invoiceProjection);

      const sourceKey = 'bill:7000:line:1:usg:44:doctor:3:rule:9:prescribing';
      const result = await executeLiveDoctorCommissionAccrual(db, {
        tenantId: '102',
        legacyStatement: db.prepare(`
          INSERT INTO doctor_commission_accruals (
            tenant_id,doctor_id,canonical_source_key,source_type,incentive_type,
            commission_amount,status,accrued_date
          ) VALUES (?,?,?,'lab_test','prescriber',?,'accrued','2026-07-20')
        `).bind('102', 3, sourceKey, 150),
        legacyAccrualSourceKey: sourceKey,
        billId: 7000,
        invoiceNo: 'INV-D-2026-000700',
        invoiceSourceLineId: '1:usg:44',
        doctorId: 3,
        doctorDisplayName: 'Dr Test Referrer',
        doctorIsActive: true,
        practitionerRole: 'prescribing',
        rule: {
          id: 9,
          serviceType: 'lab_test',
          incentiveType: 'prescriber',
          labTestId: null,
          category: null,
          rateType: 'percent',
          rateValue: 2500,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
          createdAt: '2026-01-01 00:00:00',
          updatedAt: '2026-01-01 00:00:00',
        },
        grossAmount: 1000,
        discountAmount: 100,
        taxAmount: 0,
        performerReserveAmount: 200,
        eligibleBaseAmount: 700,
        earnedAmount: 175,
        adjustedAmount: 25,
        payableAmount: 150,
        accruedAtUtc: '2026-07-20T10:00:00.000Z',
        businessDate: '2026-07-20',
        reportingContext: {
          sourceKind: 'lab_test',
          incentiveType: 'prescriber',
          legacyInvoiceItemId: 44,
          legacyLabOrderItemId: 4044,
          detailName: 'USG Whole Abdomen',
          sourceReference: 'INV-D-2026-000700',
          waiverReason: 'patient_discount_allocation',
        },
      });

      expect(result).toMatchObject({
        mode: 'shadow',
        canonicalSucceeded: true,
      });
      expect(sqlite.prepare(`
        SELECT canonical_source_key,commission_amount
        FROM doctor_commission_accruals
      `).get()).toEqual({
        canonical_source_key: sourceKey,
        commission_amount: 150,
      });
      expect(sqlite.prepare(`
        SELECT practitioner_kind,display_name,status
        FROM canonical_practitioners
      `).get()).toEqual({
        practitioner_kind: 'internal',
        display_name: 'Dr Test Referrer',
        status: 'active',
      });
      expect(sqlite.prepare(`
        SELECT practitioner_role,calculation_basis,rate_type,rate_value,discount_treatment
        FROM canonical_compensation_rules
      `).get()).toEqual({
        practitioner_role: 'prescribing',
        calculation_basis: 'remaining_after_performer',
        rate_type: 'basis_points',
        rate_value: 2500,
        discount_treatment: 'deduct',
      });
      expect(sqlite.prepare(`
        SELECT gross_minor,discount_minor,tax_minor,performer_reserve_minor,
               eligible_base_minor,earned_minor,adjusted_minor,payable_minor,status
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        gross_minor: 100000,
        discount_minor: 10000,
        tax_minor: 0,
        performer_reserve_minor: 20000,
        eligible_base_minor: 70000,
        earned_minor: 17500,
        adjusted_minor: 2500,
        payable_minor: 15000,
        status: 'accrued',
      });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_source_mappings
        WHERE entity_type IN ('practitioner','compensation_rule','compensation_accrual')
      `).get() as { count: number }).count)).toBe(3);
      expect(sqlite.prepare(`
        SELECT source_kind,incentive_type,legacy_bill_id,legacy_invoice_item_id,
               legacy_lab_order_item_id,detail_name,source_reference,waiver_reason,
               doctor_waiver_minor
        FROM canonical_compensation_reporting_context
      `).get()).toEqual({
        source_kind: 'lab_test',
        incentive_type: 'prescriber',
        legacy_bill_id: 7000,
        legacy_invoice_item_id: 44,
        legacy_lab_order_item_id: 4044,
        detail_name: 'USG Whole Abdomen',
        source_reference: 'INV-D-2026-000700',
        waiver_reason: 'patient_discount_allocation',
        doctor_waiver_minor: 2500,
      });
    } finally {
      sqlite.close();
    }
  });

  it('accepts a cumulative percentage allocation delta for a rounded invoice line', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_feature_flags (
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES (?,?,?,?,?,?,?)
      `).run(
        '102',
        'canonical_financial_dual_write_v1',
        'financial',
        'shadow',
        1,
        1,
        JSON.stringify({ tenantScope: ['102'], writePolicy: 'shadow' }),
      );

      const invoiceProjection = await buildLiveInvoiceProjection({
        tenantId: '102',
        patientId: 10,
        invoiceNo: 'INV-DEMO-000791',
        currencyCode: 'BDT',
        issuedAtUtc: '2026-07-27T12:46:37.000Z',
        items: [{
          sourceLineId: '3:test:342',
          lineType: 'other_adjustment',
          adjustmentCode: 'LEGACY_TEST',
          quantity: 1,
          unitAmount: 800,
        }],
        discount: 145.46,
      });
      await issueInvoice(db, invoiceProjection);

      const sourceKey = 'bill:7085:line:3:test:342:doctor:134:rule:52:prescribing';
      const result = await executeLiveDoctorCommissionAccrual(db, {
        tenantId: '102',
        legacyStatement: db.prepare(`
          INSERT INTO doctor_commission_accruals (
            tenant_id,doctor_id,canonical_source_key,source_type,incentive_type,
            commission_amount,status,accrued_date
          ) VALUES (?,?,?,'lab_test','prescriber',?,'accrued','2026-07-27')
        `).bind('102', 134, sourceKey, 22.73),
        legacyAccrualSourceKey: sourceKey,
        billId: 7085,
        invoiceNo: 'INV-DEMO-000791',
        invoiceSourceLineId: '3:test:342',
        doctorId: 134,
        doctorDisplayName: 'Dr. Example Four',
        doctorIsActive: true,
        practitionerRole: 'prescribing',
        rule: {
          id: 52,
          serviceType: 'lab_test',
          incentiveType: 'prescriber',
          labTestId: null,
          category: null,
          rateType: 'percent',
          rateValue: 2500,
          waiverPolicy: 'protected_floor',
          protectedRateValue: 500,
          effectiveFrom: '2026-07-26',
          effectiveTo: null,
          isActive: true,
          createdAt: '2026-07-26 10:14:32',
          updatedAt: '2026-07-26 10:14:32',
        },
        grossAmount: 800,
        discountAmount: 145.46,
        taxAmount: 0,
        performerReserveAmount: 200,
        eligibleBaseAmount: 454.54,
        cumulativeEligibleBaseBeforeAmount: 1145.46,
        earnedAmount: 113.63,
        protectedAmount: 22.73,
        waiverCapacityAmount: 90.90,
        requestedWaiverAmount: 90.90,
        hospitalFundedOverflowAmount: 0,
        adjustedAmount: 90.90,
        payableAmount: 22.73,
        accruedAtUtc: '2026-07-27T12:46:37.000Z',
        businessDate: '2026-07-27',
      });

      expect(result).toMatchObject({ mode: 'shadow', canonicalSucceeded: true });
      expect(sqlite.prepare(`
        SELECT eligible_base_minor,earned_minor,protected_minor,waiver_capacity_minor,
               adjusted_minor,payable_minor
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        eligible_base_minor: 45454,
        earned_minor: 11363,
        protected_minor: 2273,
        waiver_capacity_minor: 9090,
        adjusted_minor: 9090,
        payable_minor: 2273,
      });
    } finally {
      sqlite.close();
    }
  });

  it('projects cumulative protected-floor rounding through accrueBillCommissions', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_feature_flags (
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES (?,?,?,?,?,?,?)
      `).run(
        '102',
        'canonical_financial_dual_write_v1',
        'financial',
        'shadow',
        1,
        1,
        JSON.stringify({ tenantScope: ['102'], writePolicy: 'shadow' }),
      );
      sqlite.prepare(`
        INSERT INTO doctors (id,tenant_id,name,is_active,user_id)
        VALUES (134,'102','Dr. Example Four',1,NULL)
      `).run();
      sqlite.prepare(`
        INSERT INTO doctor_commission_rules (
          id,tenant_id,doctor_id,service_type,incentive_type,lab_test_id,category,
          rate_type,rate_value,effective_from,effective_to,is_active,
          waiver_policy,protected_rate_bps,protected_flat_amount
        ) VALUES (52,'102',134,'lab_test','prescriber',NULL,NULL,
          'percent',2500,'2026-07-26',NULL,1,'protected_floor',500,0)
      `).run();

      await issueInvoice(db, await buildLiveInvoiceProjection({
        tenantId: '102',
        patientId: 10,
        invoiceNo: 'INV-DEMO-000791',
        currencyCode: 'BDT',
        issuedAtUtc: '2026-07-27T12:46:37.000Z',
        items: [
          { sourceLineId: '1:test:242', lineType: 'other_adjustment', adjustmentCode: 'LEGACY_TEST', quantity: 1, unitAmount: 200 },
          { sourceLineId: '2:test:261', lineType: 'other_adjustment', adjustmentCode: 'LEGACY_TEST', quantity: 1, unitAmount: 1200 },
          { sourceLineId: '3:test:342', lineType: 'other_adjustment', adjustmentCode: 'LEGACY_TEST', quantity: 1, unitAmount: 800 },
        ],
        discount: 400,
      }));

      const count = await accrueBillCommissions(db as unknown as D1Database, {
        tenantId: '102',
        userId: 99,
        patientId: 10,
        visitId: null,
        billId: 7085,
        invoiceNo: 'INV-DEMO-000791',
        referringDoctorId: 134,
        billDate: '2026-07-27',
        accruedAtUtc: '2026-07-27T12:46:37.000Z',
        doctorCommissionWaivers: [{ doctorId: 134, amount: 400 }],
        items: [
          {
            itemCategory: 'test', description: 'BloodSugar (RBS,PPBS)',
            lineTotal: 163.64, grossLineTotal: 200, taxAmount: 0,
            canonicalSourceLineId: '1:test:242', referenceId: 242,
          },
          {
            itemCategory: 'test', description: 'S. Amaylase',
            lineTotal: 981.82, grossLineTotal: 1200, taxAmount: 0,
            canonicalSourceLineId: '2:test:261', referenceId: 261,
          },
          {
            itemCategory: 'test', description: 'Ultrasonography Of Whole Abdomen',
            lineTotal: 654.54, grossLineTotal: 800, taxAmount: 0,
            canonicalSourceLineId: '3:test:342', referenceId: 342,
            commissionBaseAmount: 454.54, performerReserveAmount: 200, hasPerformerReserve: true,
          },
        ],
      });

      expect(count).toBe(3);
      expect(sqlite.prepare(`
        SELECT SUM(earned_commission_amount) earned,
               SUM(doctor_waiver_amount) waiver,
               SUM(payable_commission_amount) payable
        FROM doctor_commission_accruals
      `).get()).toEqual({ earned: 400, waiver: 320, payable: 80 });
      expect(sqlite.prepare(`
        SELECT SUM(earned_minor) earned_minor,
               SUM(adjusted_minor) adjusted_minor,
               SUM(payable_minor) payable_minor
        FROM canonical_compensation_accruals
      `).get()).toEqual({ earned_minor: 40000, adjusted_minor: 32000, payable_minor: 8000 });
      expect(sqlite.prepare(`
        SELECT eligible_base_minor,earned_minor,adjusted_minor,payable_minor
        FROM canonical_compensation_accruals
        ORDER BY eligible_base_minor DESC
        LIMIT 1
      `).get()).toEqual({
        eligible_base_minor: 98182,
        earned_minor: 24546,
        adjusted_minor: 19637,
        payable_minor: 4909,
      });
      expect(sqlite.prepare(`
        SELECT earned_minor,adjusted_minor,payable_minor
        FROM canonical_compensation_accruals
        WHERE eligible_base_minor=45454
      `).get()).toEqual({ earned_minor: 11363, adjusted_minor: 9090, payable_minor: 2273 });
    } finally {
      sqlite.close();
    }
  });

  it('projects accrueBillCommissions into both legacy and canonical ledgers', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_feature_flags (
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES (?,?,?,?,?,?,?)
      `).run(
        '100',
        'canonical_financial_dual_write_v1',
        'financial',
        'shadow',
        1,
        1,
        JSON.stringify({ tenantScope: ['100'], writePolicy: 'strict' }),
      );
      sqlite.prepare(`
        INSERT INTO doctors (id,tenant_id,name,is_active,user_id,canonical_source_key)
        VALUES (3,'100','Dr Test Referrer',1,NULL,'docsrc_route_stable_3')
      `).run();
      sqlite.prepare(`
        INSERT INTO doctor_commission_rules (
          id,tenant_id,doctor_id,service_type,incentive_type,lab_test_id,category,
          rate_type,rate_value,effective_from,effective_to,is_active
        ) VALUES (9,'100',3,'lab_test','prescriber',NULL,NULL,'percent',2500,'2026-01-01',NULL,1)
      `).run();

      const invoiceProjection = await buildLiveInvoiceProjection({
        tenantId: '100',
        patientId: 10,
        invoiceNo: 'INV-D-2026-000701',
        currencyCode: 'BDT',
        issuedAtUtc: '2026-07-20T10:05:00.000Z',
        items: [{
          sourceLineId: '1:usg:44',
          lineType: 'other_adjustment',
          adjustmentCode: 'LEGACY_USG',
          quantity: 1,
          unitAmount: 1000,
        }],
        discount: 100,
      });
      await issueInvoice(db, invoiceProjection);

      const count = await accrueBillCommissions(db as unknown as D1Database, {
        tenantId: '100',
        userId: 99,
        patientId: 10,
        visitId: null,
        billId: 7001,
        invoiceNo: 'INV-D-2026-000701',
        referringDoctorId: 3,
        billDate: '2026-07-20',
        accruedAtUtc: '2026-07-20T10:05:00.000Z',
        items: [{
          itemCategory: 'usg',
          description: 'USG Whole Abdomen',
          lineTotal: 900,
          grossLineTotal: 1000,
          taxAmount: 0,
          canonicalSourceLineId: '1:usg:44',
          referenceId: 44,
          commissionBaseAmount: 700,
          performerReserveAmount: 200,
          hasPerformerReserve: true,
        }],
      });

      expect(count).toBe(1);
      expect(sqlite.prepare(`
        SELECT gross_amount,commission_base_amount,performer_reserve_amount,
               earned_commission_amount,payable_commission_amount,canonical_source_key
        FROM doctor_commission_accruals
      `).get()).toEqual({
        gross_amount: 1000,
        commission_base_amount: 700,
        performer_reserve_amount: 200,
        earned_commission_amount: 175,
        payable_commission_amount: 175,
        canonical_source_key: 'bill:7001:line:1:usg:44:doctor:3:rule:9:prescribing',
      });
      expect(sqlite.prepare(`
        SELECT gross_minor,discount_minor,performer_reserve_minor,eligible_base_minor,
               earned_minor,payable_minor
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        gross_minor: 100000,
        discount_minor: 10000,
        performer_reserve_minor: 20000,
        eligible_base_minor: 70000,
        earned_minor: 17500,
        payable_minor: 17500,
      });
      expect(sqlite.prepare(`
        SELECT source_public_id
        FROM canonical_source_mappings
        WHERE tenant_id='100' AND entity_type='practitioner'
      `).get()).toEqual({ source_public_id: 'docsrc_route_stable_3' });
      expect(sqlite.prepare(`
        SELECT source_kind,incentive_type,legacy_bill_id,detail_name,source_reference,waiver_reason
        FROM canonical_compensation_reporting_context
      `).get()).toEqual({
        source_kind: 'lab_test',
        incentive_type: 'prescriber',
        legacy_bill_id: 7001,
        detail_name: 'USG Whole Abdomen',
        source_reference: 'INV-D-2026-000701',
        waiver_reason: null,
      });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM accounting_posting_events
      `).get() as { count: number }).count)).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
