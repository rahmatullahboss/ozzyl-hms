import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import { applyDeposit, recordDeposit, refundDeposit } from '../../src/lib/canonical/commands/apply-deposit';
import { issueCreditNote } from '../../src/lib/canonical/commands/issue-credit-note';
import { reversePayment } from '../../src/lib/canonical/commands/reverse-payment';

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
    CREATE TABLE legacy_financial (
      tenant_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      UNIQUE (tenant_id, source_id)
    );
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

function seedInvoice(
  sqlite: DatabaseSync,
  input: {
    tenantId?: string;
    invoicePublicId: string;
    invoiceNumber: string;
    patientId?: number;
    totalMinor: number;
    paidMinor?: number;
    creditedMinor?: number;
  },
): void {
  const paidMinor = input.paidMinor ?? 0;
  const creditedMinor = input.creditedMinor ?? 0;
  const dueMinor = input.totalMinor - paidMinor;
  const netDueMinor = dueMinor - creditedMinor;
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,1,'posted',?,?,?)
  `).run(
    input.tenantId ?? 'tenant-a',
    input.invoicePublicId,
    input.invoiceNumber,
    input.patientId ?? 101,
    'BDT',
    input.totalMinor,
    input.totalMinor,
    paidMinor,
    dueMinor,
    creditedMinor,
    netDueMinor,
    '2026-07-14T02:00:00.000Z',
    '2026-07-14T02:00:00.000Z',
    'a'.repeat(64),
  );
}

function seedReceipt(
  sqlite: DatabaseSync,
  input: {
    receiptPublicId: string;
    receiptNumber: string;
    totalMinor: number;
    allocatedMinor: number;
    patientId?: number;
    tenantId?: string;
    tenderPublicId?: string;
    allocationPublicId?: string;
    invoicePublicId?: string;
    tenderType?: 'cash' | 'card';
  },
): void {
  const unallocatedMinor = input.totalMinor - input.allocatedMinor;
  sqlite.prepare(`
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
      refunded_minor,net_received_minor,refund_projection_guard
    ) VALUES (?,?,?,?,?,?,?,?, 'posted',?,?,?,1,?,0,?,1)
  `).run(
    input.tenantId ?? 'tenant-a',
    input.receiptPublicId,
    input.receiptNumber,
    input.patientId ?? 101,
    'BDT',
    input.totalMinor,
    input.allocatedMinor,
    unallocatedMinor,
    '2026-07-14T03:00:00.000Z',
    '2026-07-14',
    '2026-07-14T03:00:00.000Z',
    'b'.repeat(64),
    input.totalMinor,
  );

  if (input.tenderPublicId) {
    sqlite.prepare(`
      INSERT INTO canonical_payment_tenders (
        tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
        amount_minor,status,captured_at_utc,source_evidence_sha256,
        reversed_minor,remaining_minor,reversal_projection_guard
      ) VALUES (?,?,?,?,?,?,'captured',?,?,0,?,1)
    `).run(
      input.tenantId ?? 'tenant-a',
      input.tenderPublicId,
      input.receiptPublicId,
      input.tenderType ?? 'card',
      input.tenderType ?? 'card',
      input.totalMinor,
      '2026-07-14T03:00:00.000Z',
      'c'.repeat(64),
      input.totalMinor,
    );
  }

  if (input.allocationPublicId && input.invoicePublicId) {
    sqlite.prepare(`
      INSERT INTO canonical_payment_allocations (
        tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
        amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,
        allocated_at_utc,balance_guard,source_evidence_sha256,
        reversed_minor,remaining_minor,reversal_projection_guard
      ) VALUES (?,?,?,?,?,?,?,'active',?,1,?,0,?,1)
    `).run(
      input.tenantId ?? 'tenant-a',
      input.allocationPublicId,
      input.receiptPublicId,
      input.invoicePublicId,
      input.allocatedMinor,
      10000,
      10000 - input.allocatedMinor,
      '2026-07-14T03:00:00.000Z',
      'd'.repeat(64),
      input.allocatedMinor,
    );
  }
}

function recordDepositInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    depositPublicId: 'dep-1',
    depositNumber: 'DEP-1',
    receiptPublicId: 'receipt-deposit-1',
    sourceType: 'runtime_deposit',
    sourcePublicId: 'runtime-deposit-1',
    sourceTable: 'runtime',
    sourceEvidenceSha256: 'e'.repeat(64),
    idempotencyKey: 'record-deposit-1',
    outboxEventPublicId: 'outbox-deposit-1',
    ...overrides,
  };
}

function applyDepositInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    applicationPublicId: 'dep-app-1',
    depositPublicId: 'dep-1',
    invoicePublicId: 'inv-1',
    invoiceLinePublicId: null,
    amountMinor: 3000,
    appliedAtUtc: '2026-07-14T04:00:00.000Z',
    businessDate: '2026-07-14',
    sourceType: 'runtime_deposit_application',
    sourcePublicId: 'runtime-deposit-application-1',
    sourceTable: 'runtime',
    sourceEvidenceSha256: 'f'.repeat(64),
    idempotencyKey: 'apply-deposit-1',
    outboxEventPublicId: 'outbox-deposit-application-1',
    ...overrides,
  };
}

function issueCreditInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    creditNotePublicId: 'credit-1',
    creditNoteNumber: 'CN-1',
    invoicePublicId: 'inv-2',
    reasonCode: 'SERVICE_ADJUSTMENT',
    issuedAtUtc: '2026-07-14T04:30:00.000Z',
    businessDate: '2026-07-14',
    lines: [{
      creditLinePublicId: 'credit-line-1',
      invoiceLinePublicId: null,
      amountMinor: 2000,
      reasonCode: 'SERVICE_ADJUSTMENT',
      sourceEvidenceSha256: '1'.repeat(64),
    }],
    sourceType: 'runtime_credit_note',
    sourcePublicId: 'runtime-credit-note-1',
    sourceTable: 'runtime',
    sourceEvidenceSha256: '2'.repeat(64),
    idempotencyKey: 'issue-credit-1',
    outboxEventPublicId: 'outbox-credit-1',
    ...overrides,
  };
}

function reversePaymentInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    reversalPublicId: 'pay-reversal-1',
    refundPublicId: 'refund-payment-1',
    receiptPublicId: 'receipt-payment-1',
    tenderPublicId: 'tender-payment-1',
    allocationPublicId: 'alloc-payment-1',
    amountMinor: 2000,
    reasonCode: 'PATIENT_REFUND',
    reversedAtUtc: '2026-07-14T05:00:00.000Z',
    businessDate: '2026-07-14',
    sourceType: 'runtime_payment_reversal',
    sourcePublicId: 'runtime-payment-reversal-1',
    sourceTable: 'runtime',
    sourceEvidenceSha256: '3'.repeat(64),
    idempotencyKey: 'reverse-payment-1',
    outboxEventPublicId: 'outbox-payment-reversal-1',
    cashCustodyEventPublicId: null,
    ...overrides,
  };
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  return Number((sqlite.prepare(sql).get() as { count: number }).count);
}

function authoritativeStatement(db: CanonicalBatchDatabase, sourceId: string): CanonicalPreparedStatement {
  return db.prepare('INSERT INTO legacy_financial (tenant_id, source_id) VALUES (?, ?)')
    .bind('tenant-a', sourceId);
}

describe('canonical adjustment migration', () => {
  it('is triggerless and exposes immutable deposit, credit, refund, and reversal authorities', () => {
    const migration = readFileSync('migrations/0512_canonical_adjustments.sql', 'utf8');
    expect(migration).not.toContain('CREATE TRIGGER');
    expect(migration).toContain('canonical_deposits');
    expect(migration).toContain('canonical_deposit_applications');
    expect(migration).toContain('canonical_credit_notes');
    expect(migration).toContain('canonical_credit_note_lines');
    expect(migration).toContain('canonical_refunds');
    expect(migration).toContain('canonical_payment_reversals');
    expect(migration).toContain('adjustment_projection_guard');
    expect(migration).toContain('reversal_projection_guard');
  });
});

describe('canonical deposit lifecycle', () => {
  it('creates live receipt authority and deposit liability in the same batch', async () => {
    const { sqlite, db } = harness();

    await recordDeposit(db, {
      ...recordDepositInput({ receiptPublicId: 'receipt-live-deposit' }),
      receiptAuthority: {
        legacyPatientId: 101,
        currencyCode: 'BDT',
        amountMinor: 2500,
        tenderPublicId: 'tender-live-deposit',
        tenderType: 'cash',
        methodCode: 'cash',
        receivedAtUtc: '2026-07-18T06:00:00.000Z',
        businessDate: '2026-07-18',
        sourceEvidenceSha256: '9'.repeat(64),
      },
    }, {
      authoritativeStatements: [authoritativeStatement(db, 'live-deposit-success')],
    });

    expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_payment_receipts WHERE receipt_public_id='receipt-live-deposit'")).toBe(1);
    expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_payment_tenders WHERE tender_public_id='tender-live-deposit'")).toBe(1);
    expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_deposits WHERE deposit_public_id='dep-1'")).toBe(1);
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);
  });

  it('commits and rolls back authoritative legacy state for deposit recording', async () => {
    const { sqlite, db } = harness();
    seedReceipt(sqlite, {
      receiptPublicId: 'receipt-deposit-1', receiptNumber: 'R-DEP-1', totalMinor: 5000, allocatedMinor: 0,
    });

    await recordDeposit(db, recordDepositInput(), {
      authoritativeStatements: [authoritativeStatement(db, 'record-deposit-success')],
    });
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);

    await expect(recordDeposit(db, recordDepositInput({
      depositNumber: 'DEP-FAILURE',
      sourcePublicId: 'runtime-deposit-failure',
      idempotencyKey: 'record-deposit-failure',
      outboxEventPublicId: 'outbox-deposit-failure',
    }), {
      authoritativeStatements: [authoritativeStatement(db, 'record-deposit-rollback')],
    })).rejects.toThrow(/UNIQUE constraint failed/);
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);
  });

  it('commits and rolls back authoritative legacy state for deposit application', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-1', invoiceNumber: 'INV-1', totalMinor: 10000 });
    seedReceipt(sqlite, {
      receiptPublicId: 'receipt-deposit-1', receiptNumber: 'R-DEP-1', totalMinor: 5000, allocatedMinor: 0,
    });
    await recordDeposit(db, recordDepositInput());

    await applyDeposit(db, applyDepositInput(), {
      authoritativeStatements: [authoritativeStatement(db, 'apply-deposit-success')],
    });
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);

    await expect(applyDeposit(db, applyDepositInput({
      amountMinor: 500,
      sourcePublicId: 'runtime-deposit-application-failure',
      idempotencyKey: 'apply-deposit-failure',
      outboxEventPublicId: 'outbox-deposit-application-failure',
    }), {
      authoritativeStatements: [authoritativeStatement(db, 'apply-deposit-rollback')],
    })).rejects.toThrow(/UNIQUE constraint failed/);
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);
  });

  it('commits and rolls back authoritative legacy state for deposit refund', async () => {
    const { sqlite, db } = harness();
    seedReceipt(sqlite, {
      receiptPublicId: 'receipt-deposit-1', receiptNumber: 'R-DEP-1', totalMinor: 5000, allocatedMinor: 0,
    });
    await recordDeposit(db, recordDepositInput());
    const refund = {
      tenantId: 'tenant-a', refundPublicId: 'refund-deposit-1', depositPublicId: 'dep-1',
      amountMinor: 1000, tenderType: 'card' as const, methodCode: 'card',
      refundedAtUtc: '2026-07-14T04:30:00.000Z', businessDate: '2026-07-14',
      sourceType: 'runtime_deposit_refund', sourcePublicId: 'runtime-deposit-refund-1',
      sourceTable: 'runtime', sourceEvidenceSha256: '4'.repeat(64),
      idempotencyKey: 'refund-deposit-1', outboxEventPublicId: 'outbox-refund-deposit-1',
      cashCustodyEventPublicId: null,
    };

    await refundDeposit(db, refund, {
      authoritativeStatements: [authoritativeStatement(db, 'refund-deposit-success')],
    });
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);

    await expect(refundDeposit(db, {
      ...refund,
      amountMinor: 500,
      sourcePublicId: 'runtime-deposit-refund-failure',
      idempotencyKey: 'refund-deposit-failure',
      outboxEventPublicId: 'outbox-refund-deposit-failure',
    }, {
      authoritativeStatements: [authoritativeStatement(db, 'refund-deposit-rollback')],
    })).rejects.toThrow(/UNIQUE constraint failed/);
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);
  });

  it('records a liability and applies it partially across invoices without mutating the source receipt amount', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-1', invoiceNumber: 'INV-1', totalMinor: 10000 });
    seedInvoice(sqlite, { invoicePublicId: 'inv-2', invoiceNumber: 'INV-2', totalMinor: 8000 });
    seedReceipt(sqlite, {
      receiptPublicId: 'receipt-deposit-1',
      receiptNumber: 'R-DEP-1',
      totalMinor: 7000,
      allocatedMinor: 0,
    });

    await expect(recordDeposit(db, recordDepositInput())).resolves.toMatchObject({
      status: 'applied',
      result: { depositPublicId: 'dep-1', availableMinor: 7000 },
    });
    await expect(applyDeposit(db, applyDepositInput())).resolves.toMatchObject({
      status: 'applied',
      result: { appliedMinor: 3000, availableMinor: 4000 },
    });
    await expect(applyDeposit(db, applyDepositInput({
      applicationPublicId: 'dep-app-2',
      invoicePublicId: 'inv-2',
      amountMinor: 2000,
      sourcePublicId: 'runtime-deposit-application-2',
      idempotencyKey: 'apply-deposit-2',
      outboxEventPublicId: 'outbox-deposit-application-2',
    }))).resolves.toMatchObject({
      status: 'applied',
      result: { appliedMinor: 2000, availableMinor: 2000 },
    });

    expect(sqlite.prepare(`SELECT amount_minor,applied_minor,refunded_minor,available_minor FROM canonical_deposits WHERE deposit_public_id='dep-1'`).get()).toEqual({
      amount_minor: 7000,
      applied_minor: 5000,
      refunded_minor: 0,
      available_minor: 2000,
    });
    expect(sqlite.prepare(`SELECT paid_minor,due_minor,credited_minor,net_due_minor FROM canonical_invoices WHERE invoice_public_id='inv-1'`).get()).toEqual({
      paid_minor: 3000,
      due_minor: 7000,
      credited_minor: 0,
      net_due_minor: 7000,
    });
    expect(sqlite.prepare(`SELECT total_minor,allocated_total_minor,unallocated_minor FROM canonical_payment_receipts WHERE receipt_public_id='receipt-deposit-1'`).get()).toEqual({
      total_minor: 7000,
      allocated_total_minor: 0,
      unallocated_minor: 7000,
    });
  });

  it('rejects over-application and stale deposit state atomically', async () => {
    let mutate = false;
    const { sqlite, db } = harness({
      beforeBatch(database) {
        if (!mutate) return;
        database.prepare(`UPDATE canonical_deposits SET applied_minor=1000,available_minor=4000 WHERE deposit_public_id='dep-1'`).run();
        mutate = false;
      },
    });
    seedInvoice(sqlite, { invoicePublicId: 'inv-1', invoiceNumber: 'INV-1', totalMinor: 10000 });
    seedReceipt(sqlite, { receiptPublicId: 'receipt-deposit-1', receiptNumber: 'R-DEP-1', totalMinor: 5000, allocatedMinor: 0 });
    await recordDeposit(db, recordDepositInput());

    await expect(applyDeposit(db, applyDepositInput({ amountMinor: 6000 }))).rejects.toThrow(/available/i);
    mutate = true;
    await expect(applyDeposit(db, applyDepositInput())).rejects.toThrow(/stale|guard/i);
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_deposit_applications`)).toBe(0);
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_outbox_events WHERE idempotency_key='apply-deposit-1'`)).toBe(0);
  });

  it('refunds available liability and links cash custody in the same batch', async () => {
    const { sqlite, db } = harness();
    seedReceipt(sqlite, { receiptPublicId: 'receipt-deposit-1', receiptNumber: 'R-DEP-1', totalMinor: 5000, allocatedMinor: 0 });
    await recordDeposit(db, recordDepositInput());

    await expect(refundDeposit(db, {
      tenantId: 'tenant-a',
      refundPublicId: 'refund-deposit-1',
      depositPublicId: 'dep-1',
      amountMinor: 1500,
      tenderType: 'cash',
      methodCode: 'cash',
      refundedAtUtc: '2026-07-14T04:30:00.000Z',
      businessDate: '2026-07-14',
      sourceType: 'runtime_deposit_refund',
      sourcePublicId: 'runtime-deposit-refund-1',
      sourceTable: 'runtime',
      sourceEvidenceSha256: '4'.repeat(64),
      idempotencyKey: 'refund-deposit-1',
      outboxEventPublicId: 'outbox-refund-deposit-1',
      cashCustodyEventPublicId: 'outbox-cash-refund-deposit-1',
    })).resolves.toMatchObject({ status: 'applied', result: { refundedMinor: 1500, availableMinor: 3500 } });

    expect(sqlite.prepare(`SELECT refunded_minor,available_minor FROM canonical_deposits WHERE deposit_public_id='dep-1'`).get()).toEqual({
      refunded_minor: 1500,
      available_minor: 3500,
    });
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.cash_custody.refund_recorded'`)).toBe(1);
  });

  it('rolls back refund authority and deposit liability when cash custody conflicts', async () => {
    const { sqlite, db } = harness();
    seedReceipt(sqlite, { receiptPublicId: 'receipt-deposit-1', receiptNumber: 'R-DEP-1', totalMinor: 5000, allocatedMinor: 0 });
    await recordDeposit(db, recordDepositInput());
    sqlite.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        payload_json,occurred_at_utc,idempotency_key,status
      ) VALUES ('tenant-a','outbox-cash-refund-conflict','existing','existing',
                'existing.event','{}','2026-07-14T04:00:00.000Z',
                'existing-cash-refund','pending')
    `).run();

    await expect(refundDeposit(db, {
      tenantId: 'tenant-a',
      refundPublicId: 'refund-deposit-conflict',
      depositPublicId: 'dep-1',
      amountMinor: 1500,
      tenderType: 'cash',
      methodCode: 'cash',
      refundedAtUtc: '2026-07-14T04:30:00.000Z',
      businessDate: '2026-07-14',
      sourceType: 'runtime_deposit_refund',
      sourcePublicId: 'runtime-deposit-refund-conflict',
      sourceTable: 'runtime',
      sourceEvidenceSha256: '6'.repeat(64),
      idempotencyKey: 'refund-deposit-conflict',
      outboxEventPublicId: 'outbox-refund-deposit-conflict',
      cashCustodyEventPublicId: 'outbox-cash-refund-conflict',
    })).rejects.toThrow(/UNIQUE constraint failed/);

    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_refunds`)).toBe(0);
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='refund'`)).toBe(0);
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_outbox_events WHERE idempotency_key='refund-deposit-conflict'`)).toBe(0);
    expect(sqlite.prepare(`SELECT refunded_minor,available_minor FROM canonical_deposits WHERE deposit_public_id='dep-1'`).get()).toEqual({
      refunded_minor: 0,
      available_minor: 5000,
    });
  });

  it('rejects applying a tenant deposit to another tenant invoice', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, {
      tenantId: 'tenant-b',
      invoicePublicId: 'inv-other-tenant',
      invoiceNumber: 'INV-OTHER-TENANT',
      totalMinor: 10000,
    });
    seedReceipt(sqlite, { receiptPublicId: 'receipt-deposit-1', receiptNumber: 'R-DEP-1', totalMinor: 5000, allocatedMinor: 0 });
    await recordDeposit(db, recordDepositInput());

    await expect(applyDeposit(db, applyDepositInput({
      invoicePublicId: 'inv-other-tenant',
    }))).rejects.toThrow(/invoice not found/i);

    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_deposit_applications`)).toBe(0);
    expect(sqlite.prepare(`SELECT applied_minor,available_minor FROM canonical_deposits WHERE deposit_public_id='dep-1'`).get()).toEqual({
      applied_minor: 0,
      available_minor: 5000,
    });
  });
});

describe('canonical credit notes', () => {
  it('commits and rolls back authoritative legacy state for credit notes', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-2', invoiceNumber: 'INV-2', totalMinor: 8000 });

    await issueCreditNote(db, issueCreditInput(), {
      authoritativeStatements: [authoritativeStatement(db, 'credit-note-success')],
    });
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);

    await expect(issueCreditNote(db, issueCreditInput({
      creditNoteNumber: 'CN-FAILURE',
      lines: [{
        creditLinePublicId: 'credit-line-failure', invoiceLinePublicId: null,
        amountMinor: 500, reasonCode: 'SERVICE_ADJUSTMENT', sourceEvidenceSha256: '6'.repeat(64),
      }],
      sourcePublicId: 'runtime-credit-note-failure',
      idempotencyKey: 'issue-credit-failure',
      outboxEventPublicId: 'outbox-credit-failure',
    }), {
      authoritativeStatements: [authoritativeStatement(db, 'credit-note-rollback')],
    })).rejects.toThrow(/UNIQUE constraint failed/);
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);
  });

  it('posts exact header and line authority and reduces net due without rewriting invoice total', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-2', invoiceNumber: 'INV-2', totalMinor: 8000 });

    const result = await issueCreditNote(db, issueCreditInput());
    expect(result).toMatchObject({ status: 'applied', result: { totalMinor: 2000, netDueMinor: 6000 } });
    expect(sqlite.prepare(`SELECT total_minor,paid_minor,due_minor,credited_minor,net_due_minor FROM canonical_invoices WHERE invoice_public_id='inv-2'`).get()).toEqual({
      total_minor: 8000,
      paid_minor: 0,
      due_minor: 8000,
      credited_minor: 2000,
      net_due_minor: 6000,
    });
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_credit_note_lines WHERE credit_note_public_id='credit-1'`)).toBe(1);
  });

  it('blocks credit or reversal when a linked performer reserve is already paid', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-2', invoiceNumber: 'INV-2', totalMinor: 8000 });
    sqlite.prepare(`
      INSERT INTO canonical_source_mappings (
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
        source_table,mapping_status,mapping_version,evidence_sha256
      ) VALUES ('tenant-a','invoice','inv-2','legacy_bill','77','bills','mapped',1,?)
    `).run('5'.repeat(64));
    sqlite.prepare(`INSERT INTO diagnostic_performer_reserves VALUES ('tenant-a',77,'paid')`).run();

    await expect(issueCreditNote(db, issueCreditInput())).rejects.toThrow(/performer|compensation|paid/i);
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_credit_notes`)).toBe(0);
  });

  it('checks every mapped legacy bill before allowing a canonical credit note', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-2', invoiceNumber: 'INV-2', totalMinor: 8000 });
    sqlite.prepare(`
      INSERT INTO canonical_source_mappings (
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
        source_table,mapping_status,mapping_version,evidence_sha256
      ) VALUES
        ('tenant-a','invoice','inv-2','legacy_bill','76','bills','mapped',1,?),
        ('tenant-a','invoice','inv-2','legacy_bill','77','bills','mapped',1,?)
    `).run('5'.repeat(64), '6'.repeat(64));
    sqlite.prepare(`INSERT INTO diagnostic_performer_reserves VALUES ('tenant-a',77,'paid')`).run();

    await expect(issueCreditNote(db, issueCreditInput())).rejects.toThrow(/performer|compensation|paid/i);
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_credit_notes`)).toBe(0);
  });

  it('issues a pure canonical credit note after legacy compensation tables are retired', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-2', invoiceNumber: 'INV-2', totalMinor: 8000 });
    sqlite.exec(`
      DROP TABLE diagnostic_performer_reserves;
      DROP TABLE doctor_commission_accruals;
    `);

    await expect(issueCreditNote(db, issueCreditInput())).resolves.toMatchObject({
      status: 'applied',
      result: { totalMinor: 2000, netDueMinor: 6000 },
    });
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_credit_notes`)).toBe(1);
  });

  it('still blocks settled canonical compensation after legacy compensation tables are retired', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-2', invoiceNumber: 'INV-2', totalMinor: 8000 });
    sqlite.exec(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status
      ) VALUES ('tenant-a','prac-credit-paid','internal','Paid Practitioner','active');
      INSERT INTO canonical_invoice_lines (
        tenant_id,line_public_id,invoice_public_id,line_type,adjustment_code,
        quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
      ) VALUES ('tenant-a','line-credit-paid','inv-2','other_adjustment','TEST',1,8000,8000,'${'6'.repeat(64)}');
      INSERT INTO canonical_compensation_rules (
        tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
        practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
        calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
        priority,effective_from,effective_to,status,source_evidence_sha256
      ) VALUES ('tenant-a','rule-credit-paid',1,'all',NULL,NULL,'prac-credit-paid','performing',
                'performer_reserve','fixed',2000,'gross','ignore','exclude',0,NULL,
                10,'2026-01-01',NULL,'active','${'7'.repeat(64)}');
      INSERT INTO canonical_compensation_accruals (
        tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
        service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
        rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
        gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
        earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
        business_date,payable_projection_guard,source_evidence_sha256
      ) VALUES ('tenant-a','accrual-credit-paid','inv-2','line-credit-paid',NULL,
                'prac-credit-paid','performing','performer_reserve','rule-credit-paid',1,
                'gross','fixed',2000,'BDT',8000,0,0,0,8000,2000,0,1000,1000,
                'partially_settled','2026-07-14T03:00:00.000Z','2026-07-14',1,'${'8'.repeat(64)}');
      DROP TABLE diagnostic_performer_reserves;
      DROP TABLE doctor_commission_accruals;
    `);

    await expect(issueCreditNote(db, issueCreditInput())).rejects.toThrow(/performer|compensation|paid/i);
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_credit_notes`)).toBe(0);
  });
});

describe('canonical payment reversal', () => {
  it('commits and rolls back authoritative legacy state for payment reversals', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-1', invoiceNumber: 'INV-1', totalMinor: 10000, paidMinor: 6000 });
    seedReceipt(sqlite, {
      receiptPublicId: 'receipt-payment-1', receiptNumber: 'R-PAY-1', totalMinor: 6000,
      allocatedMinor: 6000, tenderPublicId: 'tender-payment-1', allocationPublicId: 'alloc-payment-1',
      invoicePublicId: 'inv-1', tenderType: 'card',
    });

    await reversePayment(db, reversePaymentInput(), {
      authoritativeStatements: [authoritativeStatement(db, 'payment-reversal-success')],
    });
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);

    await expect(reversePayment(db, reversePaymentInput({
      refundPublicId: 'refund-payment-failure',
      amountMinor: 1000,
      sourcePublicId: 'runtime-payment-reversal-failure',
      idempotencyKey: 'reverse-payment-failure',
      outboxEventPublicId: 'outbox-payment-reversal-failure',
    }), {
      authoritativeStatements: [authoritativeStatement(db, 'payment-reversal-rollback')],
    })).rejects.toThrow(/UNIQUE constraint failed/);
    expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);
  });

  it('blocks payment reversal while canonical compensation has settled liability', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-1', invoiceNumber: 'INV-1', totalMinor: 10000, paidMinor: 6000 });
    sqlite.exec(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status
      ) VALUES ('tenant-a','prac-paid','internal','Paid Practitioner','active');
      INSERT INTO canonical_invoice_lines (
        tenant_id,line_public_id,invoice_public_id,line_type,adjustment_code,
        quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
      ) VALUES ('tenant-a','line-paid','inv-1','other_adjustment','TEST',1,10000,10000,'${'6'.repeat(64)}');
      INSERT INTO canonical_compensation_rules (
        tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
        practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
        calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
        priority,effective_from,effective_to,status,source_evidence_sha256
      ) VALUES ('tenant-a','rule-paid',1,'all',NULL,NULL,'prac-paid','performing',
                'performer_reserve','fixed',2000,'gross','ignore','exclude',0,NULL,
                10,'2026-01-01',NULL,'active','${'7'.repeat(64)}');
      INSERT INTO canonical_compensation_accruals (
        tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
        service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
        rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
        gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
        earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
        business_date,payable_projection_guard,source_evidence_sha256
      ) VALUES ('tenant-a','accrual-paid','inv-1','line-paid',NULL,'prac-paid','performing',
                'performer_reserve','rule-paid',1,'gross','fixed',2000,'BDT',10000,0,0,0,
                10000,2000,0,1000,1000,'partially_settled','2026-07-14T03:00:00.000Z',
                '2026-07-14',1,'${'8'.repeat(64)}');
    `);
    seedReceipt(sqlite, {
      receiptPublicId: 'receipt-payment-1',
      receiptNumber: 'R-PAY-1',
      totalMinor: 6000,
      allocatedMinor: 6000,
      tenderPublicId: 'tender-payment-1',
      allocationPublicId: 'alloc-payment-1',
      invoicePublicId: 'inv-1',
      tenderType: 'card',
    });

    await expect(reversePayment(db, reversePaymentInput())).rejects.toThrow(/compensation|paid|settlement/i);
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_payment_reversals`)).toBe(0);
  });

  it('persists partial and full reversal facts and restores invoice due exactly', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-1', invoiceNumber: 'INV-1', totalMinor: 10000, paidMinor: 6000 });
    seedReceipt(sqlite, {
      receiptPublicId: 'receipt-payment-1',
      receiptNumber: 'R-PAY-1',
      totalMinor: 6000,
      allocatedMinor: 6000,
      tenderPublicId: 'tender-payment-1',
      allocationPublicId: 'alloc-payment-1',
      invoicePublicId: 'inv-1',
      tenderType: 'card',
    });

    await expect(reversePayment(db, reversePaymentInput())).resolves.toMatchObject({
      status: 'applied',
      result: { reversedMinor: 2000, allocationRemainingMinor: 4000, invoiceNetDueMinor: 6000 },
    });
    expect(sqlite.prepare(`SELECT reversed_minor,remaining_minor,status FROM canonical_payment_allocations WHERE allocation_public_id='alloc-payment-1'`).get()).toEqual({
      reversed_minor: 2000,
      remaining_minor: 4000,
      status: 'active',
    });

    await expect(reversePayment(db, reversePaymentInput({
      reversalPublicId: 'pay-reversal-2',
      refundPublicId: 'refund-payment-2',
      amountMinor: 4000,
      sourcePublicId: 'runtime-payment-reversal-2',
      idempotencyKey: 'reverse-payment-2',
      outboxEventPublicId: 'outbox-payment-reversal-2',
    }))).resolves.toMatchObject({
      status: 'applied',
      result: { allocationRemainingMinor: 0, invoiceNetDueMinor: 10000 },
    });

    expect(sqlite.prepare(`SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices WHERE invoice_public_id='inv-1'`).get()).toEqual({
      paid_minor: 0,
      due_minor: 10000,
      net_due_minor: 10000,
    });
    expect(sqlite.prepare(`SELECT status,reversed_minor,remaining_minor FROM canonical_payment_allocations WHERE allocation_public_id='alloc-payment-1'`).get()).toEqual({
      status: 'reversed',
      reversed_minor: 6000,
      remaining_minor: 0,
    });
    expect(sqlite.prepare(`SELECT status,refunded_minor,net_received_minor FROM canonical_payment_receipts WHERE receipt_public_id='receipt-payment-1'`).get()).toEqual({
      status: 'reversed',
      refunded_minor: 6000,
      net_received_minor: 0,
    });
  });

  it('replays exactly, rejects semantic conflicts, and does not emit cash custody for non-cash reversal', async () => {
    const { sqlite, db } = harness();
    seedInvoice(sqlite, { invoicePublicId: 'inv-1', invoiceNumber: 'INV-1', totalMinor: 10000, paidMinor: 6000 });
    seedReceipt(sqlite, {
      receiptPublicId: 'receipt-payment-1',
      receiptNumber: 'R-PAY-1',
      totalMinor: 6000,
      allocatedMinor: 6000,
      tenderPublicId: 'tender-payment-1',
      allocationPublicId: 'alloc-payment-1',
      invoicePublicId: 'inv-1',
      tenderType: 'card',
    });

    const first = await reversePayment(db, reversePaymentInput());
    const replay = await reversePayment(db, reversePaymentInput());
    expect(first.status).toBe('applied');
    expect(replay.status).toBe('replayed');
    await expect(reversePayment(db, reversePaymentInput({ amountMinor: 1000 }))).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_payment_reversals`)).toBe(1);
    expect(scalar(sqlite, `SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.cash_custody.refund_recorded'`)).toBe(0);
  });
});
