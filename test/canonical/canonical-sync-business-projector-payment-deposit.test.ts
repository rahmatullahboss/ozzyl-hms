import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { projectCanonicalSyncBusinessMutation } from '../../src/lib/canonical/local-sync-business-projector';

class Statement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SQLInputValue[] = []) {}
  bind(...params: unknown[]) {
    return new Statement(this.sqlite, this.sql, params.map((value) => value === undefined ? null : value) as SQLInputValue[]);
  }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE patients (id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,sync_key TEXT);
    CREATE TABLE canonical_payment_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,receipt_public_id TEXT NOT NULL,
      receipt_number TEXT NOT NULL,legacy_patient_id INTEGER NOT NULL,currency_code TEXT NOT NULL,
      total_minor INTEGER NOT NULL,allocated_total_minor INTEGER NOT NULL,unallocated_minor INTEGER NOT NULL,
      status TEXT NOT NULL,received_at_utc TEXT NOT NULL,business_date TEXT NOT NULL,
      external_transaction_id TEXT,posted_at_utc TEXT,failed_at_utc TEXT,source_evidence_sha256 TEXT NOT NULL
    );
    CREATE TABLE canonical_payment_tenders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,tender_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,tender_type TEXT NOT NULL,method_code TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,status TEXT NOT NULL,external_transaction_id TEXT,
      captured_at_utc TEXT,failed_at_utc TEXT,source_evidence_sha256 TEXT NOT NULL
    );
    CREATE TABLE canonical_payment_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,allocation_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,invoice_line_public_id TEXT,
      amount_minor INTEGER NOT NULL,invoice_due_before_minor INTEGER NOT NULL,
      invoice_due_after_minor INTEGER NOT NULL,allocated_at_utc TEXT NOT NULL,
      source_evidence_sha256 TEXT NOT NULL
    );
    CREATE TABLE canonical_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,deposit_public_id TEXT NOT NULL,
      deposit_number TEXT NOT NULL,receipt_public_id TEXT NOT NULL,legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,amount_minor INTEGER NOT NULL,applied_minor INTEGER NOT NULL,
      refunded_minor INTEGER NOT NULL,available_minor INTEGER NOT NULL,status TEXT NOT NULL,
      received_at_utc TEXT NOT NULL,business_date TEXT NOT NULL,posted_at_utc TEXT NOT NULL,
      source_evidence_sha256 TEXT NOT NULL
    );
    CREATE TABLE canonical_deposit_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,application_public_id TEXT NOT NULL,
      deposit_public_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,invoice_line_public_id TEXT,
      amount_minor INTEGER NOT NULL,deposit_available_before_minor INTEGER NOT NULL,
      deposit_available_after_minor INTEGER NOT NULL,invoice_paid_before_minor INTEGER NOT NULL,
      invoice_paid_after_minor INTEGER NOT NULL,invoice_due_before_minor INTEGER NOT NULL,
      invoice_due_after_minor INTEGER NOT NULL,invoice_net_due_before_minor INTEGER NOT NULL,
      invoice_net_due_after_minor INTEGER NOT NULL,applied_at_utc TEXT NOT NULL,
      source_evidence_sha256 TEXT NOT NULL
    );
    CREATE TABLE canonical_payment_reversals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,reversal_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,tender_public_id TEXT NOT NULL,allocation_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,amount_minor INTEGER NOT NULL,reason_code TEXT NOT NULL,
      status TEXT NOT NULL,reversed_at_utc TEXT NOT NULL,business_date TEXT NOT NULL,
      allocation_reversed_before_minor INTEGER NOT NULL,allocation_reversed_after_minor INTEGER NOT NULL,
      tender_reversed_before_minor INTEGER NOT NULL,tender_reversed_after_minor INTEGER NOT NULL,
      receipt_refunded_before_minor INTEGER NOT NULL,receipt_refunded_after_minor INTEGER NOT NULL,
      invoice_paid_before_minor INTEGER NOT NULL,invoice_paid_after_minor INTEGER NOT NULL,
      invoice_due_before_minor INTEGER NOT NULL,invoice_due_after_minor INTEGER NOT NULL,
      invoice_net_due_before_minor INTEGER NOT NULL,invoice_net_due_after_minor INTEGER NOT NULL,
      compensation_guard INTEGER NOT NULL,balance_guard INTEGER NOT NULL,source_evidence_sha256 TEXT NOT NULL
    );
    CREATE TABLE canonical_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,refund_public_id TEXT NOT NULL,
      source_type TEXT NOT NULL,deposit_public_id TEXT,receipt_public_id TEXT,tender_public_id TEXT,
      allocation_public_id TEXT,payment_reversal_public_id TEXT,amount_minor INTEGER NOT NULL,
      tender_type TEXT NOT NULL,method_code TEXT NOT NULL,status TEXT NOT NULL,refunded_at_utc TEXT NOT NULL,
      business_date TEXT NOT NULL,reversed_at_utc TEXT,source_available_before_minor INTEGER,
      source_available_after_minor INTEGER,liability_guard INTEGER NOT NULL,source_evidence_sha256 TEXT NOT NULL
    );
    INSERT INTO patients VALUES (101,'100','uhid:P-001');
    INSERT INTO canonical_payment_receipts VALUES (
      NULL,'100','receipt-1','R-001',101,'BDT',1000,800,200,'reversed',
      '2026-07-25T04:00:00Z','2026-07-25','txn-receipt-1','2026-07-25T04:00:00Z',NULL,'${'a'.repeat(64)}'
    );
    INSERT INTO canonical_payment_tenders VALUES (
      NULL,'100','tender-1','receipt-1','cash','cash',1000,'reversed',NULL,
      '2026-07-25T04:00:00Z',NULL,'${'b'.repeat(64)}'
    );
    INSERT INTO canonical_payment_allocations VALUES (
      NULL,'100','allocation-1','receipt-1','invoice-1',NULL,800,1000,200,
      '2026-07-25T04:00:00Z','${'c'.repeat(64)}'
    );
    INSERT INTO canonical_deposits VALUES (
      NULL,'100','deposit-1','DEP-001','receipt-2',101,'BDT',500,200,100,200,'posted',
      '2026-07-25T05:00:00Z','2026-07-25','2026-07-25T05:00:00Z','${'d'.repeat(64)}'
    );
    INSERT INTO canonical_deposit_applications VALUES (
      NULL,'100','application-1','deposit-1','invoice-2',NULL,200,500,300,0,200,500,300,500,300,
      '2026-07-25T05:30:00Z','${'e'.repeat(64)}'
    );
    INSERT INTO canonical_payment_reversals VALUES (
      NULL,'100','reversal-1','receipt-1','tender-1','allocation-1','invoice-1',200,
      'operator_correction','posted','2026-07-25T06:00:00Z','2026-07-25',0,200,0,200,
      0,200,800,600,200,400,200,400,1,1,'${'f'.repeat(64)}'
    );
    INSERT INTO canonical_refunds VALUES (
      NULL,'100','refund-1','payment',NULL,'receipt-1','tender-1','allocation-1','reversal-1',
      200,'cash','cash','posted','2026-07-25T06:00:00Z','2026-07-25',NULL,NULL,NULL,1,
      '${'1'.repeat(64)}'
    );
    INSERT INTO canonical_refunds VALUES (
      NULL,'100','refund-deposit-1','deposit','deposit-1',NULL,NULL,NULL,NULL,
      100,'cash','cash','posted','2026-07-25T06:30:00Z','2026-07-25',NULL,300,200,1,
      '${'2'.repeat(64)}'
    );
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

describe('canonical sync payment and deposit projection', () => {
  it('projects posted receipt from immutable facts without copying later reversed status', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'payment_receipt',entityPublicId: 'receipt-1',
        eventType: 'canonical.payment.receipt.posted',occurredAtUtc: '2026-07-25T04:00:00Z',
        businessDate: '2026-07-25',event: {
          receiptPublicId: 'receipt-1',status: 'posted',totalMinor: 1000,allocatedMinor: 800,
          unallocatedMinor: 200,cashTenderMinor: 1000,
        },
      })).resolves.toEqual({
        kind: 'payment_receipt_recorded',entityPublicId: 'receipt-1',receiptNumber: 'R-001',
        patientSyncKey: 'uhid:P-001',currencyCode: 'BDT',totalMinor: 1000,
        allocatedTotalMinor: 800,unallocatedMinor: 200,status: 'posted',
        receivedAtUtc: '2026-07-25T04:00:00Z',businessDate: '2026-07-25',
        externalTransactionId: 'txn-receipt-1',postedAtUtc: '2026-07-25T04:00:00Z',failedAtUtc: null,
        sourceEvidenceSha256: 'a'.repeat(64),
        tenders: [{
          tenderPublicId: 'tender-1',tenderType: 'cash',methodCode: 'cash',amountMinor: 1000,
          status: 'captured',externalTransactionId: null,capturedAtUtc: '2026-07-25T04:00:00Z',
          failedAtUtc: null,sourceEvidenceSha256: 'b'.repeat(64),
        }],
        allocations: [{
          allocationPublicId: 'allocation-1',invoicePublicId: 'invoice-1',invoiceLinePublicId: null,
          amountMinor: 800,invoiceDueBeforeMinor: 1000,invoiceDueAfterMinor: 200,
          allocatedAtUtc: '2026-07-25T04:00:00Z',sourceEvidenceSha256: 'c'.repeat(64),
        }],
      });
    } finally { sqlite.close(); }
  });

  it('projects deposit record and application with exact outbox business date', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'deposit',entityPublicId: 'deposit-1',
        eventType: 'canonical.deposit.recorded',occurredAtUtc: '2026-07-25T05:00:00Z',
        businessDate: '2026-07-25',event: {
          depositPublicId: 'deposit-1',receiptPublicId: 'receipt-2',amountMinor: 500,
        },
      })).resolves.toMatchObject({
        kind: 'deposit_recorded',entityPublicId: 'deposit-1',depositNumber: 'DEP-001',
        receiptPublicId: 'receipt-2',patientSyncKey: 'uhid:P-001',amountMinor: 500,
        businessDate: '2026-07-25',
      });

      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'deposit',entityPublicId: 'deposit-1',
        eventType: 'canonical.deposit.applied',occurredAtUtc: '2026-07-25T05:30:00Z',
        businessDate: '2026-07-25',event: {
          applicationPublicId: 'application-1',depositPublicId: 'deposit-1',
          invoicePublicId: 'invoice-2',amountMinor: 200,
        },
      })).resolves.toEqual({
        kind: 'deposit_applied',entityPublicId: 'deposit-1',applicationPublicId: 'application-1',
        invoicePublicId: 'invoice-2',invoiceLinePublicId: null,amountMinor: 200,
        depositAvailableBeforeMinor: 500,depositAvailableAfterMinor: 300,
        invoicePaidBeforeMinor: 0,invoicePaidAfterMinor: 200,
        invoiceDueBeforeMinor: 500,invoiceDueAfterMinor: 300,
        invoiceNetDueBeforeMinor: 500,invoiceNetDueAfterMinor: 300,
        appliedAtUtc: '2026-07-25T05:30:00Z',businessDate: '2026-07-25',
        sourceEvidenceSha256: 'e'.repeat(64),
      });
    } finally { sqlite.close(); }
  });

  it('projects deposit refund from exact refund fact and cumulative balance authority', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'deposit',entityPublicId: 'deposit-1',
        eventType: 'canonical.deposit.refunded',occurredAtUtc: '2026-07-25T06:30:00Z',
        businessDate: '2026-07-25',event: {
          refundPublicId: 'refund-deposit-1',depositPublicId: 'deposit-1',
          amountMinor: 100,tenderType: 'cash',
        },
      })).resolves.toEqual({
        kind: 'deposit_refunded',entityPublicId: 'deposit-1',refundPublicId: 'refund-deposit-1',
        amountMinor: 100,tenderType: 'cash',methodCode: 'cash',
        refundedAtUtc: '2026-07-25T06:30:00Z',businessDate: '2026-07-25',
        depositAvailableBeforeMinor: 300,depositAvailableAfterMinor: 200,
        depositRefundedBeforeMinor: 0,depositRefundedAfterMinor: 100,
        depositSourceEvidenceSha256: 'd'.repeat(64),refundSourceEvidenceSha256: '2'.repeat(64),
      });

      sqlite.prepare(`UPDATE canonical_refunds SET source_available_after_minor=199 WHERE refund_public_id='refund-deposit-1'`).run();
      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'deposit',entityPublicId: 'deposit-1',
        eventType: 'canonical.deposit.refunded',occurredAtUtc: '2026-07-25T06:30:00Z',
        businessDate: '2026-07-25',event: {
          refundPublicId: 'refund-deposit-1',depositPublicId: 'deposit-1',amountMinor: 100,tenderType: 'cash',
        },
      })).rejects.toThrow(/balances/i);
    } finally { sqlite.close(); }
  });

  it('projects payment reversal from immutable reversal and refund facts', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'payment_receipt',entityPublicId: 'receipt-1',
        eventType: 'canonical.payment.reversed',occurredAtUtc: '2026-07-25T06:00:00Z',
        businessDate: '2026-07-25',event: {
          allocationPublicId: 'allocation-1',amountMinor: 200,receiptPublicId: 'receipt-1',
          refundPublicId: 'refund-1',reversalPublicId: 'reversal-1',tenderPublicId: 'tender-1',
        },
      })).resolves.toEqual({
        kind: 'payment_reversed',entityPublicId: 'receipt-1',reversalPublicId: 'reversal-1',
        refundPublicId: 'refund-1',receiptPublicId: 'receipt-1',tenderPublicId: 'tender-1',
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
      });
    } finally { sqlite.close(); }
  });

  it('fails closed when business date or compact event totals do not match', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'payment_receipt',entityPublicId: 'receipt-1',
        eventType: 'canonical.payment.receipt.posted',occurredAtUtc: '2026-07-25T04:00:00Z',
        businessDate: null,event: {
          receiptPublicId: 'receipt-1',status: 'posted',totalMinor: 1000,allocatedMinor: 800,
          unallocatedMinor: 200,cashTenderMinor: 1000,
        },
      })).rejects.toThrow(/business date/i);
      await expect(projectCanonicalSyncBusinessMutation(db, {
        tenantId: '100',entityType: 'deposit',entityPublicId: 'deposit-1',
        eventType: 'canonical.deposit.applied',occurredAtUtc: '2026-07-25T05:30:00Z',
        businessDate: '2026-07-25',event: {
          applicationPublicId: 'application-1',depositPublicId: 'deposit-1',
          invoicePublicId: 'invoice-2',amountMinor: 201,
        },
      })).rejects.toThrow(/event payload/i);
    } finally { sqlite.close(); }
  });
});
