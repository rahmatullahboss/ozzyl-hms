import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { executeLiveCancelledCompensationSettlementReversal } from '../../src/lib/canonical/live-compensation-settlement-reversal';

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
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_reversal_marker (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL
    );
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,version,config_json
    ) VALUES ('100','canonical_financial_dual_write_v1','financial','shadow',1,1,
      '{"tenantScope":["100"],"writePolicy":"strict"}');
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('100','prac-7','external','Dr Performer','active');
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('100','inv-1','INV-1',10,'BDT',50000,0,50000,50000,0,0,0,1,
      'posted','2026-07-20T04:00:00.000Z','2026-07-20T04:00:00.000Z','${'a'.repeat(64)}');
    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES ('100','line-1','inv-1','other_adjustment',NULL,'LEGACY_USG',1,50000,50000,'${'b'.repeat(64)}');
    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
      priority,effective_from,effective_to,status,source_evidence_sha256
    ) VALUES ('100','rule-1',1,'all',NULL,NULL,NULL,'performing','performer_reserve',
      'fixed',20000,'net_after_discount','deduct','exclude',0,NULL,10,
      '2026-01-01',NULL,'active','${'c'.repeat(64)}');
    INSERT INTO canonical_compensation_accruals (
      tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
      service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
      rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
      gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
      earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
      business_date,payable_projection_guard,source_evidence_sha256
    ) VALUES ('100','acc-1','inv-1','line-1',NULL,'prac-7','performing','performer_reserve',
      'rule-1',1,'net_after_discount','fixed',20000,'BDT',50000,0,0,0,50000,
      20000,2500,17500,0,'settled','2026-07-20T04:00:00.000Z','2026-07-20',1,'${'d'.repeat(64)}');
    INSERT INTO canonical_compensation_settlements (
      tenant_id,settlement_public_id,settlement_number,practitioner_public_id,
      currency_code,payment_method,total_minor,allocated_minor,reversed_minor,
      net_paid_minor,status,settled_at_utc,business_date,reversed_at_utc,
      settlement_projection_guard,source_evidence_sha256
    ) VALUES ('100','set-1','DPS-1','prac-7','BDT','cash',17500,17500,0,17500,
      'posted','2026-07-20T05:00:00.000Z','2026-07-20',NULL,1,'${'e'.repeat(64)}');
    INSERT INTO canonical_compensation_settlement_allocations (
      tenant_id,allocation_public_id,settlement_public_id,accrual_public_id,
      amount_minor,reversed_minor,remaining_minor,accrual_settled_before_minor,
      accrual_settled_after_minor,accrual_payable_before_minor,
      accrual_payable_after_minor,status,allocated_at_utc,reversed_at_utc,
      balance_guard,source_evidence_sha256
    ) VALUES ('100','alloc-1','set-1','acc-1',17500,0,17500,0,17500,17500,0,
      'active','2026-07-20T05:00:00.000Z',NULL,1,'${'f'.repeat(64)}');
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('100','compensation_settlement','set-1','legacy_doctor_commission_settlement',
      'payout-idem-1','doctor_commission_settlements','mapped',1,'${'e'.repeat(64)}');
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

describe('cancelled canonical compensation settlement reversal', () => {
  it('reverses cash settlement and cancels the restored payable in one transaction', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await executeLiveCancelledCompensationSettlementReversal(db, {
        tenantId: '100',
        legacyStatements: [
          db.prepare(`INSERT INTO legacy_reversal_marker (id,status) VALUES (1,'reversed')`),
        ],
        settlementSourceId: 'payout-idem-1',
        reversalSourceId: 'reversal-idem-1',
        reasonCode: 'performer_payout_cancelled',
        reversedAtUtc: '2026-07-20T06:00:00.000Z',
        businessDate: '2026-07-20',
      });

      expect(result.mode).toBe('strict');
      expect(sqlite.prepare('SELECT status FROM legacy_reversal_marker WHERE id=1').get()).toEqual({ status: 'reversed' });
      expect(sqlite.prepare(`
        SELECT reversed_minor,net_paid_minor,status
        FROM canonical_compensation_settlements
      `).get()).toEqual({
        reversed_minor: 17500,
        net_paid_minor: 0,
        status: 'reversed',
      });
      expect(sqlite.prepare(`
        SELECT reversed_minor,remaining_minor,status
        FROM canonical_compensation_settlement_allocations
      `).get()).toEqual({
        reversed_minor: 17500,
        remaining_minor: 0,
        status: 'reversed',
      });
      expect(sqlite.prepare(`
        SELECT earned_minor,adjusted_minor,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        earned_minor: 20000,
        adjusted_minor: 20000,
        settled_minor: 0,
        payable_minor: 0,
        status: 'reversed',
      });
      expect(sqlite.prepare(`
        SELECT COUNT(*) count,SUM(amount_minor) amount_minor,
               GROUP_CONCAT(adjustment_type, ',') types
        FROM canonical_compensation_adjustments
      `).get()).toEqual({
        count: 2,
        amount_minor: 35000,
        types: 'settlement_reversal,manual_recovery',
      });
    } finally {
      sqlite.close();
    }
  });
});
