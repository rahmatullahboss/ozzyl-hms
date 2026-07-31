import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { cancelUnpaidInvoice } from '../../src/lib/canonical/commands/cancel-invoice';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.database, this.sql, values.map((value) => value === undefined ? null : value) as SqlValue[]);
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
    CREATE TABLE legacy_financial (
      tenant_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL,
      UNIQUE (tenant_id, source_id)
    );
    INSERT INTO legacy_financial VALUES ('tenant-a','bill-1','open');

    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('tenant-a','prac-1','internal','Synthetic Practitioner','active');

    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('tenant-a','svc-1','consultation','Synthetic Service','service','active','${'2'.repeat(64)}');

    INSERT INTO canonical_service_events (
      tenant_id,event_public_id,service_public_id,event_type,quantity,status,
      occurred_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','evt-1','svc-1','completed',1,'posted','2026-07-23T03:00:00.000Z','${'3'.repeat(64)}');

    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES (
      'tenant-a','inv-1','INV-1',101,'BDT',18500,0,18500,0,18500,
      0,18500,1,'posted','2026-07-23T03:05:00.000Z','2026-07-23T03:05:00.000Z','${'4'.repeat(64)}'
    );

    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES ('tenant-a','line-1','inv-1','service','evt-1',NULL,1,18500,18500,'${'5'.repeat(64)}');

    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
      priority,effective_from,effective_to,status,source_evidence_sha256
    ) VALUES (
      'tenant-a','rule-1',1,'service','svc-1',NULL,'prac-1','treating','commission',
      'fixed',2500,'gross','ignore','exclude',0,NULL,1,'2026-01-01',NULL,'active','${'6'.repeat(64)}'
    );

    INSERT INTO canonical_compensation_accruals (
      tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
      service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
      rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
      gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
      earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
      business_date,payable_projection_guard,source_evidence_sha256
    ) VALUES (
      'tenant-a','accrual-1','inv-1','line-1','evt-1','prac-1','treating','commission',
      'rule-1',1,'gross','fixed',2500,'BDT',18500,0,0,0,18500,2500,0,0,2500,
      'accrued','2026-07-23T03:06:00.000Z','2026-07-23',1,'${'7'.repeat(64)}'
    );
  `);

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
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

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    invoicePublicId: 'inv-1',
    reasonCode: 'approved_unpaid_bill_cancellation',
    cancelledAtUtc: '2026-07-23T04:00:00.000Z',
    businessDate: '2026-07-23',
    sourceType: 'legacy_bill_cancellation',
    sourcePublicId: 'bill-1',
    sourceTable: 'bills',
    sourceEvidenceSha256: '8'.repeat(64),
    idempotencyKey: 'cancel-unpaid-bill-1',
    outboxEventPublicId: 'outbox-cancel-unpaid-bill-1',
    ...overrides,
  };
}

function seedReceipt(
  sqlite: DatabaseSync,
  receiptPublicId: string,
  allocatedMinor: number,
  unallocatedMinor: number,
): void {
  const totalMinor = allocatedMinor + unallocatedMinor;
  sqlite.prepare(`
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
      refunded_minor,net_received_minor,refund_projection_guard
    ) VALUES (?,?,?,?,?,?,?,?,?,'2026-07-23T03:30:00.000Z','2026-07-23',
      '2026-07-23T03:30:00.000Z',1,?,0,?,1)
  `).run(
    'tenant-a',
    receiptPublicId,
    `RCP-${receiptPublicId}`,
    101,
    'BDT',
    totalMinor,
    allocatedMinor,
    unallocatedMinor,
    'posted',
    '9'.repeat(64),
    totalMinor,
  );
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  return Number((sqlite.prepare(sql).get() as { count: number }).count);
}

describe('cancel unpaid canonical invoice command', () => {
  it('atomically cancels the invoice and reverses unpaid compensation with the legacy authority', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await cancelUnpaidInvoice(db, input(), {
        authoritativeStatements: [
          db.prepare(`
            UPDATE legacy_financial
            SET status='cancelled'
            WHERE tenant_id=? AND source_id=? AND status='open'
          `).bind('tenant-a', 'bill-1'),
        ],
      });

      expect(result).toEqual({
        status: 'applied',
        result: {
          invoicePublicId: 'inv-1',
          status: 'cancelled',
          totalMinor: 18500,
          reversedCompensationMinor: 2500,
          reversedCompensationCount: 1,
        },
      });
      expect(sqlite.prepare(`
        SELECT status,cancelled_at_utc,total_minor,paid_minor,due_minor,credited_minor,net_due_minor
        FROM canonical_invoices WHERE tenant_id='tenant-a' AND invoice_public_id='inv-1'
      `).get()).toEqual({
        status: 'cancelled',
        cancelled_at_utc: '2026-07-23T04:00:00.000Z',
        total_minor: 18500,
        paid_minor: 0,
        due_minor: 18500,
        credited_minor: 0,
        net_due_minor: 18500,
      });
      expect(sqlite.prepare(`
        SELECT adjustment_type,amount_minor,accrual_payable_before_minor,accrual_payable_after_minor,balance_guard
        FROM canonical_compensation_adjustments
      `).get()).toEqual({
        adjustment_type: 'service_cancellation',
        amount_minor: 2500,
        accrual_payable_before_minor: 2500,
        accrual_payable_after_minor: 0,
        balance_guard: 1,
      });
      expect(sqlite.prepare(`
        SELECT adjusted_minor,settled_minor,payable_minor,status
        FROM canonical_compensation_accruals WHERE accrual_public_id='accrual-1'
      `).get()).toEqual({ adjusted_minor: 2500, settled_minor: 0, payable_minor: 0, status: 'reversed' });
      expect(sqlite.prepare(`SELECT status FROM legacy_financial WHERE source_id='bill-1'`).get()).toEqual({ status: 'cancelled' });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_source_mappings
        WHERE entity_type='compensation_adjustment'
      `).get() as { count: number }).count)).toBe(1);
      const outbox = sqlite.prepare(`
        SELECT event_type,payload_json FROM canonical_outbox_events
        WHERE tenant_id='tenant-a' AND idempotency_key='cancel-unpaid-bill-1'
      `).get() as { event_type: string; payload_json: string };
      expect(outbox.event_type).toBe('canonical.invoice.cancelled');
      expect(outbox.payload_json).not.toContain('approved_unpaid_bill_cancellation');
      expect(JSON.parse(outbox.payload_json).event).toEqual({
        invoicePublicId: 'inv-1',
        reversedCompensationCount: 1,
        reversedCompensationMinor: 2500,
        status: 'cancelled',
        totalMinor: 18500,
      });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back the whole command when authoritative statements make the invoice no longer unpaid before the guarded cancellation update', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(cancelUnpaidInvoice(db, input(), {
        authoritativeStatements: [
          db.prepare(`
            UPDATE canonical_invoices
            SET paid_minor=1000,due_minor=17500,net_due_minor=17500
            WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
          `).bind('tenant-a', 'inv-1'),
          db.prepare(`
            UPDATE legacy_financial
            SET status='cancelled'
            WHERE tenant_id=? AND source_id=? AND status='open'
          `).bind('tenant-a', 'bill-1'),
        ],
      })).rejects.toThrow();

      expect(sqlite.prepare(`
        SELECT status,paid_minor,due_minor,net_due_minor,cancelled_at_utc
        FROM canonical_invoices WHERE tenant_id='tenant-a' AND invoice_public_id='inv-1'
      `).get()).toEqual({
        status: 'posted',
        paid_minor: 0,
        due_minor: 18500,
        net_due_minor: 18500,
        cancelled_at_utc: null,
      });
      expect(sqlite.prepare(`SELECT status FROM legacy_financial WHERE source_id='bill-1'`).get()).toEqual({ status: 'open' });
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_outbox_events`).get() as { count: number }).count)).toBe(0);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_compensation_adjustments`).get() as { count: number }).count)).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('replays identical cancellation without duplicating canonical facts', async () => {
    const { sqlite, db } = harness();
    try {
      await cancelUnpaidInvoice(db, input());
      expect(await cancelUnpaidInvoice(db, input())).toMatchObject({ status: 'replayed' });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(1);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_compensation_adjustments')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('rejects semantic idempotency conflicts', async () => {
    const { sqlite, db } = harness();
    try {
      await cancelUnpaidInvoice(db, input());
      await expect(cancelUnpaidInvoice(db, input({ reasonCode: 'different_reason_code' })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('rejects an invoice that already has a paid balance', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        UPDATE canonical_invoices
        SET paid_minor=1000,due_minor=17500,net_due_minor=17500
        WHERE tenant_id='tenant-a' AND invoice_public_id='inv-1';
      `);
      await expect(cancelUnpaidInvoice(db, input())).rejects.toThrow('not an unpaid unadjusted invoice');
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rejects an invoice with an active payment allocation', async () => {
    const { sqlite, db } = harness();
    try {
      seedReceipt(sqlite, 'receipt-allocation', 1000, 0);
      sqlite.prepare(`
        INSERT INTO canonical_payment_allocations (
          tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
          invoice_line_public_id,amount_minor,invoice_due_before_minor,
          invoice_due_after_minor,status,allocated_at_utc,balance_guard,
          source_evidence_sha256,reversed_minor,remaining_minor,reversal_projection_guard
        ) VALUES (?,?,?,?,NULL,?,?,?,'active','2026-07-23T03:31:00.000Z',1,?,0,?,1)
      `).run(
        'tenant-a','allocation-1','receipt-allocation','inv-1',
        1000,18500,17500,'a'.repeat(64),1000,
      );
      await expect(cancelUnpaidInvoice(db, input())).rejects.toThrow('payment, deposit, or credit authority');
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rejects an invoice with an active deposit application', async () => {
    const { sqlite, db } = harness();
    try {
      seedReceipt(sqlite, 'receipt-deposit', 0, 1000);
      sqlite.exec(`
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,
          legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
          available_minor,status,received_at_utc,business_date,posted_at_utc,
          reconciliation_guard,source_evidence_sha256
        ) VALUES (
          'tenant-a','deposit-1','DEP-1','receipt-deposit',101,'BDT',1000,500,0,
          500,'posted','2026-07-23T03:30:00.000Z','2026-07-23',
          '2026-07-23T03:30:00.000Z',1,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        );
        INSERT INTO canonical_deposit_applications (
          tenant_id,application_public_id,deposit_public_id,invoice_public_id,
          invoice_line_public_id,amount_minor,deposit_available_before_minor,
          deposit_available_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
          invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
          invoice_net_due_after_minor,status,applied_at_utc,balance_guard,source_evidence_sha256
        ) VALUES (
          'tenant-a','deposit-app-1','deposit-1','inv-1',NULL,500,1000,500,0,500,
          18500,18000,18500,18000,'active','2026-07-23T03:32:00.000Z',1,'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
        );
      `);
      await expect(cancelUnpaidInvoice(db, input())).rejects.toThrow('payment, deposit, or credit authority');
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rejects an invoice with a posted credit note', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_credit_notes (
          tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,
          legacy_patient_id,currency_code,reason_code,total_minor,
          invoice_credited_before_minor,invoice_credited_after_minor,
          invoice_net_due_before_minor,invoice_net_due_after_minor,status,
          issued_at_utc,business_date,posted_at_utc,reconciliation_guard,
          source_evidence_sha256
        ) VALUES (
          'tenant-a','credit-1','CN-1','inv-1',101,'BDT','approved_adjustment',1000,
          0,1000,18500,17500,'posted','2026-07-23T03:35:00.000Z','2026-07-23',
          '2026-07-23T03:35:00.000Z',1,'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
        );
      `);
      await expect(cancelUnpaidInvoice(db, input())).rejects.toThrow('payment, deposit, or credit authority');
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rejects cancellation after compensation has been settled', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        UPDATE canonical_compensation_accruals
        SET settled_minor=1000,payable_minor=1500,status='partially_settled'
        WHERE tenant_id='tenant-a' AND accrual_public_id='accrual-1';
      `);
      await expect(cancelUnpaidInvoice(db, input())).rejects.toThrow('Settled canonical compensation');
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back when a new payable compensation accrual appears after validation but before the atomic cancellation batch', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(cancelUnpaidInvoice(db, input(), {
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO canonical_compensation_accruals (
              tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
              service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
              rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
              gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
              earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
              business_date,payable_projection_guard,source_evidence_sha256
            ) VALUES (
              'tenant-a','accrual-race','inv-1','line-1','evt-1',NULL,'referrer','commission',
              'rule-1',1,'gross','fixed',500,'BDT',18500,0,0,0,18500,500,0,0,500,
              'unassigned','2026-07-23T03:59:00.000Z','2026-07-23',1,?
            )
          `).bind('e'.repeat(64)),
          db.prepare(`
            UPDATE legacy_financial
            SET status='cancelled'
            WHERE tenant_id=? AND source_id=? AND status='open'
          `).bind('tenant-a', 'bill-1'),
        ],
      })).rejects.toThrow();

      expect(sqlite.prepare(`
        SELECT status,cancelled_at_utc FROM canonical_invoices
        WHERE tenant_id='tenant-a' AND invoice_public_id='inv-1'
      `).get()).toEqual({ status: 'posted', cancelled_at_utc: null });
      expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_compensation_accruals WHERE accrual_public_id='accrual-race'`)).toBe(0);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_compensation_adjustments')).toBe(0);
      expect(sqlite.prepare(`SELECT status FROM legacy_financial WHERE source_id='bill-1'`).get()).toEqual({ status: 'open' });
    } finally {
      sqlite.close();
    }
  });

  it('does not resolve an invoice from another tenant', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(cancelUnpaidInvoice(db, input({ tenantId: 'tenant-b' })))
        .rejects.toThrow('Canonical invoice not found');
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
