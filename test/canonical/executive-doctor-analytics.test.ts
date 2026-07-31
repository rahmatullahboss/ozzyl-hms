import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  getCanonicalExecutiveDoctorPerformance,
  getCanonicalExecutiveDoctorPerformanceDetails,
  type CanonicalExecutiveDoctorAnalyticsDatabase,
  type CanonicalExecutiveDoctorAnalyticsPreparedStatement,
} from '../../src/lib/canonical/reporting/executive-doctor-analytics';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalExecutiveDoctorAnalyticsPreparedStatement {
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
  const db: CanonicalExecutiveDoctorAnalyticsDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
  };
  return { sqlite, db };
}

const HASH = 'a'.repeat(64);

function seed(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES
      ('102','prac-ref','internal','Dr Referrer','active'),
      ('102','prac-perf','internal','Dr Performer','active');

    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('102','practitioner','prac-ref','legacy_doctor','7','doctors','mapped',1,'${HASH}'),
      ('102','practitioner','prac-perf','legacy_doctor','8','doctors','mapped',1,'${HASH}');

    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES
      ('102','inv-test-1','INV-TEST-1',10,'BDT',100000,-10000,90000,90000,0,0,0,1,
       'posted','2026-07-20T04:00:00.000Z','2026-07-20T04:00:00.000Z','${HASH}'),
      ('102','inv-test-2','INV-TEST-2',11,'BDT',40000,0,40000,40000,0,0,0,1,
       'posted','2026-07-21T04:00:00.000Z','2026-07-21T04:00:00.000Z','${HASH}'),
      ('102','inv-reversed','INV-REVERSED',12,'BDT',20000,0,20000,20000,0,0,0,1,
       'posted','2026-07-21T05:00:00.000Z','2026-07-21T05:00:00.000Z','${HASH}'),
      ('102','inv-visit','INV-VISIT-1',13,'BDT',50000,-10000,40000,40000,0,0,0,1,
       'posted','2026-07-22T04:00:00.000Z','2026-07-22T04:00:00.000Z','${HASH}');

    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES
      ('102','line-test-1','inv-test-1','other_adjustment',NULL,'LEGACY_TEST',1,100000,100000,'${HASH}'),
      ('102','line-test-2','inv-test-2','other_adjustment',NULL,'LEGACY_TEST',1,40000,40000,'${HASH}'),
      ('102','line-reversed','inv-reversed','other_adjustment',NULL,'LEGACY_TEST',1,20000,20000,'${HASH}'),
      ('102','line-visit','inv-visit','other_adjustment',NULL,'LEGACY_VISIT',1,50000,50000,'${HASH}');

    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
      priority,effective_from,effective_to,status,source_evidence_sha256
    ) VALUES
      ('102','rule-ref',1,'all',NULL,NULL,'prac-ref','prescribing','commission',
       'basis_points',2500,'remaining_after_performer','deduct','exclude',0,NULL,20,
       '2026-01-01',NULL,'active','${HASH}'),
      ('102','rule-visit',1,'all',NULL,NULL,'prac-ref','performing','professional_fee',
       'basis_points',2500,'net_after_discount','deduct','exclude',0,NULL,20,
       '2026-01-01',NULL,'active','${HASH}'),
      ('102','rule-reserve',1,'all',NULL,NULL,'prac-perf','performing','performer_reserve',
       'fixed',20000,'net_after_discount','deduct','exclude',0,NULL,10,
       '2026-01-01',NULL,'active','${HASH}');

    INSERT INTO canonical_compensation_accruals (
      tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
      service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
      rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
      gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
      earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
      business_date,payable_projection_guard,source_evidence_sha256
    ) VALUES
      ('102','acc-ref-partial','inv-test-1','line-test-1',NULL,'prac-ref','prescribing','commission',
       'rule-ref',1,'remaining_after_performer','basis_points',2500,'BDT',100000,10000,0,
       20000,70000,17500,2500,5000,10000,'partially_settled','2026-07-20T04:00:00.000Z','2026-07-20',1,'${HASH}'),
      ('102','acc-ref-waived','inv-test-2','line-test-2',NULL,'prac-ref','prescribing','commission',
       'rule-ref',1,'remaining_after_performer','basis_points',2500,'BDT',40000,0,0,
       0,40000,10000,10000,0,0,'settled','2026-07-21T04:00:00.000Z','2026-07-21',1,'${HASH}'),
      ('102','acc-ref-reversed','inv-reversed','line-reversed',NULL,'prac-ref','prescribing','commission',
       'rule-ref',1,'remaining_after_performer','basis_points',2500,'BDT',20000,0,0,
       0,20000,5000,5000,0,0,'reversed','2026-07-21T05:00:00.000Z','2026-07-21',1,'${HASH}'),
      ('102','acc-visit','inv-visit','line-visit',NULL,'prac-ref','performing','professional_fee',
       'rule-visit',1,'net_after_discount','basis_points',2500,'BDT',50000,10000,0,
       0,40000,10000,0,0,10000,'accrued','2026-07-22T04:00:00.000Z','2026-07-22',1,'${HASH}'),
      ('102','acc-reserve-paid','inv-test-1','line-test-1',NULL,'prac-perf','performing','performer_reserve',
       'rule-reserve',1,'net_after_discount','fixed',20000,'BDT',90000,10000,0,
       0,80000,20000,0,20000,0,'settled','2026-07-20T04:00:00.000Z','2026-07-20',1,'${HASH}'),
      ('102','acc-reserve-open','inv-test-2','line-test-2',NULL,'prac-perf','performing','performer_reserve',
       'rule-reserve',1,'net_after_discount','fixed',15000,'BDT',40000,0,0,
       0,40000,15000,0,0,15000,'accrued','2026-07-21T04:00:00.000Z','2026-07-21',1,'${HASH}');

    INSERT INTO canonical_compensation_reporting_context (
      tenant_id,accrual_public_id,source_kind,incentive_type,legacy_bill_id,
      legacy_invoice_item_id,legacy_lab_order_item_id,detail_name,source_reference,
      waiver_reason,doctor_waiver_minor,source_evidence_sha256
    ) VALUES
      ('102','acc-ref-partial','lab_test','prescriber',101,1001,2001,'CBC','INV-TEST-1',
       'patient_discount_allocation',2500,'${HASH}'),
      ('102','acc-ref-waived','lab_test','prescriber',102,1002,2002,'LFT','INV-TEST-2',
       'patient_discount_allocation',10000,'${HASH}'),
      ('102','acc-ref-reversed','lab_test','prescriber',103,1003,2003,'Cancelled Test','INV-REVERSED',
       NULL,0,'${HASH}'),
      ('102','acc-visit','consultation_fee','performer',104,1004,NULL,'Consultation','INV-VISIT-1',
       NULL,0,'${HASH}'),
      ('102','acc-reserve-paid','performer_reserve','performer',101,1001,2001,'CBC','INV-TEST-1',
       NULL,0,'${HASH}'),
      ('102','acc-reserve-open','performer_reserve','performer',102,1002,2002,'LFT','INV-TEST-2',
       NULL,0,'${HASH}');

    INSERT INTO canonical_compensation_settlements (
      tenant_id,settlement_public_id,settlement_number,practitioner_public_id,
      currency_code,payment_method,total_minor,allocated_minor,reversed_minor,net_paid_minor,
      status,settled_at_utc,business_date,reversed_at_utc,settlement_projection_guard,
      source_evidence_sha256
    ) VALUES
      ('102','set-ref','SET-REF','prac-ref','BDT','cash',5000,5000,0,5000,'posted',
       '2026-07-22T08:00:00.000Z','2026-07-22',NULL,1,'${HASH}'),
      ('102','set-perf','SET-PERF','prac-perf','BDT','cash',20000,20000,0,20000,'posted',
       '2026-07-22T08:05:00.000Z','2026-07-22',NULL,1,'${HASH}');

    INSERT INTO canonical_compensation_settlement_allocations (
      tenant_id,allocation_public_id,settlement_public_id,accrual_public_id,amount_minor,
      reversed_minor,remaining_minor,accrual_settled_before_minor,accrual_settled_after_minor,
      accrual_payable_before_minor,accrual_payable_after_minor,status,allocated_at_utc,
      reversed_at_utc,balance_guard,source_evidence_sha256
    ) VALUES
      ('102','alloc-ref','set-ref','acc-ref-partial',5000,0,5000,0,5000,15000,10000,
       'active','2026-07-22T08:00:00.000Z',NULL,1,'${HASH}'),
      ('102','alloc-perf','set-perf','acc-reserve-paid',20000,0,20000,0,20000,20000,0,
       'active','2026-07-22T08:05:00.000Z',NULL,1,'${HASH}');

    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,total_minor,
      allocated_total_minor,unallocated_minor,status,received_at_utc,business_date,posted_at_utc,
      reconciliation_guard,source_evidence_sha256,refunded_minor,net_received_minor,
      refund_projection_guard
    ) VALUES
      ('102','rec-1','REC-1',10,'BDT',90000,90000,0,'posted','2026-07-20T04:30:00.000Z',
       '2026-07-20','2026-07-20T04:30:00.000Z',1,'${HASH}',0,90000,1),
      ('102','rec-2','REC-2',11,'BDT',40000,40000,0,'posted','2026-07-21T04:30:00.000Z',
       '2026-07-21','2026-07-21T04:30:00.000Z',1,'${HASH}',0,40000,1),
      ('102','rec-visit','REC-VISIT',13,'BDT',40000,40000,0,'posted','2026-07-22T04:30:00.000Z',
       '2026-07-22','2026-07-22T04:30:00.000Z',1,'${HASH}',0,40000,1);

    INSERT INTO canonical_payment_allocations (
      tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,invoice_line_public_id,
      amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,allocated_at_utc,
      balance_guard,source_evidence_sha256,reversed_minor,remaining_minor,reversal_projection_guard
    ) VALUES
      ('102','pay-alloc-1','rec-1','inv-test-1','line-test-1',90000,90000,0,'active',
       '2026-07-20T04:30:00.000Z',1,'${HASH}',0,90000,1),
      ('102','pay-alloc-2','rec-2','inv-test-2','line-test-2',40000,40000,0,'active',
       '2026-07-21T04:30:00.000Z',1,'${HASH}',0,40000,1),
      ('102','pay-alloc-visit','rec-visit','inv-visit','line-visit',40000,40000,0,'active',
       '2026-07-22T04:30:00.000Z',1,'${HASH}',0,40000,1);
  `);
}

const PERIOD = {
  startDate: '2026-07-20',
  endDate: '2026-07-22',
  startDateTimeUtc: '2026-07-19T18:00:00.000Z',
  endDateTimeUtcExclusive: '2026-07-22T18:00:00.000Z',
};

describe('canonical executive doctor analytics', () => {
  it('preserves waiver, settlement, outstanding, reserve, and reversed-row rules', async () => {
    const { sqlite, db } = harness();
    try {
      seed(sqlite);
      const response = await getCanonicalExecutiveDoctorPerformance({
        dbBinding: db,
        tenantId: '102',
        period: PERIOD,
        search: '',
        sortBy: 'payableCommission',
        sortDirection: 'desc',
        page: 1,
        pageSize: 10,
      });

      expect(response.queryContract).toMatchObject({
        contractVersion: 'doctor-compensation-v1',
        dataSource: 'canonical',
      });
      expect(response.rows).toEqual([
        {
          doctorId: 8,
          doctorName: 'Dr Performer',
          visits: 0,
          visitCollection: 0,
          visitCommission: 0,
          tests: 0,
          referredTests: 0,
          discountedTests: 0,
          testGrossAmount: 0,
          testDiscountAmount: 0,
          testCollection: 0,
          referrerCommission: 0,
          performerReserveCount: 2,
          performedTests: 2,
          performerReserve: 350,
          testCommission: 350,
          otherCommission: 0,
          earnedCommission: 350,
          doctorWaiver: 0,
          payableCommission: 350,
          paidCommission: 200,
          outstandingCommission: 150,
          totalCommission: 350,
        },
        {
          doctorId: 7,
          doctorName: 'Dr Referrer',
          visits: 1,
          visitCollection: 400,
          visitCommission: 100,
          tests: 2,
          referredTests: 2,
          discountedTests: 1,
          testGrossAmount: 1400,
          testDiscountAmount: 100,
          testCollection: 1300,
          referrerCommission: 150,
          performerReserveCount: 0,
          performedTests: 0,
          performerReserve: 0,
          testCommission: 150,
          otherCommission: 0,
          earnedCommission: 375,
          doctorWaiver: 125,
          payableCommission: 250,
          paidCommission: 50,
          outstandingCommission: 200,
          totalCommission: 250,
        },
      ]);
      expect(response.totals).toMatchObject({
        visits: 1,
        referredTests: 2,
        performedTests: 2,
        earnedCommission: 725,
        doctorWaiver: 125,
        payableCommission: 600,
        paidCommission: 250,
        outstandingCommission: 350,
      });
    } finally {
      sqlite.close();
    }
  });

  it('uses canonical payable authority for non-waiver financial adjustments', async () => {
    const { sqlite, db } = harness();
    try {
      seed(sqlite);
      sqlite.exec(`
        UPDATE canonical_compensation_accruals
        SET adjusted_minor=2000,payable_minor=8000
        WHERE tenant_id='102' AND accrual_public_id='acc-visit';
      `);
      const response = await getCanonicalExecutiveDoctorPerformance({
        dbBinding: db,
        tenantId: '102',
        period: PERIOD,
        search: 'Referrer',
        sortBy: 'payableCommission',
        sortDirection: 'desc',
        page: 1,
        pageSize: 10,
      });
      expect(response.rows[0]).toMatchObject({
        earnedCommission: 375,
        doctorWaiver: 125,
        visitCommission: 80,
        payableCommission: 230,
        paidCommission: 50,
        outstandingCommission: 180,
      });
      const details = await getCanonicalExecutiveDoctorPerformanceDetails({
        dbBinding: db,
        tenantId: '102',
        period: PERIOD,
        doctorId: 7,
        tab: 'commissions',
        page: 1,
        pageSize: 10,
      });
      expect(details.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          detailName: 'Consultation',
          commissionRuleId: 'rule-visit',
          commissionRuleVersion: 1,
          adjustmentAmount: -20,
          reasonCode: 'manual_adjustment',
          reasonLabel: 'Manual adjustment',
          earnedAmount: 100,
          waiverAmount: 0,
          payableAmount: 80,
        }),
      ]));
    } finally {
      sqlite.close();
    }
  });

  it('uses the same canonical facts for summary and every drill-down tab', async () => {
    const { sqlite, db } = harness();
    try {
      seed(sqlite);
      const commissions = await getCanonicalExecutiveDoctorPerformanceDetails({
        dbBinding: db,
        tenantId: '102',
        period: PERIOD,
        doctorId: 7,
        tab: 'commissions',
        page: 1,
        pageSize: 10,
      });
      expect(commissions.queryContract.dataSource).toBe('canonical');
      expect(commissions.summary).toEqual({
        visits: 1,
        visitCollection: 400,
        referredTests: 2,
        discountedTests: 1,
        testGrossAmount: 1400,
        testDiscountAmount: 100,
        testCollection: 1300,
        performedTests: 0,
        performerReserveAmount: 0,
        earnedCommission: 375,
        doctorWaiver: 125,
        payableCommission: 250,
        paidCommission: 50,
        outstandingCommission: 200,
      });
      expect(commissions.totalRows).toBe(3);
      expect(commissions.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'lab_test',
          detailName: 'CBC',
          billId: 101,
          commissionRuleId: 'rule-ref',
          commissionRuleVersion: 1,
          adjustmentAmount: 0,
          reasonCode: 'doctor_waived',
          reasonLabel: 'Doctor waived commission',
          earnedAmount: 175,
          waiverAmount: 25,
          payableAmount: 150,
          paidAmount: 50,
          outstandingAmount: 100,
          settlementNo: 'SET-REF',
        }),
        expect.objectContaining({
          sourceType: 'lab_test',
          detailName: 'LFT',
          commissionRuleId: 'rule-ref',
          commissionRuleVersion: 1,
          adjustmentAmount: 0,
          reasonCode: 'doctor_waived',
          reasonLabel: 'Doctor waived commission',
          earnedAmount: 100,
          waiverAmount: 100,
          payableAmount: 0,
          outstandingAmount: 0,
        }),
        expect.objectContaining({
          sourceType: 'consultation_fee',
          detailName: 'Consultation',
          payableAmount: 100,
          outstandingAmount: 100,
        }),
      ]));

      const tests = await getCanonicalExecutiveDoctorPerformanceDetails({
        dbBinding: db,
        tenantId: '102',
        period: PERIOD,
        doctorId: 7,
        tab: 'tests',
        page: 1,
        pageSize: 10,
      });
      expect(tests.totalRows).toBe(2);
      expect(tests.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          testName: 'CBC',
          grossAmount: 1000,
          discountAmount: 100,
          collectedAmount: 900,
          testCommission: 175,
          payableAmount: 150,
          paidAmount: 50,
          outstandingAmount: 100,
        }),
        expect.objectContaining({
          testName: 'LFT',
          grossAmount: 400,
          discountAmount: 0,
          collectedAmount: 400,
          testCommission: 100,
          waiverAmount: 100,
          payableAmount: 0,
        }),
      ]));

      const visits = await getCanonicalExecutiveDoctorPerformanceDetails({
        dbBinding: db,
        tenantId: '102',
        period: PERIOD,
        doctorId: 7,
        tab: 'visits',
        page: 1,
        pageSize: 10,
      });
      expect(visits.totalRows).toBe(1);
      expect(visits.rows[0]).toMatchObject({
        serviceName: 'Consultation',
        billedAmount: 400,
        collectedAmount: 400,
        dueAmount: 0,
      });
    } finally {
      sqlite.close();
    }
  });
});
