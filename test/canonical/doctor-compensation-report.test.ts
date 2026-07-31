import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  getCanonicalDoctorCompensation,
  type CanonicalDoctorCompensationDatabase,
  type CanonicalDoctorCompensationPreparedStatement,
} from '../../src/lib/canonical/reporting/doctor-compensation';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalDoctorCompensationPreparedStatement {
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
  ]) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  const db: CanonicalDoctorCompensationDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
  };
  return { sqlite, db };
}

const HASH = 'd'.repeat(64);

function seed(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES
      ('102','prac-ref','internal','Dr Referrer','active'),
      ('102','prac-perf','internal','Dr Performer','active');

    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('102','inv-1','INV-1',10,'BDT',10000,-1000,9000,9000,0,0,0,1,
      'posted','2026-07-20T04:00:00.000Z','2026-07-20T04:00:00.000Z','${HASH}');

    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES ('102','line-1','inv-1','other_adjustment',NULL,'LEGACY_USG',1,10000,10000,'${HASH}');

    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
      priority,effective_from,effective_to,status,source_evidence_sha256
    ) VALUES
      ('102','rule-ref',1,'all',NULL,NULL,'prac-ref','referring','commission',
       'basis_points',2500,'remaining_after_performer','deduct','exclude',0,NULL,20,
       '2026-01-01',NULL,'active','${HASH}'),
      ('102','rule-perf',1,'all',NULL,NULL,'prac-perf','performing','commission',
       'fixed',20000,'net_after_discount','deduct','exclude',0,NULL,20,
       '2026-01-01',NULL,'active','${HASH}'),
      ('102','rule-ref-reversed',1,'all',NULL,NULL,'prac-ref','referring','commission',
       'basis_points',2500,'remaining_after_performer','deduct','exclude',0,NULL,20,
       '2026-01-01',NULL,'active','${HASH}');

    INSERT INTO canonical_compensation_accruals (
      tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
      service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
      rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
      gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
      earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
      business_date,payable_projection_guard,source_evidence_sha256
    ) VALUES
      ('102','acc-ref','inv-1','line-1',NULL,'prac-ref','referring','commission',
       'rule-ref',1,'remaining_after_performer','basis_points',2500,'BDT',10000,1000,0,
       2000,7000,1750,0,0,1750,'accrued','2026-07-20T04:00:00.000Z','2026-07-20',1,'${HASH}'),
      ('102','acc-perf','inv-1','line-1',NULL,'prac-perf','performing','commission',
       'rule-perf',1,'net_after_discount','fixed',20000,'BDT',9000,0,0,0,9000,2000,0,
       2000,0,'settled','2026-07-20T04:00:00.000Z','2026-07-20',1,'${HASH}'),
      ('102','acc-cancelled','inv-1','line-1',NULL,'prac-ref','referring','commission',
       'rule-ref-reversed',1,'remaining_after_performer','basis_points',2500,'BDT',10000,1000,0,
       2000,7000,1750,1750,0,0,'reversed','2026-07-20T04:00:00.000Z','2026-07-20',1,'${HASH}');
  `);
}

describe('canonical doctor compensation report', () => {
  it('uses one canonical aggregate for doctor payable, report, and dashboard summaries', async () => {
    const { sqlite, db } = harness();
    seed(sqlite);
    try {
      const report = await getCanonicalDoctorCompensation(db, {
        tenantId: '102',
        startDate: '2026-07-20',
        endDate: '2026-07-20',
      });

      expect(report.rows).toEqual([
        expect.objectContaining({
          practitionerPublicId: 'prac-ref',
          practitionerRole: 'referring',
          accrualCount: 1,
          outstandingCount: 1,
          earnedMinor: 1750,
          adjustedMinor: 0,
          settledMinor: 0,
          payableMinor: 1750,
        }),
        expect.objectContaining({
          practitionerPublicId: 'prac-perf',
          practitionerRole: 'performing',
          accrualCount: 1,
          outstandingCount: 0,
          earnedMinor: 2000,
          settledMinor: 2000,
          payableMinor: 0,
        }),
      ]);
      expect(report.summary).toEqual({
        practitionerCount: 2,
        accrualCount: 2,
        outstandingCount: 1,
        earnedByCurrency: { BDT: 3750 },
        adjustedByCurrency: { BDT: 0 },
        settledByCurrency: { BDT: 2000 },
        payableByCurrency: { BDT: 1750 },
      });
      expect(report.queryContract).toEqual({
        dateBasis: 'compensation_business_date',
        sourceOfTruth: 'canonical_compensation_accruals',
        readOnly: true,
      });
    } finally {
      sqlite.close();
    }
  });
});
