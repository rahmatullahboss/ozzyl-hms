import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { executeLiveCompensationSettlement } from '../../src/lib/canonical/live-compensation-settlement';

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
  sqlite.exec(`CREATE TABLE doctor_commission_settlement_items (id INTEGER PRIMARY KEY, commission_amount REAL NOT NULL DEFAULT 0);`);
  sqlite.exec(readFileSync('migrations/0537_editable_performer_payout_overrides.sql', 'utf8'));
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
    CREATE TABLE legacy_payout_marker (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL
    );
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,version,config_json
    ) VALUES ('100','canonical_financial_dual_write_v1','financial','shadow',1,1,
      '{"tenantScope":["100"],"writePolicy":"strict"}');
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('100','inv-1','INV-1',10,'BDT',100000,-10000,90000,90000,0,0,0,1,
      'posted','2026-07-20T04:00:00.000Z','2026-07-20T04:00:00.000Z','${'d'.repeat(64)}');
    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES ('100','line-1','inv-1','other_adjustment',NULL,'LEGACY_USG',1,100000,100000,'${'e'.repeat(64)}');
    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
      priority,effective_from,effective_to,status,source_evidence_sha256
    ) VALUES ('100','rule-reserve',1,'all',NULL,NULL,NULL,'performing','performer_reserve',
      'fixed',20000,'net_after_discount','deduct','exclude',0,NULL,10,
      '2026-01-01',NULL,'active','${'a'.repeat(64)}');
    INSERT INTO canonical_compensation_accruals (
      tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
      service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
      rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
      gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
      earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
      business_date,payable_projection_guard,source_evidence_sha256
    ) VALUES
      ('100','acc-r1','inv-1','line-1',NULL,NULL,'performing','performer_reserve',
       'rule-reserve',1,'net_after_discount','fixed',20000,'BDT',50000,5000,0,0,
       45000,20000,0,0,20000,'unassigned','2026-07-20T04:00:00.000Z','2026-07-20',1,'${'b'.repeat(64)}'),
      ('100','acc-r2','inv-1','line-1',NULL,NULL,'performing','performer_reserve',
       'rule-reserve',1,'net_after_discount','fixed',20000,'BDT',50000,5000,0,0,
       45000,20000,0,0,20000,'unassigned','2026-07-20T04:00:00.000Z','2026-07-20',1,'${'c'.repeat(64)}');
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('100','compensation_accrual','acc-r1','legacy_diagnostic_performer_reserve','reserve-key-1',
       'diagnostic_performer_reserves','mapped',1,'${'b'.repeat(64)}'),
      ('100','compensation_accrual','acc-r2','legacy_diagnostic_performer_reserve','reserve-key-2',
       'diagnostic_performer_reserves','mapped',1,'${'c'.repeat(64)}');
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

describe('live canonical compensation settlement', () => {
  it('assigns performer reserves, records deductions, and settles remaining payable atomically', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await executeLiveCompensationSettlement(db, {
        tenantId: '100',
        legacyStatements: [
          db.prepare(`INSERT INTO legacy_payout_marker (id,status) VALUES (1,'paid')`),
        ],
        settlementSourceId: 'performer-payout-idem-1',
        settlementNumber: 'DPS-2026-000001',
        practitioner: {
          doctorId: 7,
          displayName: 'Dr Performer',
          specialty: 'Radiology',
          department: 'Diagnostics',
          registrationNumber: 'BMDC-7',
          userId: null,
          isActive: true,
        },
        paymentMethod: 'cash',
        grossAmount: 400,
        netPaidAmount: 350,
        settledAtUtc: '2026-07-20T12:00:00.000Z',
        businessDate: '2026-07-20',
        accruals: [
          {
            sourceType: 'legacy_diagnostic_performer_reserve',
            sourcePublicId: 'reserve-key-1',
            expectedPayableAmount: 200,
          },
          {
            sourceType: 'legacy_diagnostic_performer_reserve',
            sourcePublicId: 'reserve-key-2',
            expectedPayableAmount: 200,
          },
        ],
      });

      expect(result.mode).toBe('strict');
      expect(sqlite.prepare('SELECT status FROM legacy_payout_marker WHERE id=1').get()).toEqual({ status: 'paid' });
      expect(sqlite.prepare(`
        SELECT COUNT(*) count,SUM(adjusted_minor) adjusted_minor,SUM(settled_minor) settled_minor,
               SUM(payable_minor) payable_minor,MIN(status) min_status,MAX(status) max_status,
               COUNT(DISTINCT practitioner_public_id) practitioner_count
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        count: 2,
        adjusted_minor: 5000,
        settled_minor: 35000,
        payable_minor: 0,
        min_status: 'settled',
        max_status: 'settled',
        practitioner_count: 1,
      });
      expect(sqlite.prepare(`
        SELECT total_minor,allocated_minor,net_paid_minor,status
        FROM canonical_compensation_settlements
      `).get()).toEqual({
        total_minor: 35000,
        allocated_minor: 35000,
        net_paid_minor: 35000,
        status: 'posted',
      });
      expect(sqlite.prepare(`
        SELECT COUNT(*) count,SUM(amount_minor) amount_minor,
               MIN(amount_minor) min_amount_minor,MAX(amount_minor) max_amount_minor
        FROM canonical_compensation_settlement_allocations
      `).get()).toEqual({
        count: 2,
        amount_minor: 35000,
        min_amount_minor: 17500,
        max_amount_minor: 17500,
      });
      expect(sqlite.prepare(`
        SELECT COUNT(*) count,SUM(amount_minor) amount_minor,
               MIN(amount_minor) min_amount_minor,MAX(amount_minor) max_amount_minor,
               MIN(adjustment_type) adjustment_type
        FROM canonical_compensation_adjustments
      `).get()).toEqual({
        count: 2,
        amount_minor: 5000,
        min_amount_minor: 2500,
        max_amount_minor: 2500,
        adjustment_type: 'manual_recovery',
      });
    } finally {
      sqlite.close();
    }
  });

  it('reconciles per-line payout increases and decreases before settlement', async () => {
    const { sqlite, db } = harness();
    try {
      await executeLiveCompensationSettlement(db, {
        tenantId: '100',
        legacyStatements: [
          db.prepare(`INSERT INTO legacy_payout_marker (id,status) VALUES (3,'paid')`),
        ],
        settlementSourceId: 'performer-payout-override-1',
        settlementNumber: 'DPS-2026-000003',
        practitioner: {
          doctorId: 7,
          displayName: 'Dr Performer',
          isActive: true,
        },
        paymentMethod: 'cash',
        grossAmount: 450,
        netPaidAmount: 450,
        settledAtUtc: '2026-07-20T12:30:00.000Z',
        businessDate: '2026-07-20',
        accruals: [
          {
            sourceType: 'legacy_diagnostic_performer_reserve',
            sourcePublicId: 'reserve-key-1',
            expectedPayableAmount: 200,
            settlementPayableAmount: 300,
            overrideReason: 'Senior performer fee',
          },
          {
            sourceType: 'legacy_diagnostic_performer_reserve',
            sourcePublicId: 'reserve-key-2',
            expectedPayableAmount: 200,
            settlementPayableAmount: 150,
            overrideReason: 'External hospital allocation',
          },
        ],
      });

      expect(sqlite.prepare(`
        SELECT SUM(earned_minor) earned_minor,SUM(adjusted_minor) adjusted_minor,
               SUM(settled_minor) settled_minor,SUM(payable_minor) payable_minor
        FROM canonical_compensation_accruals
      `).get()).toEqual({
        earned_minor: 50000,
        adjusted_minor: 5000,
        settled_minor: 45000,
        payable_minor: 0,
      });
      expect(sqlite.prepare(`
        SELECT adjustment_type,reason_code,amount_minor,
               accrual_payable_before_minor,accrual_payable_after_minor
        FROM canonical_compensation_adjustments
        ORDER BY amount_minor DESC
      `).all()).toEqual([
        {
          adjustment_type: 'manual_recovery',
          reason_code: 'payout_override_decrease',
          amount_minor: 5000,
          accrual_payable_before_minor: 20000,
          accrual_payable_after_minor: 15000,
        },
      ]);
      expect(sqlite.prepare(`
        SELECT entity_type,source_type,mapping_status
        FROM canonical_source_mappings
        WHERE entity_type='compensation_accrual_override'
      `).all()).toEqual([
        {
          entity_type: 'compensation_accrual_override',
          source_type: 'legacy_performer_payout_override',
          mapping_status: 'mapped',
        },
      ]);
      expect(sqlite.prepare(`
        SELECT total_minor,allocated_minor,net_paid_minor,status
        FROM canonical_compensation_settlements
      `).get()).toEqual({
        total_minor: 45000,
        allocated_minor: 45000,
        net_paid_minor: 45000,
        status: 'posted',
      });
    } finally {
      sqlite.close();
    }
  });

  it('reuses the exact route practitioner mapping instead of creating a numeric-ID duplicate', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_practitioners (
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status
        ) VALUES ('100','pract-route-doctor-7','internal','Dr Route Practitioner','active');
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES (
          '100','practitioner','pract-route-doctor-7','legacy_doctor','doctor-route-key-7',
          'doctors','mapped',1,'${'9'.repeat(64)}'
        );
        UPDATE canonical_compensation_accruals
        SET practitioner_public_id='pract-route-doctor-7',status='accrued';
      `);

      const result = await executeLiveCompensationSettlement(db, {
        tenantId: '100',
        legacyStatements: [
          db.prepare(`INSERT INTO legacy_payout_marker (id,status) VALUES (4,'paid')`),
        ],
        settlementSourceId: 'mapped-practitioner-payout-1',
        settlementNumber: 'DPS-2026-000004',
        practitioner: {
          doctorId: 7,
          canonicalSourceKey: 'doctor-route-key-7',
          displayName: 'Dr Route Practitioner',
          userId: 17,
          isActive: true,
        },
        paymentMethod: 'bank_transfer',
        grossAmount: 400,
        netPaidAmount: 400,
        settledAtUtc: '2026-07-20T14:00:00.000Z',
        businessDate: '2026-07-20',
        accruals: [
          {
            sourceType: 'legacy_diagnostic_performer_reserve',
            sourcePublicId: 'reserve-key-1',
            expectedPayableAmount: 200,
          },
          {
            sourceType: 'legacy_diagnostic_performer_reserve',
            sourcePublicId: 'reserve-key-2',
            expectedPayableAmount: 200,
          },
        ],
      });

      expect(result).toMatchObject({
        mode: 'strict',
        result: { result: { practitionerPublicId: 'pract-route-doctor-7' } },
      });
      expect(sqlite.prepare(`
        SELECT practitioner_public_id FROM canonical_compensation_settlements
      `).get()).toEqual({ practitioner_public_id: 'pract-route-doctor-7' });
      expect(sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_practitioners
      `).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`
        SELECT canonical_public_id FROM canonical_source_mappings
        WHERE entity_type='practitioner' AND source_public_id='doctor-route-key-7'
      `).get()).toEqual({ canonical_public_id: 'pract-route-doctor-7' });
    } finally {
      sqlite.close();
    }
  });

  it('rejects duplicate source aliases that resolve to the same canonical accrual', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES (
          '100','compensation_accrual','acc-r1','legacy_diagnostic_performer_reserve',
          'reserve-key-1-alias','diagnostic_performer_reserves','mapped',1,'${'f'.repeat(64)}'
        );
      `);

      let failure: unknown;
      try {
        await executeLiveCompensationSettlement(db, {
          tenantId: '100',
          legacyStatements: [
            db.prepare(`INSERT INTO legacy_payout_marker (id,status) VALUES (2,'paid')`),
          ],
          settlementSourceId: 'performer-payout-idem-duplicate',
          settlementNumber: 'DPS-2026-000002',
          practitioner: {
            doctorId: 7,
            displayName: 'Dr Performer',
            isActive: true,
          },
          paymentMethod: 'cash',
          grossAmount: 400,
          netPaidAmount: 400,
          settledAtUtc: '2026-07-20T13:00:00.000Z',
          businessDate: '2026-07-20',
          accruals: [
            {
              sourceType: 'legacy_diagnostic_performer_reserve',
              sourcePublicId: 'reserve-key-1',
              expectedPayableAmount: 200,
            },
            {
              sourceType: 'legacy_diagnostic_performer_reserve',
              sourcePublicId: 'reserve-key-1-alias',
              expectedPayableAmount: 200,
            },
          ],
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: 'CANONICAL_STRICT_WRITE_FAILED' });
      expect((failure as Error).cause).toMatchObject({
        message: 'Canonical compensation accrual cannot be selected more than once',
      });

      expect(sqlite.prepare('SELECT COUNT(*) count FROM legacy_payout_marker WHERE id=2').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_compensation_settlements').get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});
