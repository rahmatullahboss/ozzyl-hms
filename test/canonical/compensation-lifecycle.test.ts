import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  accrueCompensation,
  adjustCompensation,
  prepareCompensationAdjustment,
  reverseCompensationSettlement,
  settleCompensation,
} from '../../src/lib/canonical/commands/accrue-compensation';
import { issueCreditNote } from '../../src/lib/canonical/commands/issue-credit-note';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';

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
}

function harness(controls: { beforeBatch?: (sqlite: DatabaseSync) => void } = {}) {
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
    CREATE TABLE diagnostic_performer_reserves (
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE doctor_commission_accruals (
      tenant_id TEXT NOT NULL,
      bill_id INTEGER,
      status TEXT NOT NULL
    );
  `);

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      controls.beforeBatch?.(sqlite);
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

function seedAuthority(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES
      ('tenant-a','prac-performer','internal','Synthetic Performer','active'),
      ('tenant-a','prac-referrer','external','Synthetic Referrer','active'),
      ('tenant-b','prac-other','internal','Other Tenant','active');

    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('tenant-a','svc-1','laboratory','Synthetic Service','service','active','${'1'.repeat(64)}');

    INSERT INTO canonical_service_events (
      tenant_id,event_public_id,service_public_id,event_type,quantity,status,
      occurred_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','evt-1','svc-1','completed',1,'posted','2026-07-14T03:00:00.000Z','${'2'.repeat(64)}');

    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','inv-1','INV-1',10,'BDT',10000,0,10000,0,10000,0,10000,1,
              'posted','2026-07-14T03:00:00.000Z','2026-07-14T03:00:00.000Z','${'3'.repeat(64)}');

    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES ('tenant-a','line-1','inv-1','service','evt-1',1,10000,10000,'${'4'.repeat(64)}');

    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,priority,
      effective_from,effective_to,status,source_evidence_sha256
    ) VALUES
      ('tenant-a','rule-performer',1,'service','svc-1',NULL,'performing','performer_reserve',
       'fixed',2000,'gross','ignore','exclude',0,NULL,10,'2026-01-01',NULL,'active','${'5'.repeat(64)}'),
      ('tenant-a','rule-referrer',1,'service','svc-1','prac-referrer','referring','commission',
       'basis_points',1000,'remaining_after_performer','deduct','include',0,NULL,20,
       '2026-01-01',NULL,'active','${'6'.repeat(64)}');
  `);
}

function accrualInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    accrualPublicId: 'accrual-performer',
    invoicePublicId: 'inv-1',
    invoiceLinePublicId: 'line-1',
    serviceEventPublicId: 'evt-1',
    practitionerPublicId: 'prac-performer',
    practitionerRole: 'performing' as const,
    rulePublicId: 'rule-performer',
    ruleVersion: 1,
    discountAllocatedMinor: 1000,
    taxAllocatedMinor: 500,
    performerReserveMinor: 0,
    accruedAtUtc: '2026-07-14T04:00:00.000Z',
    businessDate: '2026-07-14',
    sourceType: 'runtime_compensation',
    sourcePublicId: 'runtime-accrual-performer',
    sourceTable: 'runtime',
    sourceEvidenceSha256: '7'.repeat(64),
    idempotencyKey: 'accrue-performer',
    outboxEventPublicId: 'outbox-accrue-performer',
    ...overrides,
  };
}

function settlementInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    settlementPublicId: 'settlement-default',
    settlementNumber: 'SET-DEFAULT',
    practitionerPublicId: 'prac-performer',
    currencyCode: 'BDT',
    paymentMethod: 'cash' as const,
    settledAtUtc: '2026-07-14T05:00:00.000Z',
    businessDate: '2026-07-14',
    allocations: [{
      allocationPublicId: 'settle-alloc-default',
      accrualPublicId: 'accrual-performer',
      amountMinor: 2000,
      sourceEvidenceSha256: '9'.repeat(64),
    }],
    sourceType: 'runtime_compensation_settlement',
    sourcePublicId: 'runtime-settlement-default',
    sourceTable: 'runtime',
    sourceEvidenceSha256: 'a'.repeat(64),
    idempotencyKey: 'settle-default',
    outboxEventPublicId: 'outbox-settle-default',
    ...overrides,
  };
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  return Number((sqlite.prepare(sql).get() as { count: number }).count);
}

describe('canonical practitioner compensation', () => {
  it('uses triggerless tenant-safe SQL and Drizzle rule, accrual, settlement, allocation, adjustment, and reversal authorities', () => {
    const migration = readFileSync('migrations/0513_canonical_practitioner_compensation.sql', 'utf8');
    const drizzle = readFileSync('src/db/schema/canonical/compensation.ts', 'utf8');
    const barrel = readFileSync('src/db/schema/canonical/index.ts', 'utf8');
    expect(migration).not.toContain('CREATE TRIGGER');
    for (const table of [
      'canonical_compensation_rules',
      'canonical_compensation_accruals',
      'canonical_compensation_adjustments',
      'canonical_compensation_settlements',
      'canonical_compensation_settlement_allocations',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(drizzle).toContain(`'${table}'`);
    }
    expect(migration).toContain('uq_canonical_compensation_accruals_assigned');
    expect(migration).toContain('uq_canonical_compensation_accruals_unassigned');
    expect(drizzle).toContain('uq_canonical_compensation_accruals_assigned');
    expect(drizzle).toContain('uq_canonical_compensation_accruals_unassigned');
    expect(migration).toContain('payable_projection_guard');
    expect(migration).toContain('settlement_projection_guard');
    expect(drizzle).toContain('payable_projection_guard');
    expect(drizzle).toContain('settlement_projection_guard');
    expect(barrel).toContain("export * from './compensation';");
  });

  it('creates a fixed performer reserve and deterministic remaining-base referral commission', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      await expect(accrueCompensation(db, accrualInput())).resolves.toMatchObject({
        status: 'applied',
        result: { earnedMinor: 2000, payableMinor: 2000, status: 'accrued' },
      });

      await expect(accrueCompensation(db, accrualInput({
        accrualPublicId: 'accrual-referrer',
        practitionerPublicId: 'prac-referrer',
        practitionerRole: 'referring',
        rulePublicId: 'rule-referrer',
        performerReserveMinor: 2000,
        sourcePublicId: 'runtime-accrual-referrer',
        sourceEvidenceSha256: '8'.repeat(64),
        idempotencyKey: 'accrue-referrer',
        outboxEventPublicId: 'outbox-accrue-referrer',
      }))).resolves.toMatchObject({
        status: 'applied',
        result: {
          grossMinor: 10000,
          eligibleBaseMinor: 7500,
          earnedMinor: 750,
          payableMinor: 750,
        },
      });

      expect(sqlite.prepare(`
        SELECT practitioner_role,accrual_stage,eligible_base_minor,earned_minor,payable_minor
        FROM canonical_compensation_accruals ORDER BY accrual_public_id
      `).all()).toEqual([
        {
          practitioner_role: 'performing',
          accrual_stage: 'performer_reserve',
          eligible_base_minor: 10000,
          earned_minor: 2000,
          payable_minor: 2000,
        },
        {
          practitioner_role: 'referring',
          accrual_stage: 'commission',
          eligible_base_minor: 7500,
          earned_minor: 750,
          payable_minor: 750,
        },
      ]);
    } finally { sqlite.close(); }
  });

  it('commits authoritative legacy statements in the same canonical accrual batch', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    sqlite.exec('CREATE TABLE legacy_commission_marker (id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
    try {
      await expect(accrueCompensation(db, accrualInput(), {
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_commission_marker (id, note) VALUES (?, ?)').bind(1, 'legacy committed'),
        ],
      })).resolves.toMatchObject({ status: 'applied' });

      expect(sqlite.prepare('SELECT note FROM legacy_commission_marker WHERE id=1').get()).toEqual({
        note: 'legacy committed',
      });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_compensation_accruals')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('records unassigned performer authority without inferring another practitioner role', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      await expect(accrueCompensation(db, accrualInput({
        accrualPublicId: 'accrual-unassigned',
        practitionerPublicId: null,
        sourcePublicId: 'runtime-accrual-unassigned',
        idempotencyKey: 'accrue-unassigned',
        outboxEventPublicId: 'outbox-accrue-unassigned',
      }))).resolves.toMatchObject({
        status: 'applied',
        result: { status: 'unassigned', earnedMinor: 2000, payableMinor: 2000 },
      });
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

  it('enforces exact replay, semantic conflict, uniqueness, and tenant isolation', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      const input = accrualInput();
      await accrueCompensation(db, input);
      await expect(accrueCompensation(db, input)).resolves.toMatchObject({ status: 'replayed' });
      await expect(accrueCompensation(db, { ...input, discountAllocatedMinor: 500 }))
        .rejects.toThrow(/idempotency/i);
      await expect(accrueCompensation(db, accrualInput({
        accrualPublicId: 'accrual-duplicate',
        sourcePublicId: 'runtime-accrual-duplicate',
        idempotencyKey: 'accrue-duplicate',
        outboxEventPublicId: 'outbox-accrue-duplicate',
      }))).rejects.toThrow(/UNIQUE constraint failed/);
      await expect(accrueCompensation(db, accrualInput({
        accrualPublicId: 'accrual-cross',
        practitionerPublicId: 'prac-other',
        sourcePublicId: 'runtime-accrual-cross',
        idempotencyKey: 'accrue-cross',
        outboxEventPublicId: 'outbox-accrue-cross',
      }))).rejects.toThrow(/practitioner not found/i);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_compensation_accruals`)).toBe(1);
    } finally { sqlite.close(); }
  });

  it('settles an accrual partially and fully without paying it twice', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      await accrueCompensation(db, accrualInput());
      await expect(settleCompensation(db, {
        tenantId: 'tenant-a',
        settlementPublicId: 'settlement-1',
        settlementNumber: 'SET-1',
        practitionerPublicId: 'prac-performer',
        currencyCode: 'BDT',
        paymentMethod: 'cash',
        settledAtUtc: '2026-07-14T05:00:00.000Z',
        businessDate: '2026-07-14',
        allocations: [{
          allocationPublicId: 'settle-alloc-1',
          accrualPublicId: 'accrual-performer',
          amountMinor: 750,
          sourceEvidenceSha256: '9'.repeat(64),
        }],
        sourceType: 'runtime_compensation_settlement',
        sourcePublicId: 'runtime-settlement-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'a'.repeat(64),
        idempotencyKey: 'settle-1',
        outboxEventPublicId: 'outbox-settle-1',
      })).resolves.toMatchObject({ status: 'applied', result: { totalMinor: 750 } });

      await settleCompensation(db, {
        tenantId: 'tenant-a',
        settlementPublicId: 'settlement-2',
        settlementNumber: 'SET-2',
        practitionerPublicId: 'prac-performer',
        currencyCode: 'BDT',
        paymentMethod: 'bank_transfer',
        settledAtUtc: '2026-07-14T06:00:00.000Z',
        businessDate: '2026-07-14',
        allocations: [{
          allocationPublicId: 'settle-alloc-2',
          accrualPublicId: 'accrual-performer',
          amountMinor: 1250,
          sourceEvidenceSha256: 'b'.repeat(64),
        }],
        sourceType: 'runtime_compensation_settlement',
        sourcePublicId: 'runtime-settlement-2',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'c'.repeat(64),
        idempotencyKey: 'settle-2',
        outboxEventPublicId: 'outbox-settle-2',
      });

      expect(sqlite.prepare(`
        SELECT settled_minor,payable_minor,status
        FROM canonical_compensation_accruals WHERE accrual_public_id='accrual-performer'
      `).get()).toEqual({ settled_minor: 2000, payable_minor: 0, status: 'settled' });

      await expect(settleCompensation(db, {
        tenantId: 'tenant-a',
        settlementPublicId: 'settlement-3',
        settlementNumber: 'SET-3',
        practitionerPublicId: 'prac-performer',
        currencyCode: 'BDT',
        paymentMethod: 'cash',
        settledAtUtc: '2026-07-14T07:00:00.000Z',
        businessDate: '2026-07-14',
        allocations: [{
          allocationPublicId: 'settle-alloc-3',
          accrualPublicId: 'accrual-performer',
          amountMinor: 1,
          sourceEvidenceSha256: 'd'.repeat(64),
        }],
        sourceType: 'runtime_compensation_settlement',
        sourcePublicId: 'runtime-settlement-3',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'e'.repeat(64),
        idempotencyKey: 'settle-3',
        outboxEventPublicId: 'outbox-settle-3',
      })).rejects.toThrow(/payable/i);
    } finally { sqlite.close(); }
  });

  it('rolls back settlement authority when the accrual changes after command validation', async () => {
    let mutate = false;
    const { sqlite, db } = harness({
      beforeBatch(database) {
        if (!mutate) return;
        mutate = false;
        database.prepare(`
          UPDATE canonical_compensation_accruals
          SET settled_minor=500,payable_minor=1500,status='partially_settled'
          WHERE tenant_id='tenant-a' AND accrual_public_id='accrual-performer'
        `).run();
      },
    });
    seedAuthority(sqlite);
    try {
      await accrueCompensation(db, accrualInput());
      mutate = true;
      await expect(settleCompensation(db, settlementInput({
        settlementPublicId: 'settlement-stale',
        settlementNumber: 'SET-STALE',
        allocations: [{
          allocationPublicId: 'settle-alloc-stale',
          accrualPublicId: 'accrual-performer',
          amountMinor: 2000,
          sourceEvidenceSha256: 'b'.repeat(64),
        }],
        sourcePublicId: 'runtime-settlement-stale',
        sourceEvidenceSha256: 'c'.repeat(64),
        idempotencyKey: 'settle-stale',
        outboxEventPublicId: 'outbox-settle-stale',
      }))).rejects.toThrow(/guard|CHECK constraint|payable/i);

      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_compensation_settlements`)).toBe(0);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_compensation_settlement_allocations`)).toBe(0);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_outbox_events WHERE idempotency_key='settle-stale'`)).toBe(0);
      expect(sqlite.prepare(`
        SELECT settled_minor,payable_minor,status
        FROM canonical_compensation_accruals WHERE accrual_public_id='accrual-performer'
      `).get()).toEqual({ settled_minor: 500, payable_minor: 1500, status: 'partially_settled' });
    } finally { sqlite.close(); }
  });

  it('rolls back settlement, allocation, mapping, and payable projection when outbox identity conflicts', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      await accrueCompensation(db, accrualInput());
      sqlite.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          payload_json,occurred_at_utc,idempotency_key,status
        ) VALUES ('tenant-a','outbox-settle-conflict','existing','existing','existing.event',
                  '{}','2026-07-14T03:00:00.000Z','existing-settlement-event','pending')
      `).run();

      await expect(settleCompensation(db, settlementInput({
        settlementPublicId: 'settlement-conflict',
        settlementNumber: 'SET-CONFLICT',
        allocations: [{
          allocationPublicId: 'settle-alloc-conflict',
          accrualPublicId: 'accrual-performer',
          amountMinor: 2000,
          sourceEvidenceSha256: 'd'.repeat(64),
        }],
        sourcePublicId: 'runtime-settlement-conflict',
        sourceEvidenceSha256: 'e'.repeat(64),
        idempotencyKey: 'settle-conflict',
        outboxEventPublicId: 'outbox-settle-conflict',
      }))).rejects.toThrow(/UNIQUE constraint failed/);

      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_compensation_settlements`)).toBe(0);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_compensation_settlement_allocations`)).toBe(0);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='compensation_settlement'`)).toBe(0);
      expect(sqlite.prepare(`
        SELECT settled_minor,payable_minor,status
        FROM canonical_compensation_accruals WHERE accrual_public_id='accrual-performer'
      `).get()).toEqual({ settled_minor: 0, payable_minor: 2000, status: 'accrued' });
    } finally { sqlite.close(); }
  });

  it('blocks invoice credit while canonical compensation has settled liability', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      await accrueCompensation(db, accrualInput());
      await settleCompensation(db, {
        tenantId: 'tenant-a',
        settlementPublicId: 'settlement-credit-guard',
        settlementNumber: 'SET-CREDIT-GUARD',
        practitionerPublicId: 'prac-performer',
        currencyCode: 'BDT',
        paymentMethod: 'cash',
        settledAtUtc: '2026-07-14T05:00:00.000Z',
        businessDate: '2026-07-14',
        allocations: [{
          allocationPublicId: 'settle-alloc-credit-guard',
          accrualPublicId: 'accrual-performer',
          amountMinor: 500,
          sourceEvidenceSha256: 'd'.repeat(64),
        }],
        sourceType: 'runtime_compensation_settlement',
        sourcePublicId: 'runtime-settlement-credit-guard',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'e'.repeat(64),
        idempotencyKey: 'settle-credit-guard',
        outboxEventPublicId: 'outbox-settle-credit-guard',
      });

      await expect(issueCreditNote(db, {
        tenantId: 'tenant-a',
        creditNotePublicId: 'credit-compensation-guard',
        creditNoteNumber: 'CN-COMP-GUARD',
        invoicePublicId: 'inv-1',
        reasonCode: 'SERVICE_ADJUSTMENT',
        issuedAtUtc: '2026-07-14T06:00:00.000Z',
        businessDate: '2026-07-14',
        lines: [{
          creditLinePublicId: 'credit-line-compensation-guard',
          invoiceLinePublicId: 'line-1',
          amountMinor: 500,
          reasonCode: 'SERVICE_ADJUSTMENT',
          sourceEvidenceSha256: 'f'.repeat(64),
        }],
        sourceType: 'runtime_credit_note',
        sourcePublicId: 'runtime-credit-compensation-guard',
        sourceTable: 'runtime',
        sourceEvidenceSha256: '0'.repeat(64),
        idempotencyKey: 'credit-compensation-guard',
        outboxEventPublicId: 'outbox-credit-compensation-guard',
      })).rejects.toThrow(/compensation|paid|settlement/i);
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_credit_notes`)).toBe(0);
    } finally { sqlite.close(); }
  });

  it('prepares compatibility and compensation adjustment for one outer atomic batch', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      await accrueCompensation(db, accrualInput());
      sqlite.prepare(`
        INSERT INTO diagnostic_performer_reserves (tenant_id,bill_id,status)
        VALUES ('tenant-a',1,'reserved')
      `).run();
      const input = {
        tenantId: 'tenant-a',
        adjustmentPublicId: 'comp-adjustment-prepared',
        accrualPublicId: 'accrual-performer',
        adjustmentType: 'service_cancellation' as const,
        amountMinor: 2000,
        reasonCode: 'SERVICE_CANCELLED',
        occurredAtUtc: '2026-07-14T06:00:00.000Z',
        businessDate: '2026-07-14',
        sourceType: 'runtime_compensation_adjustment',
        sourcePublicId: 'runtime-adjustment-prepared',
        sourceTable: 'diagnostic_performer_reserves',
        sourceEvidenceSha256: '7'.repeat(64),
        idempotencyKey: 'adjust-compensation-prepared',
        outboxEventPublicId: 'outbox-adjust-compensation-prepared',
      };
      const prepared = await prepareCompensationAdjustment(db, input, {
        authoritativeStatements: [db.prepare(`
          UPDATE diagnostic_performer_reserves
          SET status='cancelled'
          WHERE tenant_id='tenant-a' AND bill_id=1 AND status='reserved'
        `)],
      });
      expect(prepared.status).toBe('prepared');
      expect(sqlite.prepare(`SELECT status FROM diagnostic_performer_reserves`).get())
        .toEqual({ status: 'reserved' });

      await db.batch([...prepared.statements]);
      expect(sqlite.prepare(`SELECT status FROM diagnostic_performer_reserves`).get())
        .toEqual({ status: 'cancelled' });
      expect(sqlite.prepare(`
        SELECT adjusted_minor,payable_minor,status
        FROM canonical_compensation_accruals
        WHERE accrual_public_id='accrual-performer'
      `).get()).toEqual({ adjusted_minor: 2000, payable_minor: 0, status: 'reversed' });

      const replay = await prepareCompensationAdjustment(db, input);
      expect(replay).toMatchObject({ status: 'replayed', statements: [] });
    } finally { sqlite.close(); }
  });

  it('requires explicit settlement reversal before reducing paid compensation', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      await accrueCompensation(db, accrualInput());
      await settleCompensation(db, {
        tenantId: 'tenant-a',
        settlementPublicId: 'settlement-paid',
        settlementNumber: 'SET-PAID',
        practitionerPublicId: 'prac-performer',
        currencyCode: 'BDT',
        paymentMethod: 'cash',
        settledAtUtc: '2026-07-14T05:00:00.000Z',
        businessDate: '2026-07-14',
        allocations: [{
          allocationPublicId: 'settle-alloc-paid',
          accrualPublicId: 'accrual-performer',
          amountMinor: 2000,
          sourceEvidenceSha256: 'f'.repeat(64),
        }],
        sourceType: 'runtime_compensation_settlement',
        sourcePublicId: 'runtime-settlement-paid',
        sourceTable: 'runtime',
        sourceEvidenceSha256: '0'.repeat(64),
        idempotencyKey: 'settle-paid',
        outboxEventPublicId: 'outbox-settle-paid',
      });

      const adjustment = {
        tenantId: 'tenant-a',
        adjustmentPublicId: 'comp-adjustment-1',
        accrualPublicId: 'accrual-performer',
        adjustmentType: 'refund' as const,
        amountMinor: 500,
        reasonCode: 'PATIENT_REFUND',
        occurredAtUtc: '2026-07-14T06:00:00.000Z',
        businessDate: '2026-07-14',
        sourceType: 'runtime_compensation_adjustment',
        sourcePublicId: 'runtime-adjustment-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: '1'.repeat(64),
        idempotencyKey: 'adjust-compensation-1',
        outboxEventPublicId: 'outbox-adjust-compensation-1',
      };
      await expect(adjustCompensation(db, adjustment)).rejects.toThrow(/settlement reversal/i);

      await expect(reverseCompensationSettlement(db, {
        tenantId: 'tenant-a',
        reversalPublicId: 'settlement-reversal-1',
        settlementPublicId: 'settlement-paid',
        settlementAllocationPublicId: 'settle-alloc-paid',
        amountMinor: 500,
        reasonCode: 'REFUND_RECOVERY',
        reversedAtUtc: '2026-07-14T06:10:00.000Z',
        businessDate: '2026-07-14',
        sourceType: 'runtime_compensation_settlement_reversal',
        sourcePublicId: 'runtime-settlement-reversal-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: '2'.repeat(64),
        idempotencyKey: 'reverse-settlement-1',
        outboxEventPublicId: 'outbox-reverse-settlement-1',
      })).resolves.toMatchObject({
        status: 'applied',
        result: { reversedMinor: 500, accrualPayableMinor: 500 },
      });

      await expect(adjustCompensation(db, adjustment)).resolves.toMatchObject({
        status: 'applied',
        result: { adjustedMinor: 500, payableMinor: 0 },
      });
      expect(sqlite.prepare(`
        SELECT earned_minor,adjusted_minor,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals WHERE accrual_public_id='accrual-performer'
      `).get()).toEqual({
        earned_minor: 2000,
        adjusted_minor: 500,
        settled_minor: 1500,
        payable_minor: 0,
        status: 'settled',
      });
    } finally { sqlite.close(); }
  });
});
