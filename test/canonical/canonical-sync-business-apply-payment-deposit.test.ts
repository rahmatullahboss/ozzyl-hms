import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { claimCanonicalSyncInboxEvent, receiveCanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-inbox';
import { completeCanonicalSyncBusinessEvent } from '../../src/lib/canonical/local-sync-business-apply';
import { createCanonicalSyncBusinessPayload } from '../../src/lib/canonical/local-sync-business-payload';
import { createCanonicalSyncEnvelope, type CanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-protocol';

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(
      this.sqlite,
      this.sql,
      params.map((value) => value === undefined ? null : value) as SQLInputValue[],
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
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sync_key TEXT NOT NULL,
      UNIQUE (tenant_id,sync_key)
    );
    CREATE TABLE canonical_invoices (
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      paid_minor INTEGER NOT NULL,
      due_minor INTEGER NOT NULL,
      credited_minor INTEGER NOT NULL,
      net_due_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      PRIMARY KEY (tenant_id,invoice_public_id)
    );
    CREATE TABLE canonical_invoice_lines (
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      line_public_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id,invoice_public_id,line_public_id)
    );
    CREATE TABLE canonical_payment_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      receipt_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      allocated_total_minor INTEGER NOT NULL,
      unallocated_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      received_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      legacy_collector_id INTEGER,
      legacy_counter_id INTEGER,
      legacy_counter_session_id INTEGER,
      external_transaction_id TEXT,
      posted_at_utc TEXT,
      failed_at_utc TEXT,
      reversed_at_utc TEXT,
      reconciliation_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      refunded_minor INTEGER NOT NULL,
      net_received_minor INTEGER NOT NULL,
      refund_projection_guard INTEGER NOT NULL,
      UNIQUE (tenant_id,receipt_public_id),
      UNIQUE (tenant_id,receipt_number)
    );
    CREATE TABLE canonical_payment_tenders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      tender_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      tender_type TEXT NOT NULL,
      method_code TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      external_transaction_id TEXT,
      captured_at_utc TEXT,
      failed_at_utc TEXT,
      reversed_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      reversed_minor INTEGER NOT NULL,
      remaining_minor INTEGER NOT NULL,
      reversal_projection_guard INTEGER NOT NULL,
      UNIQUE (tenant_id,tender_public_id)
    );
    CREATE TABLE canonical_payment_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      allocation_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      invoice_line_public_id TEXT,
      amount_minor INTEGER NOT NULL,
      invoice_due_before_minor INTEGER NOT NULL,
      invoice_due_after_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      allocated_at_utc TEXT NOT NULL,
      reversed_at_utc TEXT,
      balance_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      reversed_minor INTEGER NOT NULL,
      remaining_minor INTEGER NOT NULL,
      reversal_projection_guard INTEGER NOT NULL,
      UNIQUE (tenant_id,allocation_public_id)
    );
    CREATE TABLE canonical_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      deposit_public_id TEXT NOT NULL,
      deposit_number TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      applied_minor INTEGER NOT NULL,
      refunded_minor INTEGER NOT NULL,
      available_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      received_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      posted_at_utc TEXT NOT NULL,
      reversed_at_utc TEXT,
      reconciliation_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id,deposit_public_id),
      UNIQUE (tenant_id,deposit_number),
      UNIQUE (tenant_id,receipt_public_id)
    );
    CREATE TABLE canonical_deposit_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      application_public_id TEXT NOT NULL,
      deposit_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      invoice_line_public_id TEXT,
      amount_minor INTEGER NOT NULL,
      deposit_available_before_minor INTEGER NOT NULL,
      deposit_available_after_minor INTEGER NOT NULL,
      invoice_paid_before_minor INTEGER NOT NULL,
      invoice_paid_after_minor INTEGER NOT NULL,
      invoice_due_before_minor INTEGER NOT NULL,
      invoice_due_after_minor INTEGER NOT NULL,
      invoice_net_due_before_minor INTEGER NOT NULL,
      invoice_net_due_after_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      applied_at_utc TEXT NOT NULL,
      reversed_at_utc TEXT,
      balance_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id,application_public_id)
    );
    CREATE TABLE canonical_payment_reversals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      reversal_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      tender_public_id TEXT NOT NULL,
      allocation_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      reason_code TEXT NOT NULL,
      status TEXT NOT NULL,
      reversed_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      allocation_reversed_before_minor INTEGER NOT NULL,
      allocation_reversed_after_minor INTEGER NOT NULL,
      tender_reversed_before_minor INTEGER NOT NULL,
      tender_reversed_after_minor INTEGER NOT NULL,
      receipt_refunded_before_minor INTEGER NOT NULL,
      receipt_refunded_after_minor INTEGER NOT NULL,
      invoice_paid_before_minor INTEGER NOT NULL,
      invoice_paid_after_minor INTEGER NOT NULL,
      invoice_due_before_minor INTEGER NOT NULL,
      invoice_due_after_minor INTEGER NOT NULL,
      invoice_net_due_before_minor INTEGER NOT NULL,
      invoice_net_due_after_minor INTEGER NOT NULL,
      compensation_guard INTEGER NOT NULL,
      balance_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id,reversal_public_id)
    );
    CREATE TABLE canonical_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      refund_public_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      deposit_public_id TEXT,
      receipt_public_id TEXT,
      tender_public_id TEXT,
      allocation_public_id TEXT,
      payment_reversal_public_id TEXT,
      amount_minor INTEGER NOT NULL,
      tender_type TEXT NOT NULL,
      method_code TEXT NOT NULL,
      status TEXT NOT NULL,
      refunded_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,
      reversed_at_utc TEXT,
      source_available_before_minor INTEGER,
      source_available_after_minor INTEGER,
      liability_guard INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id,refund_public_id)
    );
    CREATE TABLE canonical_compensation_accruals (
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      settled_minor INTEGER NOT NULL
    );
    INSERT INTO patients VALUES (101,'100','uhid:P-001');
    INSERT INTO canonical_invoices VALUES (
      '100','invoice-1',1000,0,1000,0,1000,'posted','2026-07-25T01:00:00Z'
    );
    INSERT INTO canonical_invoices VALUES (
      '100','invoice-2',500,0,500,0,500,'posted','2026-07-25T01:00:00Z'
    );
  `);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));

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

async function paymentEnvelope(input: {
  receiptPublicId: string;
  eventPublicId: string;
  receiptNumber: string;
  totalMinor: number;
  allocatedMinor: number;
  unallocatedMinor: number;
  status?: 'posted' | 'pending' | 'failed';
  invoicePublicId?: string;
  allocationPublicId?: string;
  tenderPublicId?: string;
  occurredAtUtc?: string;
}) {
  const status = input.status ?? 'posted';
  const occurredAtUtc = input.occurredAtUtc ?? '2026-07-25T04:00:00Z';
  const tenderStatus = status === 'posted' ? 'captured' : status === 'pending' ? 'verifying' : 'failed';
  const allocations = input.allocatedMinor > 0
    ? [{
        allocationPublicId: input.allocationPublicId ?? 'allocation-1',
        invoicePublicId: input.invoicePublicId ?? 'invoice-1',
        invoiceLinePublicId: null,
        amountMinor: input.allocatedMinor,
        invoiceDueBeforeMinor: input.invoicePublicId === 'invoice-2' ? 500 : 1000,
        invoiceDueAfterMinor: (input.invoicePublicId === 'invoice-2' ? 500 : 1000) - input.allocatedMinor,
        allocatedAtUtc: occurredAtUtc,
        sourceEvidenceSha256: 'c'.repeat(64),
      }]
    : [];
  const eventType = status === 'posted'
    ? 'canonical.payment.receipt.posted'
    : status === 'pending'
      ? 'canonical.payment.receipt.pending'
      : 'canonical.payment.receipt.failed';
  return createCanonicalSyncEnvelope({
    tenantId: '100',
    eventPublicId: input.eventPublicId,
    entityType: 'payment_receipt',
    entityPublicId: input.receiptPublicId,
    eventType,
    aggregateVersion: 1,
    operation: 'upsert',
    occurredAtUtc,
    sourceNodePublicId: 'node-local-1',
    payload: createCanonicalSyncBusinessPayload({
      event: {
        receiptPublicId: input.receiptPublicId,
        status,
        totalMinor: input.totalMinor,
        allocatedMinor: input.allocatedMinor,
        unallocatedMinor: input.unallocatedMinor,
        cashTenderMinor: status === 'posted' ? input.totalMinor : 0,
      },
      mutation: {
        kind: 'payment_receipt_recorded',
        entityPublicId: input.receiptPublicId,
        receiptNumber: input.receiptNumber,
        patientSyncKey: 'uhid:P-001',
        currencyCode: 'BDT',
        totalMinor: input.totalMinor,
        allocatedTotalMinor: input.allocatedMinor,
        unallocatedMinor: input.unallocatedMinor,
        status,
        receivedAtUtc: occurredAtUtc,
        businessDate: '2026-07-25',
        externalTransactionId: null,
        postedAtUtc: status === 'posted' ? occurredAtUtc : null,
        failedAtUtc: status === 'failed' ? occurredAtUtc : null,
        sourceEvidenceSha256: 'a'.repeat(64),
        tenders: [{
          tenderPublicId: input.tenderPublicId ?? `tender-${input.receiptPublicId}`,
          tenderType: 'cash',
          methodCode: 'cash',
          amountMinor: input.totalMinor,
          status: tenderStatus,
          externalTransactionId: null,
          capturedAtUtc: status === 'posted' ? occurredAtUtc : null,
          failedAtUtc: status === 'failed' ? occurredAtUtc : null,
          sourceEvidenceSha256: 'b'.repeat(64),
        }],
        allocations,
      },
    }),
  });
}

async function reversalEnvelope() {
  return createCanonicalSyncEnvelope({
    tenantId: '100',
    eventPublicId: 'outbox-reversal-1',
    entityType: 'payment_receipt',
    entityPublicId: 'receipt-1',
    eventType: 'canonical.payment.reversed',
    aggregateVersion: 2,
    operation: 'tombstone',
    occurredAtUtc: '2026-07-25T06:00:00Z',
    sourceNodePublicId: 'node-local-1',
    payload: createCanonicalSyncBusinessPayload({
      event: {
        allocationPublicId: 'allocation-1',amountMinor: 200,receiptPublicId: 'receipt-1',
        refundPublicId: 'refund-1',reversalPublicId: 'reversal-1',tenderPublicId: 'tender-receipt-1',
      },
      mutation: {
        kind: 'payment_reversed',entityPublicId: 'receipt-1',reversalPublicId: 'reversal-1',
        refundPublicId: 'refund-1',receiptPublicId: 'receipt-1',tenderPublicId: 'tender-receipt-1',
        allocationPublicId: 'allocation-1',invoicePublicId: 'invoice-1',amountMinor: 200,
        reasonCode: 'operator_correction',tenderType: 'cash',methodCode: 'cash',
        reversedAtUtc: '2026-07-25T06:00:00Z',businessDate: '2026-07-25',
        allocationReversedBeforeMinor: 0,allocationReversedAfterMinor: 200,
        tenderReversedBeforeMinor: 0,tenderReversedAfterMinor: 200,
        receiptRefundedBeforeMinor: 0,receiptRefundedAfterMinor: 200,
        invoicePaidBeforeMinor: 800,invoicePaidAfterMinor: 600,
        invoiceDueBeforeMinor: 200,invoiceDueAfterMinor: 400,
        invoiceNetDueBeforeMinor: 200,invoiceNetDueAfterMinor: 400,
        sourceEvidenceSha256: 'f'.repeat(64),refundSourceEvidenceSha256: '1'.repeat(64),
      },
    }),
  });
}

async function depositEnvelope(input: {
  eventType: 'canonical.deposit.recorded' | 'canonical.deposit.applied' | 'canonical.deposit.refunded';
  eventPublicId: string;
  aggregateVersion: number;
}) {
  if (input.eventType === 'canonical.deposit.recorded') {
    return createCanonicalSyncEnvelope({
      tenantId: '100',
      eventPublicId: input.eventPublicId,
      entityType: 'deposit',
      entityPublicId: 'deposit-1',
      eventType: input.eventType,
      aggregateVersion: input.aggregateVersion,
      operation: 'upsert',
      occurredAtUtc: '2026-07-25T05:00:00Z',
      sourceNodePublicId: 'node-local-1',
      payload: createCanonicalSyncBusinessPayload({
        event: { depositPublicId: 'deposit-1', receiptPublicId: 'receipt-2', amountMinor: 500 },
        mutation: {
          kind: 'deposit_recorded',
          entityPublicId: 'deposit-1',
          depositNumber: 'DEP-001',
          receiptPublicId: 'receipt-2',
          patientSyncKey: 'uhid:P-001',
          currencyCode: 'BDT',
          amountMinor: 500,
          receivedAtUtc: '2026-07-25T05:00:00Z',
          businessDate: '2026-07-25',
          postedAtUtc: '2026-07-25T05:00:00Z',
          sourceEvidenceSha256: 'd'.repeat(64),
        },
      }),
    });
  }
  if (input.eventType === 'canonical.deposit.refunded') {
    return createCanonicalSyncEnvelope({
      tenantId: '100',
      eventPublicId: input.eventPublicId,
      entityType: 'deposit',
      entityPublicId: 'deposit-1',
      eventType: input.eventType,
      aggregateVersion: input.aggregateVersion,
      operation: 'upsert',
      occurredAtUtc: '2026-07-25T06:30:00Z',
      sourceNodePublicId: 'node-local-1',
      payload: createCanonicalSyncBusinessPayload({
        event: {
          refundPublicId: 'refund-deposit-1',
          depositPublicId: 'deposit-1',
          amountMinor: 100,
          tenderType: 'cash',
        },
        mutation: {
          kind: 'deposit_refunded',
          entityPublicId: 'deposit-1',
          refundPublicId: 'refund-deposit-1',
          amountMinor: 100,
          tenderType: 'cash',
          methodCode: 'cash',
          refundedAtUtc: '2026-07-25T06:30:00Z',
          businessDate: '2026-07-25',
          depositAvailableBeforeMinor: 300,
          depositAvailableAfterMinor: 200,
          depositRefundedBeforeMinor: 0,
          depositRefundedAfterMinor: 100,
          depositSourceEvidenceSha256: 'd'.repeat(64),
          refundSourceEvidenceSha256: 'f'.repeat(64),
        },
      }),
    });
  }
  return createCanonicalSyncEnvelope({
    tenantId: '100',
    eventPublicId: input.eventPublicId,
    entityType: 'deposit',
    entityPublicId: 'deposit-1',
    eventType: input.eventType,
    aggregateVersion: input.aggregateVersion,
    operation: 'upsert',
    occurredAtUtc: '2026-07-25T05:30:00Z',
    sourceNodePublicId: 'node-local-1',
    payload: createCanonicalSyncBusinessPayload({
      event: {
        applicationPublicId: 'application-1',
        depositPublicId: 'deposit-1',
        invoicePublicId: 'invoice-2',
        amountMinor: 200,
      },
      mutation: {
        kind: 'deposit_applied',
        entityPublicId: 'deposit-1',
        applicationPublicId: 'application-1',
        invoicePublicId: 'invoice-2',
        invoiceLinePublicId: null,
        amountMinor: 200,
        depositAvailableBeforeMinor: 500,
        depositAvailableAfterMinor: 300,
        invoicePaidBeforeMinor: 0,
        invoicePaidAfterMinor: 200,
        invoiceDueBeforeMinor: 500,
        invoiceDueAfterMinor: 300,
        invoiceNetDueBeforeMinor: 500,
        invoiceNetDueAfterMinor: 300,
        appliedAtUtc: '2026-07-25T05:30:00Z',
        businessDate: '2026-07-25',
        sourceEvidenceSha256: 'e'.repeat(64),
      },
    }),
  });
}

async function receiveClaimApply(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  index: number,
) {
  const minute = String(index).padStart(2, '0');
  await receiveCanonicalSyncEnvelope(db, envelope, `2026-07-25T08:${minute}:00Z`);
  const claim = await claimCanonicalSyncInboxEvent(db, {
    tenantId: envelope.tenantId,
    eventPublicId: envelope.eventPublicId,
    claimPublicId: `claim-${envelope.eventPublicId}`,
    claimOwnerPublicId: 'worker-offline-1',
    claimedAtUtc: `2026-07-25T08:${minute}:10Z`,
    claimExpiresAtUtc: `2026-07-25T09:${minute}:10Z`,
  });
  await completeCanonicalSyncBusinessEvent(db, {
    envelope,
    claimPublicId: claim.claimPublicId,
    appliedAtUtc: `2026-07-25T08:${minute}:20Z`,
  });
}

describe('canonical sync payment and deposit business apply', () => {
  it('applies a posted receipt, tender, allocation, and invoice balance atomically', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await paymentEnvelope({
        receiptPublicId: 'receipt-1',
        eventPublicId: 'outbox-receipt-1',
        receiptNumber: 'R-001',
        totalMinor: 1000,
        allocatedMinor: 800,
        unallocatedMinor: 200,
      });
      await receiveClaimApply(db, envelope, 1);

      expect(sqlite.prepare(`SELECT status,total_minor,allocated_total_minor,unallocated_minor FROM canonical_payment_receipts`).get())
        .toEqual({ status: 'posted', total_minor: 1000, allocated_total_minor: 800, unallocated_minor: 200 });
      expect(sqlite.prepare(`SELECT status,reversed_minor,remaining_minor FROM canonical_payment_tenders`).get())
        .toEqual({ status: 'captured', reversed_minor: 0, remaining_minor: 1000 });
      expect(sqlite.prepare(`SELECT amount_minor,invoice_due_before_minor,invoice_due_after_minor FROM canonical_payment_allocations`).get())
        .toEqual({ amount_minor: 800, invoice_due_before_minor: 1000, invoice_due_after_minor: 200 });
      expect(sqlite.prepare(`SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices WHERE invoice_public_id='invoice-1'`).get())
        .toEqual({ paid_minor: 800, due_minor: 200, net_due_minor: 200 });
      expect(sqlite.prepare(`SELECT applied_version FROM canonical_sync_entity_versions WHERE entity_type='payment_receipt'`).get())
        .toEqual({ applied_version: 1 });
    } finally { sqlite.close(); }
  });

  it('applies payment reversal, refund, and all balance projections atomically', async () => {
    const { sqlite, db } = harness();
    try {
      await receiveClaimApply(db, await paymentEnvelope({
        receiptPublicId: 'receipt-1',eventPublicId: 'outbox-receipt-1',receiptNumber: 'R-001',
        totalMinor: 1000,allocatedMinor: 800,unallocatedMinor: 200,
      }), 1);
      await receiveClaimApply(db, await reversalEnvelope(), 2);

      expect(sqlite.prepare(`SELECT amount_minor,balance_guard FROM canonical_payment_reversals`).get())
        .toEqual({ amount_minor: 200, balance_guard: 1 });
      expect(sqlite.prepare(`SELECT amount_minor,status FROM canonical_refunds`).get())
        .toEqual({ amount_minor: 200, status: 'posted' });
      expect(sqlite.prepare(`SELECT reversed_minor,remaining_minor,status FROM canonical_payment_allocations`).get())
        .toEqual({ reversed_minor: 200, remaining_minor: 600, status: 'active' });
      expect(sqlite.prepare(`SELECT reversed_minor,remaining_minor,status FROM canonical_payment_tenders`).get())
        .toEqual({ reversed_minor: 200, remaining_minor: 800, status: 'captured' });
      expect(sqlite.prepare(`SELECT refunded_minor,net_received_minor,status FROM canonical_payment_receipts`).get())
        .toEqual({ refunded_minor: 200, net_received_minor: 800, status: 'posted' });
      expect(sqlite.prepare(`SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices WHERE invoice_public_id='invoice-1'`).get())
        .toEqual({ paid_minor: 600, due_minor: 400, net_due_minor: 400 });
      expect(sqlite.prepare(`SELECT applied_version,last_event_public_id FROM canonical_sync_entity_versions WHERE entity_type='payment_receipt'`).get())
        .toEqual({ applied_version: 2, last_event_public_id: 'outbox-reversal-1' });
    } finally { sqlite.close(); }
  });

  it('rolls back payment reversal when settled compensation blocks it', async () => {
    const { sqlite, db } = harness();
    try {
      await receiveClaimApply(db, await paymentEnvelope({
        receiptPublicId: 'receipt-1',eventPublicId: 'outbox-receipt-1',receiptNumber: 'R-001',
        totalMinor: 1000,allocatedMinor: 800,unallocatedMinor: 200,
      }), 1);
      sqlite.prepare(`INSERT INTO canonical_compensation_accruals VALUES ('100','invoice-1',1)`).run();
      const envelope = await reversalEnvelope();
      await receiveCanonicalSyncEnvelope(db, envelope, '2026-07-25T08:02:00Z');
      const claim = await claimCanonicalSyncInboxEvent(db, {
        tenantId: '100',eventPublicId: envelope.eventPublicId,claimPublicId: 'claim-reversal-blocked',
        claimOwnerPublicId: 'worker-offline-1',claimedAtUtc: '2026-07-25T08:02:10Z',
        claimExpiresAtUtc: '2026-07-25T09:02:10Z',
      });
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope,claimPublicId: claim.claimPublicId,appliedAtUtc: '2026-07-25T08:02:20Z',
      })).rejects.toThrow();
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_payment_reversals`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_refunds`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT refunded_minor,net_received_minor FROM canonical_payment_receipts`).get())
        .toEqual({ refunded_minor: 0, net_received_minor: 1000 });
      expect(sqlite.prepare(`SELECT applied_version FROM canonical_sync_entity_versions WHERE entity_type='payment_receipt'`).get())
        .toEqual({ applied_version: 1 });
    } finally { sqlite.close(); }
  });

  it('applies a pending receipt without allocations or invoice mutation', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await paymentEnvelope({
        receiptPublicId: 'receipt-pending',
        eventPublicId: 'outbox-receipt-pending',
        receiptNumber: 'R-PENDING',
        totalMinor: 300,
        allocatedMinor: 0,
        unallocatedMinor: 300,
        status: 'pending',
      });
      await receiveClaimApply(db, envelope, 2);
      expect(sqlite.prepare(`SELECT status,posted_at_utc,failed_at_utc FROM canonical_payment_receipts`).get())
        .toEqual({ status: 'pending', posted_at_utc: null, failed_at_utc: null });
      expect(sqlite.prepare(`SELECT status FROM canonical_payment_tenders`).get()).toEqual({ status: 'verifying' });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_payment_allocations`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT paid_minor,due_minor FROM canonical_invoices WHERE invoice_public_id='invoice-1'`).get())
        .toEqual({ paid_minor: 0, due_minor: 1000 });
    } finally { sqlite.close(); }
  });

  it('rolls back receipt, tender, version, and inbox completion when invoice balance is stale', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`UPDATE canonical_invoices SET due_minor=900,paid_minor=100,net_due_minor=900 WHERE invoice_public_id='invoice-1'`).run();
      const envelope = await paymentEnvelope({
        receiptPublicId: 'receipt-1',
        eventPublicId: 'outbox-receipt-1',
        receiptNumber: 'R-001',
        totalMinor: 1000,
        allocatedMinor: 800,
        unallocatedMinor: 200,
      });
      await receiveCanonicalSyncEnvelope(db, envelope, '2026-07-25T08:03:00Z');
      const claim = await claimCanonicalSyncInboxEvent(db, {
        tenantId: '100',eventPublicId: envelope.eventPublicId,claimPublicId: 'claim-stale-payment',
        claimOwnerPublicId: 'worker-offline-1',claimedAtUtc: '2026-07-25T08:03:10Z',claimExpiresAtUtc: '2026-07-25T09:03:10Z',
      });
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope,claimPublicId: claim.claimPublicId,appliedAtUtc: '2026-07-25T08:03:20Z',
      })).rejects.toThrow();
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_payment_receipts`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_payment_tenders`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_entity_versions`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT status FROM canonical_sync_inbox_events WHERE event_public_id='outbox-receipt-1'`).get())
        .toEqual({ status: 'applying' });
    } finally { sqlite.close(); }
  });

  it('applies deposit record, application, and refund as aggregate versions one through three', async () => {
    const { sqlite, db } = harness();
    try {
      const receipt = await paymentEnvelope({
        receiptPublicId: 'receipt-2',
        eventPublicId: 'outbox-receipt-2',
        receiptNumber: 'R-002',
        totalMinor: 500,
        allocatedMinor: 0,
        unallocatedMinor: 500,
        occurredAtUtc: '2026-07-25T05:00:00Z',
      });
      await receiveClaimApply(db, receipt, 4);
      await receiveClaimApply(db, await depositEnvelope({
        eventType: 'canonical.deposit.recorded',eventPublicId: 'outbox-deposit-1',aggregateVersion: 1,
      }), 5);
      await receiveClaimApply(db, await depositEnvelope({
        eventType: 'canonical.deposit.applied',eventPublicId: 'outbox-deposit-apply-1',aggregateVersion: 2,
      }), 6);
      await receiveClaimApply(db, await depositEnvelope({
        eventType: 'canonical.deposit.refunded',eventPublicId: 'outbox-deposit-refund-1',aggregateVersion: 3,
      }), 7);

      expect(sqlite.prepare(`SELECT applied_minor,refunded_minor,available_minor,status FROM canonical_deposits`).get())
        .toEqual({ applied_minor: 200, refunded_minor: 100, available_minor: 200, status: 'posted' });
      expect(sqlite.prepare(`SELECT amount_minor,deposit_available_after_minor,invoice_paid_after_minor FROM canonical_deposit_applications`).get())
        .toEqual({ amount_minor: 200, deposit_available_after_minor: 300, invoice_paid_after_minor: 200 });
      expect(sqlite.prepare(`
        SELECT source_type,deposit_public_id,amount_minor,status,source_available_before_minor,source_available_after_minor
        FROM canonical_refunds WHERE refund_public_id='refund-deposit-1'
      `).get()).toEqual({
        source_type: 'deposit',deposit_public_id: 'deposit-1',amount_minor: 100,status: 'posted',
        source_available_before_minor: 300,source_available_after_minor: 200,
      });
      expect(sqlite.prepare(`SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices WHERE invoice_public_id='invoice-2'`).get())
        .toEqual({ paid_minor: 200, due_minor: 300, net_due_minor: 300 });
      expect(sqlite.prepare(`SELECT applied_version,last_event_public_id FROM canonical_sync_entity_versions WHERE entity_type='deposit'`).get())
        .toEqual({ applied_version: 3, last_event_public_id: 'outbox-deposit-refund-1' });
    } finally { sqlite.close(); }
  });

  it('rolls back deposit refund when target balances are stale', async () => {
    const { sqlite, db } = harness();
    try {
      const receipt = await paymentEnvelope({
        receiptPublicId: 'receipt-2',eventPublicId: 'outbox-receipt-2',receiptNumber: 'R-002',
        totalMinor: 500,allocatedMinor: 0,unallocatedMinor: 500,occurredAtUtc: '2026-07-25T05:00:00Z',
      });
      await receiveClaimApply(db, receipt, 4);
      await receiveClaimApply(db, await depositEnvelope({
        eventType: 'canonical.deposit.recorded',eventPublicId: 'outbox-deposit-1',aggregateVersion: 1,
      }), 5);
      await receiveClaimApply(db, await depositEnvelope({
        eventType: 'canonical.deposit.applied',eventPublicId: 'outbox-deposit-apply-1',aggregateVersion: 2,
      }), 6);
      sqlite.prepare(`
        UPDATE canonical_deposits SET refunded_minor=50,available_minor=250
        WHERE deposit_public_id='deposit-1'
      `).run();
      const envelope = await depositEnvelope({
        eventType: 'canonical.deposit.refunded',eventPublicId: 'outbox-deposit-refund-1',aggregateVersion: 3,
      });
      await receiveCanonicalSyncEnvelope(db, envelope, '2026-07-25T08:08:00Z');
      const claim = await claimCanonicalSyncInboxEvent(db, {
        tenantId: '100',eventPublicId: envelope.eventPublicId,claimPublicId: 'claim-stale-deposit-refund',
        claimOwnerPublicId: 'worker-offline-1',claimedAtUtc: '2026-07-25T08:08:10Z',
        claimExpiresAtUtc: '2026-07-25T09:08:10Z',
      });
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope,claimPublicId: claim.claimPublicId,appliedAtUtc: '2026-07-25T08:08:20Z',
      })).rejects.toThrow();
      expect(sqlite.prepare(`
        SELECT applied_minor,refunded_minor,available_minor FROM canonical_deposits
      `).get()).toEqual({ applied_minor: 200, refunded_minor: 50, available_minor: 250 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_refunds`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`
        SELECT applied_version,last_event_public_id FROM canonical_sync_entity_versions WHERE entity_type='deposit'
      `).get()).toEqual({ applied_version: 2, last_event_public_id: 'outbox-deposit-apply-1' });
      expect(sqlite.prepare(`
        SELECT status FROM canonical_sync_inbox_events WHERE event_public_id='outbox-deposit-refund-1'
      `).get()).toEqual({ status: 'applying' });
    } finally { sqlite.close(); }
  });

  it('rolls back deposit application when available balance is stale', async () => {
    const { sqlite, db } = harness();
    try {
      const receipt = await paymentEnvelope({
        receiptPublicId: 'receipt-2',eventPublicId: 'outbox-receipt-2',receiptNumber: 'R-002',
        totalMinor: 500,allocatedMinor: 0,unallocatedMinor: 500,occurredAtUtc: '2026-07-25T05:00:00Z',
      });
      await receiveClaimApply(db, receipt, 7);
      await receiveClaimApply(db, await depositEnvelope({
        eventType: 'canonical.deposit.recorded',eventPublicId: 'outbox-deposit-1',aggregateVersion: 1,
      }), 8);
      sqlite.prepare(`UPDATE canonical_deposits SET applied_minor=50,available_minor=450`).run();
      const envelope = await depositEnvelope({
        eventType: 'canonical.deposit.applied',eventPublicId: 'outbox-deposit-apply-1',aggregateVersion: 2,
      });
      await receiveCanonicalSyncEnvelope(db, envelope, '2026-07-25T08:09:00Z');
      const claim = await claimCanonicalSyncInboxEvent(db, {
        tenantId: '100',eventPublicId: envelope.eventPublicId,claimPublicId: 'claim-stale-deposit',
        claimOwnerPublicId: 'worker-offline-1',claimedAtUtc: '2026-07-25T08:09:10Z',claimExpiresAtUtc: '2026-07-25T09:09:10Z',
      });
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope,claimPublicId: claim.claimPublicId,appliedAtUtc: '2026-07-25T08:09:20Z',
      })).rejects.toThrow();
      expect(sqlite.prepare(`SELECT applied_minor,available_minor FROM canonical_deposits`).get())
        .toEqual({ applied_minor: 50, available_minor: 450 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_deposit_applications`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT applied_version FROM canonical_sync_entity_versions WHERE entity_type='deposit'`).get())
        .toEqual({ applied_version: 1 });
      expect(sqlite.prepare(`SELECT status FROM canonical_sync_inbox_events WHERE event_public_id='outbox-deposit-apply-1'`).get())
        .toEqual({ status: 'applying' });
    } finally { sqlite.close(); }
  });
});
