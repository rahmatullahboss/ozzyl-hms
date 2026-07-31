import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  executeLiveRefundCompensationRelease,
  executeLiveRefundCompensationReservation,
} from '../../src/lib/canonical/live-refund-compensation';
import { executeStrictFinancialMutation } from '../../src/lib/canonical/strict-financial-mutation';
import {
  getCanonicalExecutiveDoctorPerformance,
  type CanonicalExecutiveDoctorAnalyticsDatabase,
  type CanonicalExecutiveDoctorAnalyticsPreparedStatement,
} from '../../src/lib/canonical/reporting/executive-doctor-analytics';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement, CanonicalExecutiveDoctorAnalyticsPreparedStatement {
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
  for (const migration of [
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
    '0531_canonical_compensation_refund_reservations.sql',
  ]) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  const db = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements: CanonicalPreparedStatement[]) {
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
  } satisfies CanonicalBatchDatabase & CanonicalExecutiveDoctorAnalyticsDatabase;
  return { sqlite, db };
}

const HASH = 'a'.repeat(64);
const PERIOD = {
  startDate: '2026-07-20',
  endDate: '2026-07-23',
  startDateTimeUtc: '2026-07-19T18:00:00.000Z',
  endDateTimeUtcExclusive: '2026-07-23T18:00:00.000Z',
};

function seed(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('102','prac-ref','internal','Dr Refund','active');

    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('102','practitioner','prac-ref','legacy_doctor','7','doctors','mapped',1,'${HASH}'),
      ('102','compensation_accrual','acc-refund','legacy_doctor_commission_accrual',
       'bill:7001:line:1:test:44:doctor:7:rule:9:prescribing',
       'doctor_commission_accruals','mapped',1,'${HASH}');

    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES (
      '102','inv-refund','INV-REFUND-1',10,'BDT',40000,0,40000,40000,0,
      0,0,1,'posted','2026-07-20T04:00:00.000Z','2026-07-20T04:00:00.000Z','${HASH}'
    );

    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES (
      '102','line-refund','inv-refund','other_adjustment',NULL,'LEGACY_TEST',1,40000,40000,'${HASH}'
    );

    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
      priority,effective_from,effective_to,status,source_evidence_sha256
    ) VALUES (
      '102','rule-ref',1,'all',NULL,NULL,'prac-ref','prescribing','commission',
      'basis_points',2500,'net_after_discount','deduct','exclude',0,NULL,20,
      '2026-01-01',NULL,'active','${HASH}'
    );

    INSERT INTO canonical_compensation_accruals (
      tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
      service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
      rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
      gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
      earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
      business_date,payable_projection_guard,source_evidence_sha256
    ) VALUES (
      '102','acc-refund','inv-refund','line-refund',NULL,'prac-ref','prescribing','commission',
      'rule-ref',1,'net_after_discount','basis_points',2500,'BDT',40000,0,0,0,
      40000,10000,2000,3000,5000,'partially_settled','2026-07-20T04:00:00.000Z',
      '2026-07-20',1,'${HASH}'
    );

    INSERT INTO canonical_compensation_reporting_context (
      tenant_id,accrual_public_id,source_kind,incentive_type,legacy_bill_id,
      legacy_invoice_item_id,legacy_lab_order_item_id,detail_name,source_reference,
      waiver_reason,doctor_waiver_minor,source_evidence_sha256
    ) VALUES (
      '102','acc-refund','lab_test','prescriber',7001,8001,9001,'CBC','INV-REFUND-1',
      'patient_discount_allocation',2000,'${HASH}'
    );
  `);
}

describe('live canonical refund compensation projection', () => {
  it('reserves and releases unpaid commission while preserving effective earned and waiver facts', async () => {
    const { sqlite, db } = harness();
    try {
      seed(sqlite);
      const sourceKey = 'bill:7001:line:1:test:44:doctor:7:rule:9:prescribing';
      const reservation = await executeLiveRefundCompensationReservation(db, {
        tenantId: '102',
        refundSourcePublicId: 'refund-request-abc',
        occurredAtUtc: '2026-07-23T04:00:00.000Z',
        businessDate: '2026-07-23',
        reasonCode: 'refund_commission_reservation',
        rows: [{
          legacyAccrualId: 11,
          legacyAccrualSourceKey: sourceKey,
          originalCommissionBaseAmount: 400,
          reservedCommissionBaseAmount: 200,
          originalEarnedAmount: 100,
          reservedEarnedAmount: 50,
          originalDoctorWaiverAmount: 20,
          reservedDoctorWaiverAmount: 20,
          originalPayableAmount: 80,
          reservedPayableAmount: 30,
          paidAmount: 30,
          reversalAmount: 50,
        }],
      });
      expect(reservation.status).toBe('applied');
      expect(sqlite.prepare(`
        SELECT adjusted_minor,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals
        WHERE tenant_id='102' AND accrual_public_id='acc-refund'
      `).get()).toEqual({
        adjusted_minor: 7000,
        settled_minor: 3000,
        payable_minor: 0,
        status: 'settled',
      });
      expect(sqlite.prepare(`
        SELECT original_earned_minor,reserved_earned_minor,
               original_waiver_minor,reserved_waiver_minor,
               original_payable_minor,reserved_payable_minor,status
        FROM canonical_compensation_refund_reservations
        WHERE tenant_id='102'
      `).get()).toEqual({
        original_earned_minor: 10000,
        reserved_earned_minor: 5000,
        original_waiver_minor: 2000,
        reserved_waiver_minor: 2000,
        original_payable_minor: 8000,
        reserved_payable_minor: 3000,
        status: 'held',
      });

      const heldReport = await getCanonicalExecutiveDoctorPerformance({
        dbBinding: db,
        tenantId: '102',
        period: PERIOD,
        search: '',
        sortBy: 'payableCommission',
        sortDirection: 'desc',
        page: 1,
        pageSize: 10,
      });
      expect(heldReport.rows[0]).toMatchObject({
        earnedCommission: 50,
        doctorWaiver: 20,
        payableCommission: 30,
        paidCommission: 30,
        outstandingCommission: 0,
      });

      const release = await executeLiveRefundCompensationRelease(db, {
        tenantId: '102',
        refundSourcePublicId: 'refund-request-abc',
        occurredAtUtc: '2026-07-23T05:00:00.000Z',
        businessDate: '2026-07-23',
        reasonCode: 'refund_dispute_recovered',
      });
      expect(release.status).toBe('applied');
      expect(sqlite.prepare(`
        SELECT adjusted_minor,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals
        WHERE tenant_id='102' AND accrual_public_id='acc-refund'
      `).get()).toEqual({
        adjusted_minor: 2000,
        settled_minor: 3000,
        payable_minor: 5000,
        status: 'partially_settled',
      });
      expect(sqlite.prepare(`
        SELECT status,reversal_public_id
        FROM canonical_compensation_refund_reservations
        WHERE tenant_id='102'
      `).get()).toMatchObject({
        status: 'released',
        reversal_public_id: expect.any(String),
      });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count
        FROM canonical_compensation_adjustment_reversals
        WHERE tenant_id='102'
      `).get() as { count: number }).count)).toBe(1);

      const releasedReport = await getCanonicalExecutiveDoctorPerformance({
        dbBinding: db,
        tenantId: '102',
        period: PERIOD,
        search: '',
        sortBy: 'payableCommission',
        sortDirection: 'desc',
        page: 1,
        pageSize: 10,
      });
      expect(releasedReport.rows[0]).toMatchObject({
        earnedCommission: 100,
        doctorWaiver: 20,
        payableCommission: 80,
        paidCommission: 30,
        outstandingCommission: 50,
      });
    } finally {
      sqlite.close();
    }
  });

  it('runs refund commission reservation as a monitored shadow mutation', async () => {
    const { sqlite, db } = harness();
    try {
      seed(sqlite);
      sqlite.exec(`
        CREATE TABLE legacy_refund_mutations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL,
          source_public_id TEXT NOT NULL
        );
        INSERT INTO canonical_feature_flags (
          tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        ) VALUES (
          '102','canonical_financial_dual_write_v1','financial','shadow',1,1,
          '{"writePolicy":"shadow","tenantScope":["102"]}'
        );
      `);
      const execution = await executeStrictFinancialMutation({
        db,
        tenantId: '102',
        boundary: 'doctor-compensation.refund-reserve',
        legacyStatements: [db.prepare(`
          INSERT INTO legacy_refund_mutations (tenant_id,source_public_id)
          VALUES (?,?)
        `).bind('102', 'refund-shadow-abc')],
        canonical: (options) => executeLiveRefundCompensationReservation(db, {
          tenantId: '102',
          refundSourcePublicId: 'refund-shadow-abc',
          occurredAtUtc: '2026-07-23T04:00:00.000Z',
          businessDate: '2026-07-23',
          reasonCode: 'refund_commission_reservation',
          rows: [{
            legacyAccrualId: 11,
            legacyAccrualSourceKey: 'bill:7001:line:1:test:44:doctor:7:rule:9:prescribing',
            originalCommissionBaseAmount: 400,
            reservedCommissionBaseAmount: 200,
            originalEarnedAmount: 100,
            reservedEarnedAmount: 50,
            originalDoctorWaiverAmount: 20,
            reservedDoctorWaiverAmount: 20,
            originalPayableAmount: 80,
            reservedPayableAmount: 30,
            paidAmount: 30,
            reversalAmount: 50,
          }],
        }, options),
      });

      expect(execution).toMatchObject({
        mode: 'shadow',
        canonicalSucceeded: true,
      });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM legacy_refund_mutations
      `).get() as { count: number }).count)).toBe(1);
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_compensation_refund_reservations
      `).get() as { count: number }).count)).toBe(1);
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count
        FROM canonical_processing_issues
        WHERE issue_type='financial_shadow_write' AND status='open'
      `).get() as { count: number }).count)).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
