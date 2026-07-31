import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  accrueCompensation,
  settleCompensation,
} from '../../src/lib/canonical/commands/accrue-compensation';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  cancelDoctorCommissionAccrualsWithCanonicalAdjustment,
  cancelPerformerReservesWithCanonicalAdjustment,
} from '../../src/lib/canonical/compensation-accrual-route-integration';


type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.sqlite.prepare(this.sql).all(...this.params) as T[] };
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
    '0532_canonical_financial_batch_assertions.sql',
  ]) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE diagnostic_performer_reserves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      invoice_item_id INTEGER NOT NULL,
      unit_sequence INTEGER NOT NULL,
      reserved_amount REAL NOT NULL,
      status TEXT NOT NULL,
      canonical_source_key TEXT,
      cancelled_at TEXT,
      cancelled_by INTEGER,
      cancel_reason TEXT,
      updated_at TEXT
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      patient_id INTEGER,
      visit_id INTEGER,
      bill_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      gross_amount REAL NOT NULL,
      commission_amount REAL NOT NULL,
      earned_commission_amount REAL NOT NULL DEFAULT 0,
      doctor_waiver_amount REAL NOT NULL DEFAULT 0,
      payable_commission_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      canonical_source_key TEXT,
      notes TEXT,
      updated_at TEXT
    );
    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE(tenant_id,source_event_key)
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );
  `);
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
  } satisfies CanonicalBatchDatabase;
  return { sqlite, db: db as CanonicalBatchDatabase & D1Database };
}

const HASH = 'a'.repeat(64);

function seedFoundation(sqlite: DatabaseSync, lineCount = 1): void {
  sqlite.exec(`
    INSERT INTO canonical_feature_flags(
      tenant_id,flag_key,domain,mode,is_enabled,version,config_json
    ) VALUES (
      '100','canonical_financial_dual_write_v1','financial','shadow',1,1,
      '{"tenantScope":["100"],"writePolicy":"strict"}'
    );
    INSERT INTO canonical_service_catalog_items(
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('100','svc-reserve','laboratory','Reserve Service','service','active','${HASH}');
    INSERT INTO canonical_invoices(
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES (
      '100','inv-reserve','INV-RESERVE',10,'BDT',${lineCount * 2000},0,${lineCount * 2000},0,
      ${lineCount * 2000},0,${lineCount * 2000},1,'posted','2026-07-29T02:00:00.000Z',
      '2026-07-29T02:00:00.000Z','${HASH}'
    );
    INSERT INTO canonical_compensation_rules(
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
      priority,effective_from,effective_to,status,source_evidence_sha256
    ) VALUES (
      '100','rule-reserve',1,'service','svc-reserve',NULL,NULL,'performing',
      'performer_reserve','fixed',2000,'gross','ignore','exclude',0,NULL,10,
      '2026-01-01',NULL,'active','${HASH}'
    );
  `);
  for (let index = 1; index <= lineCount; index += 1) {
    sqlite.prepare(`
      INSERT INTO canonical_service_events(
        tenant_id,event_public_id,service_public_id,event_type,quantity,status,
        occurred_at_utc,source_evidence_sha256
      ) VALUES ('100',?,'svc-reserve','accepted',1,'posted','2026-07-29T02:00:00.000Z',?)
    `).run(`evt-reserve-${index}`, HASH);
    sqlite.prepare(`
      INSERT INTO canonical_invoice_lines(
        tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
        quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
      ) VALUES ('100',?,'inv-reserve','service',?,1,2000,2000,?)
    `).run(`line-reserve-${index}`, `evt-reserve-${index}`, HASH);
  }
}

async function seedAccrual(
  db: CanonicalBatchDatabase,
  index: number,
  sourceKey: string,
): Promise<void> {
  await accrueCompensation(db, {
    tenantId: '100',
    accrualPublicId: `accrual-reserve-${index}`,
    invoicePublicId: 'inv-reserve',
    invoiceLinePublicId: `line-reserve-${index}`,
    serviceEventPublicId: `evt-reserve-${index}`,
    practitionerPublicId: null,
    practitionerRole: 'performing',
    rulePublicId: 'rule-reserve',
    ruleVersion: 1,
    discountAllocatedMinor: 0,
    taxAllocatedMinor: 0,
    performerReserveMinor: 0,
    accruedAtUtc: '2026-07-29T02:00:00.000Z',
    businessDate: '2026-07-29',
    sourceType: 'legacy_diagnostic_performer_reserve',
    sourcePublicId: sourceKey,
    sourceTable: 'diagnostic_performer_reserves',
    sourceEvidenceSha256: HASH,
    idempotencyKey: `reserve-accrual-${index}`,
    outboxEventPublicId: `outbox-reserve-accrual-${index}`,
  });
}

function insertReserve(
  sqlite: DatabaseSync,
  input: { invoiceItemId: number; unitSequence: number; sourceKey: string },
): number {
  const result = sqlite.prepare(`
    INSERT INTO diagnostic_performer_reserves(
      tenant_id,bill_id,invoice_item_id,unit_sequence,reserved_amount,status,
      canonical_source_key,updated_at
    ) VALUES ('100',7001,?,?,20,'reserved',?,'2026-07-29T02:00:00.000Z')
  `).run(input.invoiceItemId, input.unitSequence, input.sourceKey);
  return Number(result.lastInsertRowid);
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  return Number((sqlite.prepare(sql).get() as { count: number }).count);
}

describe('protected performer reserve cancellation integration', () => {
  it('commits guarded legacy cancellation, audit and Canonical adjustment atomically', async () => {
    const { sqlite, db } = harness();
    try {
      seedFoundation(sqlite);
      await seedAccrual(db, 1, 'reserve-source-1');
      const reserveId = insertReserve(sqlite, {
        invoiceItemId: 301,
        unitSequence: 1,
        sourceKey: 'reserve-source-1',
      });

      const changed = await cancelPerformerReservesWithCanonicalAdjustment(db, {
        tenantId: '100',
        billId: 7001,
        invoiceItemIds: [301],
        reason: 'Test cancelled',
        userId: 7,
        cancelledAtUtc: '2026-07-29T03:00:00.000Z',
        businessDate: '2026-07-29',
      });

      expect(changed).toBe(1);
      expect(sqlite.prepare(`
        SELECT status,cancelled_by,cancel_reason,canonical_source_key
        FROM diagnostic_performer_reserves WHERE id=?
      `).get(reserveId)).toEqual({
        status: 'cancelled',
        cancelled_by: 7,
        cancel_reason: 'Test cancelled',
        canonical_source_key: 'reserve-source-1',
      });
      expect(sqlite.prepare(`
        SELECT adjusted_minor,payable_minor,status
        FROM canonical_compensation_accruals
        WHERE accrual_public_id='accrual-reserve-1'
      `).get()).toEqual({ adjusted_minor: 2000, payable_minor: 0, status: 'reversed' });
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_compensation_adjustments`)).toBe(1);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM audit_logs`)).toBe(1);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_financial_batch_assertions`)).toBe(0);
    } finally { sqlite.close(); }
  });

  it('fails closed without an exact accrual mapping and leaves compatibility untouched', async () => {
    const { sqlite, db } = harness();
    try {
      seedFoundation(sqlite);
      insertReserve(sqlite, {
        invoiceItemId: 301,
        unitSequence: 1,
        sourceKey: 'missing-source',
      });

      await expect(cancelPerformerReservesWithCanonicalAdjustment(db, {
        tenantId: '100',
        billId: 7001,
        invoiceItemIds: [301],
        reason: 'No mapping',
        userId: 7,
        cancelledAtUtc: '2026-07-29T03:00:00.000Z',
        businessDate: '2026-07-29',
      })).rejects.toThrow(/strict financial write failed/i);

      expect(sqlite.prepare(`SELECT status FROM diagnostic_performer_reserves`).get())
        .toEqual({ status: 'reserved' });
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM audit_logs`)).toBe(0);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_compensation_adjustments`)).toBe(0);
    } finally { sqlite.close(); }
  });

  it('requires settlement reversal before cancelling paid compensation', async () => {
    const { sqlite, db } = harness();
    try {
      seedFoundation(sqlite);
      sqlite.exec(`
        INSERT INTO canonical_practitioners(
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status
        ) VALUES ('100','prac-paid','internal','Paid Performer','active');
        UPDATE canonical_compensation_rules
        SET practitioner_public_id='prac-paid'
        WHERE tenant_id='100' AND rule_public_id='rule-reserve';
      `);
      await accrueCompensation(db, {
        tenantId: '100',
        accrualPublicId: 'accrual-reserve-1',
        invoicePublicId: 'inv-reserve',
        invoiceLinePublicId: 'line-reserve-1',
        serviceEventPublicId: 'evt-reserve-1',
        practitionerPublicId: 'prac-paid',
        practitionerRole: 'performing',
        rulePublicId: 'rule-reserve',
        ruleVersion: 1,
        discountAllocatedMinor: 0,
        taxAllocatedMinor: 0,
        performerReserveMinor: 0,
        accruedAtUtc: '2026-07-29T02:00:00.000Z',
        businessDate: '2026-07-29',
        sourceType: 'legacy_diagnostic_performer_reserve',
        sourcePublicId: 'reserve-source-1',
        sourceTable: 'diagnostic_performer_reserves',
        sourceEvidenceSha256: HASH,
        idempotencyKey: 'reserve-accrual-paid',
        outboxEventPublicId: 'outbox-reserve-accrual-paid',
      });
      await settleCompensation(db, {
        tenantId: '100',
        settlementPublicId: 'settlement-paid',
        settlementNumber: 'SET-PAID',
        practitionerPublicId: 'prac-paid',
        currencyCode: 'BDT',
        paymentMethod: 'cash',
        settledAtUtc: '2026-07-29T02:30:00.000Z',
        businessDate: '2026-07-29',
        allocations: [{
          allocationPublicId: 'allocation-paid',
          accrualPublicId: 'accrual-reserve-1',
          amountMinor: 1000,
          sourceEvidenceSha256: HASH,
        }],
        sourceType: 'runtime_settlement',
        sourcePublicId: 'settlement-paid',
        sourceTable: 'runtime',
        sourceEvidenceSha256: HASH,
        idempotencyKey: 'settlement-paid',
        outboxEventPublicId: 'outbox-settlement-paid',
      });
      insertReserve(sqlite, {
        invoiceItemId: 301,
        unitSequence: 1,
        sourceKey: 'reserve-source-1',
      });

      await expect(cancelPerformerReservesWithCanonicalAdjustment(db, {
        tenantId: '100',
        billId: 7001,
        invoiceItemIds: [301],
        reason: 'Paid cancellation',
        userId: 7,
        cancelledAtUtc: '2026-07-29T03:00:00.000Z',
        businessDate: '2026-07-29',
      })).rejects.toThrow(/strict financial write failed/i);

      expect(sqlite.prepare(`SELECT status FROM diagnostic_performer_reserves`).get())
        .toEqual({ status: 'reserved' });
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_compensation_adjustments`)).toBe(0);
    } finally { sqlite.close(); }
  });

  it('cancels mapped doctor commission with accounting, audit and Canonical adjustment atomically', async () => {
    const { sqlite, db } = harness();
    try {
      seedFoundation(sqlite);
      sqlite.exec(`
        INSERT INTO canonical_practitioners(
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status
        ) VALUES ('100','prac-doctor','internal','Commission Doctor','active');
      `);
      await accrueCompensation(db, {
        tenantId: '100',
        accrualPublicId: 'accrual-doctor-1',
        invoicePublicId: 'inv-reserve',
        invoiceLinePublicId: 'line-reserve-1',
        serviceEventPublicId: 'evt-reserve-1',
        practitionerPublicId: 'prac-doctor',
        practitionerRole: 'performing',
        rulePublicId: 'rule-reserve',
        ruleVersion: 1,
        discountAllocatedMinor: 0,
        taxAllocatedMinor: 0,
        performerReserveMinor: 0,
        accruedAtUtc: '2026-07-29T02:00:00.000Z',
        businessDate: '2026-07-29',
        sourceType: 'legacy_doctor_commission_accrual',
        sourcePublicId: 'doctor-accrual-source-1',
        sourceTable: 'doctor_commission_accruals',
        sourceEvidenceSha256: HASH,
        idempotencyKey: 'doctor-accrual-1',
        outboxEventPublicId: 'outbox-doctor-accrual-1',
      });
      sqlite.exec(`
        INSERT INTO doctor_commission_accruals(
          tenant_id,doctor_id,patient_id,visit_id,bill_id,source_type,gross_amount,
          commission_amount,earned_commission_amount,doctor_waiver_amount,
          payable_commission_amount,paid_amount,status,canonical_source_key,updated_at
        ) VALUES (
          '100',77,10,20,7001,'lab_test',20,20,20,0,20,0,'accrued',
          'doctor-accrual-source-1','2026-07-29 08:00:00'
        );
      `);

      const changed = await cancelDoctorCommissionAccrualsWithCanonicalAdjustment(db, {
        tenantId: '100',
        billId: 7001,
        sourceTypes: ['lab_test'],
        reason: 'Lab item cancelled',
        userId: 7,
        cancelledAtUtc: '2026-07-29T03:00:00.000Z',
        businessDate: '2026-07-29',
      });

      expect(changed).toBe(1);
      expect(sqlite.prepare(`SELECT status FROM doctor_commission_accruals`).get())
        .toEqual({ status: 'cancelled' });
      expect(sqlite.prepare(`
        SELECT adjusted_minor,payable_minor,status
        FROM canonical_compensation_accruals WHERE accrual_public_id='accrual-doctor-1'
      `).get()).toEqual({ adjusted_minor: 2000, payable_minor: 0, status: 'reversed' });
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM accounting_posting_events`)).toBe(1);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM audit_logs`)).toBe(1);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_compensation_adjustments`)).toBe(1);
    } finally { sqlite.close(); }
  });

  it('selects the first requested reserve units deterministically', async () => {
    const { sqlite, db } = harness();
    try {
      seedFoundation(sqlite, 2);
      await seedAccrual(db, 1, 'reserve-source-1');
      await seedAccrual(db, 2, 'reserve-source-2');
      insertReserve(sqlite, { invoiceItemId: 301, unitSequence: 1, sourceKey: 'reserve-source-1' });
      insertReserve(sqlite, { invoiceItemId: 301, unitSequence: 2, sourceKey: 'reserve-source-2' });

      const changed = await cancelPerformerReservesWithCanonicalAdjustment(db, {
        tenantId: '100',
        billId: 7001,
        quantities: [{ invoiceItemId: 301, quantity: 1 }],
        reason: 'Partial cancellation',
        userId: 7,
        cancelledAtUtc: '2026-07-29T03:00:00.000Z',
        businessDate: '2026-07-29',
      });

      expect(changed).toBe(1);
      expect(sqlite.prepare(`
        SELECT unit_sequence,status FROM diagnostic_performer_reserves ORDER BY unit_sequence
      `).all()).toEqual([
        { unit_sequence: 1, status: 'cancelled' },
        { unit_sequence: 2, status: 'reserved' },
      ]);
      expect(sqlite.prepare(`
        SELECT accrual_public_id,adjusted_minor,payable_minor
        FROM canonical_compensation_accruals ORDER BY accrual_public_id
      `).all()).toEqual([
        { accrual_public_id: 'accrual-reserve-1', adjusted_minor: 2000, payable_minor: 0 },
        { accrual_public_id: 'accrual-reserve-2', adjusted_minor: 0, payable_minor: 2000 },
      ]);
    } finally { sqlite.close(); }
  });
});
