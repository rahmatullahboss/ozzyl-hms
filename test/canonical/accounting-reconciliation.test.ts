import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  postCanonicalAccountingEvent,
  postPendingCanonicalAccountingEvents,
  reverseCanonicalAccountingVoucher,
  type CanonicalAccountingDatabase,
  type CanonicalAccountingPreparedStatement,
} from '../../src/lib/canonical/accounting-poster';
import { createCashLedgerEntry, shadowCreateCashLedgerEntry } from '../../src/lib/cash-ledger-writer';
import type { CanonicalBatchDatabase } from '../../src/lib/canonical/command-batch';
import { issueInvoiceWithSettlement } from '../../src/lib/canonical/commands/issue-invoice-settlement';
import { finalizeIpdDischargeBilling } from '../../src/lib/canonical/commands/finalize-ipd-discharge-billing';
import { createLabOrderBilling } from '../../src/lib/canonical/commands/create-lab-order-billing';
import { recordCashCustodyMovement } from '../../src/lib/canonical/contracts/manage-cash-custody';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalAccountingPreparedStatement {
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

const MIGRATIONS = [
  '0505_canonical_program_foundation.sql',
  '0506_canonical_practitioners.sql',
  '0507_canonical_encounters.sql',
  '0508_canonical_service_catalog.sql',
  '0509_canonical_service_requests_events.sql',
  '0510_canonical_invoices.sql',
  '0511_canonical_payments.sql',
  '0512_canonical_adjustments.sql',
  '0513_canonical_practitioner_compensation.sql',
  '0514_canonical_inventory_links.sql',
  '0515_canonical_accounting_outbox.sql',
  '0532_canonical_financial_batch_assertions.sql',
  '0533_canonical_credit_note_cash_refunds.sql',
  '0535_canonical_invoice_encounter_links.sql',
] as const;

function applyMigrations(sqlite: DatabaseSync): void {
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of MIGRATIONS) {
    sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sequence_counters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      counter_type TEXT NOT NULL,
      prefix TEXT NOT NULL DEFAULT '',
      current_value INTEGER NOT NULL DEFAULT 0,
      tenant_id TEXT NOT NULL,
      UNIQUE(counter_type,tenant_id)
    );
  `);
  sqlite.exec(readFileSync('migrations/0369_cash_ledger_entries.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0370_cash_ledger_shadow_issues.sql', 'utf8'));
}

function harness(controls: { beforeBatch?: (sqlite: DatabaseSync) => void } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const db: CanonicalAccountingDatabase = {
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
  seedAccountingConfiguration(sqlite);
  return { sqlite, db };
}

const HASH = 'a'.repeat(64);
const NOW = '2026-07-14T07:00:00.000Z';
const DATE = '2026-07-14';

function seedAccountingConfiguration(sqlite: DatabaseSync, tenantId = 'tenant-a'): void {
  const accounts = [
    ['acct-ar', '1100', 'Accounts Receivable', 'asset', 'debit'],
    ['acct-cash', '1000', 'Cash on Hand', 'asset', 'debit'],
    ['acct-bank', '1010', 'Bank and Wallet', 'asset', 'debit'],
    ['acct-inventory', '1200', 'Inventory Asset', 'asset', 'debit'],
    ['acct-ap', '2000', 'Accounts Payable', 'liability', 'credit'],
    ['acct-deposit', '2100', 'Patient Deposit Liability', 'liability', 'credit'],
    ['acct-payroll', '2200', 'Payroll Payable', 'liability', 'credit'],
    ['acct-practitioner', '2300', 'Practitioner Payable', 'liability', 'credit'],
    ['acct-revenue', '4000', 'Patient Revenue', 'revenue', 'credit'],
    ['acct-returns', '4050', 'Sales Returns', 'contra_revenue', 'debit'],
    ['acct-expense', '5000', 'Operating Expense', 'expense', 'debit'],
    ['acct-payroll-expense', '5100', 'Payroll Expense', 'expense', 'debit'],
  ] as const;
  for (const [publicId, code, name, type, normalBalance] of accounts) {
    sqlite.prepare(`
      INSERT INTO canonical_accounting_accounts (
        tenant_id,account_public_id,account_code,display_name,account_type,
        normal_balance,status,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,'active',?)
    `).run(tenantId, publicId, code, name, type, normalBalance, HASH);
  }
  const mappings = [
    ['accounts_receivable', 'acct-ar'],
    ['cash_on_hand', 'acct-cash'],
    ['bank_and_wallet', 'acct-bank'],
    ['inventory_asset', 'acct-inventory'],
    ['accounts_payable', 'acct-ap'],
    ['patient_deposit_liability', 'acct-deposit'],
    ['payroll_payable', 'acct-payroll'],
    ['practitioner_payable', 'acct-practitioner'],
    ['patient_revenue', 'acct-revenue'],
    ['sales_returns', 'acct-returns'],
    ['expense_default', 'acct-expense'],
    ['payroll_expense', 'acct-payroll-expense'],
  ] as const;
  for (const [key, accountPublicId] of mappings) {
    sqlite.prepare(`
      INSERT INTO canonical_accounting_mappings (
        tenant_id,mapping_key,account_public_id,status,source_evidence_sha256
      ) VALUES (?,?,?,'active',?)
    `).run(tenantId, key, accountPublicId, HASH);
  }
  sqlite.prepare(`
    INSERT INTO canonical_accounting_periods (
      tenant_id,period_public_id,period_name,start_date,end_date,status,
      source_evidence_sha256
    ) VALUES (?,?,?,?,?,'open',?)
  `).run(tenantId, `period-${tenantId}-2026-07`, '2026-07', '2026-07-01', '2026-07-31', HASH);
}

function seedOutbox(
  sqlite: DatabaseSync,
  input: {
    tenantId?: string;
    eventPublicId: string;
    aggregateType: string;
    aggregatePublicId: string;
    eventType: string;
    payload?: Record<string, unknown>;
    businessDate?: string;
    occurredAtUtc?: string;
  },
): void {
  sqlite.prepare(`
    INSERT INTO canonical_outbox_events (
      tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
      event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
    ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
  `).run(
    input.tenantId ?? 'tenant-a',
    input.eventPublicId,
    input.aggregateType,
    input.aggregatePublicId,
    input.eventType,
    JSON.stringify(input.payload ?? {}),
    input.occurredAtUtc ?? NOW,
    input.businessDate ?? DATE,
    `idem-${input.eventPublicId}`,
  );
}

function seedInvoice(
  sqlite: DatabaseSync,
  input: {
    tenantId?: string;
    invoicePublicId: string;
    totalMinor: number;
    paidMinor?: number;
    dueMinor?: number;
    creditedMinor?: number;
  },
): void {
  const paidMinor = input.paidMinor ?? 0;
  const dueMinor = input.dueMinor ?? input.totalMinor - paidMinor;
  const creditedMinor = input.creditedMinor ?? 0;
  const netDueMinor = dueMinor - creditedMinor;
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?, ?,0,?,?,?, ?,?,1,'posted',?,?,?)
  `).run(
    input.tenantId ?? 'tenant-a',
    input.invoicePublicId,
    `INV-${input.invoicePublicId}`,
    101,
    'BDT',
    input.totalMinor,
    input.totalMinor,
    paidMinor,
    dueMinor,
    creditedMinor,
    netDueMinor,
    NOW,
    NOW,
    HASH,
  );
}

function seedReceipt(
  sqlite: DatabaseSync,
  input: {
    receiptPublicId: string;
    totalMinor: number;
    allocatedMinor: number;
    unallocatedMinor: number;
    cashMinor: number;
    bankMinor: number;
    invoicePublicId?: string;
  },
): void {
  sqlite.prepare(`
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,legacy_collector_id,legacy_counter_id,legacy_counter_session_id,
      posted_at_utc,reconciliation_guard,refunded_minor,net_received_minor,
      refund_projection_guard,source_evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?, ?,?,?,'posted',?, ?,7,3,9,?,1,0,?,1,?)
  `).run(
    input.receiptPublicId,
    `RCPT-${input.receiptPublicId}`,
    101,
    'BDT',
    input.totalMinor,
    input.allocatedMinor,
    input.unallocatedMinor,
    NOW,
    DATE,
    NOW,
    input.totalMinor,
    HASH,
  );
  if (input.cashMinor > 0) {
    sqlite.prepare(`
      INSERT INTO canonical_payment_tenders (
        tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
        amount_minor,status,captured_at_utc,source_evidence_sha256,
        reversed_minor,remaining_minor,reversal_projection_guard
      ) VALUES ('tenant-a',?,?, 'cash','cash',?,'captured',?,?,0,?,1)
    `).run(`tender-cash-${input.receiptPublicId}`, input.receiptPublicId, input.cashMinor, NOW, HASH, input.cashMinor);
  }
  if (input.bankMinor > 0) {
    sqlite.prepare(`
      INSERT INTO canonical_payment_tenders (
        tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
        amount_minor,status,external_transaction_id,captured_at_utc,source_evidence_sha256,
        reversed_minor,remaining_minor,reversal_projection_guard
      ) VALUES ('tenant-a',?,?, 'card','card',?,'captured',?,?,?,0,?,1)
    `).run(
      `tender-bank-${input.receiptPublicId}`,
      input.receiptPublicId,
      input.bankMinor,
      `tx-${input.receiptPublicId}`,
      NOW,
      HASH,
      input.bankMinor,
    );
  }
  if (input.allocatedMinor > 0 && input.invoicePublicId) {
    sqlite.prepare(`
      INSERT INTO canonical_payment_allocations (
        tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
        amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,
        allocated_at_utc,balance_guard,source_evidence_sha256,
        reversed_minor,remaining_minor,reversal_projection_guard
      ) VALUES ('tenant-a',?,?,?,?,?,?, 'active',?,1,?,0,?,1)
    `).run(
      `alloc-${input.receiptPublicId}`,
      input.receiptPublicId,
      input.invoicePublicId,
      input.allocatedMinor,
      input.allocatedMinor + 8000,
      8000,
      NOW,
      HASH,
      input.allocatedMinor,
    );
  }
}

function seedDepositFacts(sqlite: DatabaseSync): void {
  seedInvoice(sqlite, { invoicePublicId: 'inv-deposit', totalMinor: 5000, paidMinor: 1000, dueMinor: 4000 });
  seedReceipt(sqlite, {
    receiptPublicId: 'rcpt-deposit',
    totalMinor: 3000,
    allocatedMinor: 0,
    unallocatedMinor: 3000,
    cashMinor: 3000,
    bankMinor: 0,
  });
  sqlite.exec(`
    INSERT INTO canonical_deposits (
      tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,
      currency_code,amount_minor,applied_minor,refunded_minor,available_minor,status,
      received_at_utc,business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256
    ) VALUES ('tenant-a','deposit-1','DEP-1','rcpt-deposit',101,'BDT',3000,1000,500,1500,
      'posted','${NOW}','${DATE}','${NOW}',1,'${HASH}');
    INSERT INTO canonical_deposit_applications (
      tenant_id,application_public_id,deposit_public_id,invoice_public_id,amount_minor,
      deposit_available_before_minor,deposit_available_after_minor,
      invoice_paid_before_minor,invoice_paid_after_minor,invoice_due_before_minor,
      invoice_due_after_minor,invoice_net_due_before_minor,invoice_net_due_after_minor,
      status,applied_at_utc,balance_guard,source_evidence_sha256
    ) VALUES ('tenant-a','dep-app-1','deposit-1','inv-deposit',1000,2500,1500,
      0,1000,5000,4000,5000,4000,'active','${NOW}',1,'${HASH}');
    INSERT INTO canonical_refunds (
      tenant_id,refund_public_id,source_type,deposit_public_id,amount_minor,tender_type,
      method_code,status,refunded_at_utc,business_date,source_available_before_minor,
      source_available_after_minor,liability_guard,source_evidence_sha256
    ) VALUES ('tenant-a','dep-refund-1','deposit','deposit-1',500,'cash','cash','posted',
      '${NOW}','${DATE}',2000,1500,1,'${HASH}');
  `);
}

function seedCreditNote(sqlite: DatabaseSync): void {
  seedInvoice(sqlite, { invoicePublicId: 'inv-credit', totalMinor: 5000, dueMinor: 5000, creditedMinor: 1000 });
  sqlite.exec(`
    INSERT INTO canonical_credit_notes (
      tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,
      legacy_patient_id,currency_code,reason_code,total_minor,
      invoice_credited_before_minor,invoice_credited_after_minor,
      invoice_net_due_before_minor,invoice_net_due_after_minor,status,
      issued_at_utc,business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256
    ) VALUES ('tenant-a','credit-1','CN-1','inv-credit',101,'BDT','billing_correction',1000,
      0,1000,5000,4000,'posted','${NOW}','${DATE}','${NOW}',1,'${HASH}');
  `);
}

function seedCreditNoteCashRefund(sqlite: DatabaseSync): void {
  seedCreditNote(sqlite);
  sqlite.exec(`
    INSERT INTO canonical_credit_note_cash_refunds (
      tenant_id,refund_public_id,credit_note_public_id,invoice_public_id,
      amount_minor,payout_tender_type,payout_method_code,legacy_counter_id,
      legacy_counter_session_id,status,refunded_at_utc,business_date,
      reconciliation_guard,source_evidence_sha256
    ) VALUES ('tenant-a','credit-refund-1','credit-1','inv-credit',400,'cash','cash',12,34,
      'posted','${NOW}','${DATE}',1,'${HASH}');
  `);
}

function seedPaymentReversal(sqlite: DatabaseSync): void {
  seedInvoice(sqlite, { invoicePublicId: 'inv-reversal', totalMinor: 1000, paidMinor: 500, dueMinor: 500 });
  seedReceipt(sqlite, {
    receiptPublicId: 'rcpt-reversal',totalMinor: 500,allocatedMinor: 500,
    unallocatedMinor: 0,cashMinor: 500,bankMinor: 0,invoicePublicId: 'inv-reversal',
  });
  sqlite.exec(`
    INSERT INTO canonical_payment_reversals (
      tenant_id,reversal_public_id,receipt_public_id,tender_public_id,
      allocation_public_id,invoice_public_id,amount_minor,reason_code,status,
      reversed_at_utc,business_date,allocation_reversed_before_minor,
      allocation_reversed_after_minor,tender_reversed_before_minor,
      tender_reversed_after_minor,receipt_refunded_before_minor,
      receipt_refunded_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
      invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
      invoice_net_due_after_minor,compensation_guard,balance_guard,source_evidence_sha256
    ) VALUES ('tenant-a','pay-rev-1','rcpt-reversal','tender-cash-rcpt-reversal',
      'alloc-rcpt-reversal','inv-reversal',500,'approved_reversal','posted','${NOW}','${DATE}',
      0,500,0,500,0,500,500,0,500,1000,500,1000,1,1,'${HASH}');
  `);
}

function seedCompensationSettlement(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('tenant-a','pract-1','internal','Practitioner 1','active');
    INSERT INTO canonical_compensation_settlements (
      tenant_id,settlement_public_id,settlement_number,practitioner_public_id,
      currency_code,payment_method,total_minor,allocated_minor,reversed_minor,
      net_paid_minor,status,settled_at_utc,business_date,settlement_projection_guard,
      source_evidence_sha256
    ) VALUES ('tenant-a','settlement-1','SET-1','pract-1','BDT','cash',2000,2000,0,
      2000,'posted','${NOW}','${DATE}',1,'${HASH}');
  `);
}

function voucherLines(sqlite: DatabaseSync, voucherPublicId: string) {
  return sqlite.prepare(`
    SELECT e.line_no,e.debit_minor,e.credit_minor,a.account_code,memo_code
    FROM canonical_accounting_entries e
    JOIN canonical_accounting_accounts a
      ON a.tenant_id=e.tenant_id AND a.account_public_id=e.account_public_id
    WHERE e.tenant_id='tenant-a' AND e.voucher_public_id=?
    ORDER BY e.line_no
  `).all(voucherPublicId) as Array<Record<string, unknown>>;
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

function job(sqlite: DatabaseSync, eventPublicId: string) {
  return sqlite.prepare(`
    SELECT status,attempts,last_error_code,voucher_public_id,custody_movement_public_id,
           source_fingerprint
    FROM canonical_accounting_posting_jobs
    WHERE tenant_id='tenant-a' AND outbox_event_public_id=?
  `).get(eventPublicId) as Record<string, unknown> | undefined;
}

describe('canonical accounting and cash custody reconciliation', () => {
  it('creates typed accounting and custody authority with strict integer and balance guards', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      applyMigrations(sqlite);
      const tables = sqlite.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name IN (
          'canonical_accounting_accounts','canonical_accounting_mappings',
          'canonical_accounting_periods','canonical_accounting_posting_jobs',
          'canonical_accounting_vouchers','canonical_accounting_entries',
          'canonical_cash_custody_movements','canonical_cash_custody_balances'
        ) ORDER BY name
      `).all() as Array<{ name: string }>;
      expect(tables).toHaveLength(8);
      expect(() => sqlite.exec(`
        INSERT INTO canonical_accounting_vouchers (
          tenant_id,voucher_public_id,voucher_number,voucher_type,outbox_event_public_id,
          source_event_type,currency_code,business_date,occurred_at_utc,status,
          debit_total_minor,credit_total_minor,entry_count,posting_guard,source_evidence_sha256
        ) VALUES ('t','v','V','journal','e','x','BDT','2026-07-14','${NOW}','posted',100,99,2,1,'${HASH}');
      `)).toThrow();
    } finally { sqlite.close(); }
  });

  it('posts an issued invoice as receivable and patient revenue and replays exactly', async () => {
    const { sqlite, db } = harness();
    try {
      seedInvoice(sqlite, { invoicePublicId: 'inv-1', totalMinor: 10000 });
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-invoice-1',aggregateType: 'canonical_invoice',
        aggregatePublicId: 'inv-1',eventType: 'canonical.invoice.issued',
        payload: { invoicePublicId: 'inv-1', totalMinor: 10000 },
      });
      const first = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-invoice-1',nowUtc: NOW,
      });
      const replay = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-invoice-1',nowUtc: NOW,
      });
      expect(first).toMatchObject({ status: 'posted', debitTotalMinor: 10000, creditTotalMinor: 10000 });
      expect(replay.status).toBe('replayed');
      expect(count(sqlite, 'canonical_accounting_vouchers')).toBe(1);
      expect(voucherLines(sqlite, String(first.voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '1100', debit_minor: 10000, credit_minor: 0 }),
        expect.objectContaining({ account_code: '4000', debit_minor: 0, credit_minor: 10000 }),
      ]);
    } finally { sqlite.close(); }
  });

  it('posts an unpaid invoice cancellation as the exact inverse of issuance', async () => {
    const { sqlite, db } = harness();
    try {
      seedInvoice(sqlite, { invoicePublicId: 'inv-cancel', totalMinor: 10000 });
      sqlite.prepare(`
        UPDATE canonical_invoices
        SET status='cancelled',cancelled_at_utc=?
        WHERE tenant_id='tenant-a' AND invoice_public_id='inv-cancel'
      `).run(NOW);
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-invoice-cancel',aggregateType: 'canonical_invoice',
        aggregatePublicId: 'inv-cancel',eventType: 'canonical.invoice.cancelled',
        payload: { invoicePublicId: 'inv-cancel', totalMinor: 10000 },
      });

      const result = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-invoice-cancel',nowUtc: NOW,
      });

      expect(result).toMatchObject({ status: 'posted', debitTotalMinor: 10000, creditTotalMinor: 10000 });
      expect(voucherLines(sqlite, String(result.voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '4000', debit_minor: 10000, credit_minor: 0 }),
        expect.objectContaining({ account_code: '1100', debit_minor: 0, credit_minor: 10000 }),
      ]);
    } finally { sqlite.close(); }
  });

  it('posts mixed payment tenders, allocated receivable, and unallocated deposit liability', async () => {
    const { sqlite, db } = harness();
    try {
      seedInvoice(sqlite, { invoicePublicId: 'inv-pay', totalMinor: 20000, paidMinor: 12000, dueMinor: 8000 });
      seedReceipt(sqlite, {
        receiptPublicId: 'rcpt-pay',totalMinor: 15000,allocatedMinor: 12000,
        unallocatedMinor: 3000,cashMinor: 5000,bankMinor: 10000,invoicePublicId: 'inv-pay',
      });
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-payment-1',aggregateType: 'canonical_payment_receipt',
        aggregatePublicId: 'rcpt-pay',eventType: 'canonical.payment.receipt.posted',
        payload: { receiptPublicId: 'rcpt-pay', totalMinor: 15000 },
      });
      const result = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-payment-1',nowUtc: NOW,
      });
      expect(result).toMatchObject({ status: 'posted', debitTotalMinor: 15000, creditTotalMinor: 15000 });
      expect(voucherLines(sqlite, String(result.voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '1000', debit_minor: 5000, credit_minor: 0 }),
        expect.objectContaining({ account_code: '1010', debit_minor: 10000, credit_minor: 0 }),
        expect.objectContaining({ account_code: '1100', debit_minor: 0, credit_minor: 12000 }),
        expect.objectContaining({ account_code: '2100', debit_minor: 0, credit_minor: 3000 }),
      ]);
    } finally { sqlite.close(); }
  });

  it('treats deposit record as derived, then posts application and refund without duplicate liability', async () => {
    const { sqlite, db } = harness();
    try {
      seedDepositFacts(sqlite);
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-deposit-payment',aggregateType: 'canonical_payment_receipt',
        aggregatePublicId: 'rcpt-deposit',eventType: 'canonical.payment.receipt.posted',
        payload: { receiptPublicId: 'rcpt-deposit', totalMinor: 3000 },
      });
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-deposit-record',aggregateType: 'canonical_deposit',
        aggregatePublicId: 'deposit-1',eventType: 'canonical.deposit.recorded',
        payload: { depositPublicId: 'deposit-1', receiptPublicId: 'rcpt-deposit', amountMinor: 3000 },
      });
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-deposit-apply',aggregateType: 'canonical_deposit',
        aggregatePublicId: 'deposit-1',eventType: 'canonical.deposit.applied',
        payload: { applicationPublicId: 'dep-app-1', amountMinor: 1000 },
      });
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-deposit-refund',aggregateType: 'canonical_refund',
        aggregatePublicId: 'dep-refund-1',eventType: 'canonical.deposit.refunded',
        payload: { refundPublicId: 'dep-refund-1', amountMinor: 500 },
      });
      const payment = await postCanonicalAccountingEvent(db, { tenantId: 'tenant-a',outboxEventPublicId: 'outbox-deposit-payment',nowUtc: NOW });
      const record = await postCanonicalAccountingEvent(db, { tenantId: 'tenant-a',outboxEventPublicId: 'outbox-deposit-record',nowUtc: NOW });
      const application = await postCanonicalAccountingEvent(db, { tenantId: 'tenant-a',outboxEventPublicId: 'outbox-deposit-apply',nowUtc: NOW });
      const refund = await postCanonicalAccountingEvent(db, { tenantId: 'tenant-a',outboxEventPublicId: 'outbox-deposit-refund',nowUtc: NOW });
      expect(payment.status).toBe('posted');
      expect(record).toMatchObject({ status: 'skipped', skipCode: 'DERIVED_DEPOSIT_RECEIPT' });
      expect(voucherLines(sqlite, String(application.voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '2100', debit_minor: 1000 }),
        expect.objectContaining({ account_code: '1100', credit_minor: 1000 }),
      ]);
      expect(voucherLines(sqlite, String(refund.voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '2100', debit_minor: 500 }),
        expect.objectContaining({ account_code: '1000', credit_minor: 500 }),
      ]);
      expect(count(sqlite, 'canonical_accounting_vouchers')).toBe(3);
    } finally { sqlite.close(); }
  });

  it('posts invoice, deposit applications, and direct payment to the final receivable due', async () => {
    const { sqlite, db } = harness();
    try {
      seedReceipt(sqlite, {
        receiptPublicId: 'rcpt-existing-deposit',
        totalMinor: 3000,
        allocatedMinor: 0,
        unallocatedMinor: 3000,
        cashMinor: 3000,
        bankMinor: 0,
      });
      sqlite.prepare(`
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,
          currency_code,amount_minor,applied_minor,refunded_minor,available_minor,status,
          received_at_utc,business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256
        ) VALUES ('tenant-a','deposit-settlement','DEP-SET','rcpt-existing-deposit',101,
          'BDT',3000,0,0,3000,'posted',?,?,?,1,?)
      `).run(NOW, DATE, NOW, HASH);

      await issueInvoiceWithSettlement(db as CanonicalBatchDatabase, {
        tenantId: 'tenant-a',
        commandIdempotencyKey: 'invoice-settlement-accounting',
        invoice: {
          tenantId: 'tenant-a',
          invoicePublicId: 'inv-settlement-accounting',
          invoiceNumber: 'INV-SET-ACCOUNTING',
          legacyPatientId: 101,
          currencyCode: 'BDT',
          issuedAtUtc: NOW,
          businessDate: DATE,
          lines: [{
            linePublicId: 'line-settlement-accounting',
            lineType: 'other_adjustment',
            serviceEventPublicId: null,
            adjustmentCode: 'PROVISIONAL_SERVICE',
            quantity: 1,
            unitAmountMinor: 10000,
            sourceEvidenceSha256: HASH,
          }],
          sourceType: 'legacy_live_bill',
          sourcePublicId: 'INV-SET-ACCOUNTING',
          sourceTable: 'bills',
          sourceEvidenceSha256: HASH,
          idempotencyKey: 'legacy_live_bill:INV-SET-ACCOUNTING',
          outboxEventPublicId: 'outbox-invoice-settlement-accounting',
        },
        deposit: {
          adjustmentNumber: 'DAD-SET-ACCOUNTING',
          amountMinor: 3000,
          appliedAtUtc: NOW,
          businessDate: DATE,
          sourceType: 'legacy_live_deposit',
          sourceTable: 'billing_deposits',
        },
        payment: {
          receiptPublicId: 'rcpt-settlement-accounting',
          receiptNumber: 'RCP-SET-ACCOUNTING',
          tenderPublicId: 'tender-settlement-accounting',
          allocationPublicId: 'allocation-settlement-accounting',
          tenderType: 'cash',
          methodCode: 'cash',
          amountMinor: 2000,
          legacyCollectorId: 7,
          legacyCounterId: 3,
          legacyCounterSessionId: 9,
          receivedAtUtc: NOW,
          sourceType: 'legacy_live_payment',
          sourcePublicId: 'RCP-SET-ACCOUNTING',
          sourceTable: 'payments',
          sourceEvidenceSha256: HASH,
          paymentOutboxEventPublicId: 'outbox-payment-settlement-accounting',
          cashCustodyEventPublicId: 'outbox-custody-settlement-accounting',
        },
      });

      const posted = await postPendingCanonicalAccountingEvents(db, {
        tenantId: 'tenant-a', limit: 10, nowUtc: NOW, maxAttempts: 3,
      });
      expect(posted).toMatchObject({ scanned: 4, posted: 4, retry: 0, deadLetter: 0 });

      const ar = sqlite.prepare(`
        SELECT COALESCE(SUM(e.debit_minor),0) AS debit_minor,
               COALESCE(SUM(e.credit_minor),0) AS credit_minor
        FROM canonical_accounting_entries e
        JOIN canonical_accounting_accounts a
          ON a.tenant_id=e.tenant_id AND a.account_public_id=e.account_public_id
        WHERE e.tenant_id='tenant-a' AND a.account_code='1100'
      `).get() as { debit_minor: number; credit_minor: number };
      expect(Number(ar.debit_minor) - Number(ar.credit_minor)).toBe(5000);
      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,net_due_minor FROM canonical_invoices
        WHERE tenant_id='tenant-a' AND invoice_public_id='inv-settlement-accounting'
      `).get()).toEqual({ paid_minor: 5000, due_minor: 5000, net_due_minor: 5000 });
    } finally { sqlite.close(); }
  });

  it('posts a lab-order invoice as full receivable with gross revenue and discount', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        CREATE TABLE billing_service_departments (
          id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,department_code TEXT,department_name TEXT,is_active INTEGER
        );
        CREATE TABLE billing_service_items (
          id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,service_department_id INTEGER NOT NULL,
          item_code TEXT NOT NULL,item_name TEXT NOT NULL,price REAL NOT NULL,is_active INTEGER NOT NULL
        );
        CREATE TABLE lab_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,order_no TEXT NOT NULL,tenant_id TEXT NOT NULL);
        CREATE TABLE lab_order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,lab_order_id INTEGER NOT NULL,lab_test_id INTEGER NOT NULL,
          tenant_id TEXT NOT NULL,status TEXT NOT NULL
        );
        INSERT INTO billing_service_departments VALUES (10,'tenant-a','LAB','Laboratory',1);
        INSERT INTO billing_service_items VALUES (20,'tenant-a',10,'CBC','Complete Blood Count',100,1);
      `);
      const canonicalDb = db as CanonicalBatchDatabase;
      await createLabOrderBilling(canonicalDb, {
        tenantId: 'tenant-a',
        commandIdempotencyKey: 'lab-accounting-create',
        orderNo: 'LO-ACCOUNTING',
        invoiceNo: 'INV-LAB-ACCOUNTING',
        legacyPatientId: 101,
        legacyVisitId: null,
        orderingClinicianDoctorId: null,
        orderedAtUtc: NOW,
        businessDate: DATE,
        items: [{
          lineNumber: 1,
          duplicateOrdinal: 0,
          labTestId: 301,
          billingServiceItemId: 20,
          name: 'Complete Blood Count',
          category: 'Hematology',
          grossMinor: 10000,
          discountMinor: 1000,
        }],
      }, {
        authoritativeStatements: [
          canonicalDb.prepare("INSERT INTO lab_orders (order_no,tenant_id) VALUES ('LO-ACCOUNTING','tenant-a')"),
          canonicalDb.prepare(`
            INSERT INTO lab_order_items (lab_order_id,lab_test_id,tenant_id,status)
            SELECT id,301,'tenant-a','pending' FROM lab_orders
            WHERE tenant_id='tenant-a' AND order_no='LO-ACCOUNTING'
          `),
        ],
      });

      const posted = await postPendingCanonicalAccountingEvents(db, {
        tenantId: 'tenant-a', limit: 10, nowUtc: NOW, maxAttempts: 3,
      });
      expect(posted).toMatchObject({ scanned: 1, posted: 1, retry: 0, deadLetter: 0 });
      const ar = sqlite.prepare(`
        SELECT COALESCE(SUM(e.debit_minor),0) AS debit_minor,
               COALESCE(SUM(e.credit_minor),0) AS credit_minor
        FROM canonical_accounting_entries e
        JOIN canonical_accounting_accounts a
          ON a.tenant_id=e.tenant_id AND a.account_public_id=e.account_public_id
        WHERE e.tenant_id='tenant-a' AND a.account_code='1100'
      `).get() as { debit_minor: number; credit_minor: number };
      expect(Number(ar.debit_minor) - Number(ar.credit_minor)).toBe(9000);
      expect(sqlite.prepare(`
        SELECT subtotal_minor,adjustment_total_minor,total_minor,due_minor
        FROM canonical_invoices WHERE invoice_number='INV-LAB-ACCOUNTING'
      `).get()).toEqual({
        subtotal_minor: 10000, adjustment_total_minor: -1000, total_minor: 9000, due_minor: 9000,
      });
    } finally { sqlite.close(); }
  });

  it('posts IPD discharge settlement and excess deposit refund to zero receivable', async () => {
    const { sqlite, db } = harness();
    try {
      seedReceipt(sqlite, {
        receiptPublicId: 'rcpt-ipd-deposit',
        totalMinor: 9000,
        allocatedMinor: 0,
        unallocatedMinor: 9000,
        cashMinor: 9000,
        bankMinor: 0,
      });
      sqlite.exec(`
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,
          currency_code,amount_minor,applied_minor,refunded_minor,available_minor,status,
          received_at_utc,business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256
        ) VALUES ('tenant-a','deposit-ipd','DEP-IPD','rcpt-ipd-deposit',101,
          'BDT',9000,0,0,9000,'posted','${NOW}','${DATE}','${NOW}',1,'${HASH}');
        INSERT INTO canonical_encounters (
          tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
          started_at_utc,source_evidence_sha256
        ) VALUES ('tenant-a','enc-ipd-accounting',101,'inpatient','in_progress',
          '2026-07-10T00:00:00.000Z','${HASH}');
        INSERT INTO canonical_encounter_admission_links (
          tenant_id,encounter_public_id,legacy_admission_id,admission_no,link_status,source_evidence_sha256
        ) VALUES ('tenant-a','enc-ipd-accounting',701,'ADM-701','active','${HASH}');
        INSERT INTO canonical_bed_stays (
          tenant_id,bed_stay_public_id,encounter_public_id,legacy_patient_bed_info_id,
          legacy_admission_id,legacy_bed_id,started_at_utc,status,source_evidence_sha256
        ) VALUES ('tenant-a','bed-ipd-accounting','enc-ipd-accounting',801,701,91,
          '2026-07-10T00:00:00.000Z','active','${HASH}');
      `);

      await finalizeIpdDischargeBilling(db as CanonicalBatchDatabase, {
        tenantId: 'tenant-a',
        commandIdempotencyKey: 'ipd-accounting-finalize',
        invoiceSettlement: {
          tenantId: 'tenant-a',
          commandIdempotencyKey: 'ipd-accounting-nested',
          invoice: {
            tenantId: 'tenant-a',
            invoicePublicId: 'inv-ipd-accounting',
            invoiceNumber: 'INV-IPD-ACCOUNTING',
            legacyPatientId: 101,
            currencyCode: 'BDT',
            issuedAtUtc: NOW,
            businessDate: DATE,
            lines: [{
              linePublicId: 'line-ipd-accounting',
              lineType: 'other_adjustment',
              serviceEventPublicId: null,
              adjustmentCode: 'IPD_DISCHARGE',
              quantity: 1,
              unitAmountMinor: 10000,
              sourceEvidenceSha256: HASH,
            }],
            sourceType: 'legacy_live_bill',
            sourcePublicId: 'INV-IPD-ACCOUNTING',
            sourceTable: 'bills',
            sourceEvidenceSha256: HASH,
            idempotencyKey: 'legacy_live_bill:INV-IPD-ACCOUNTING',
            outboxEventPublicId: 'outbox-ipd-invoice',
          },
          deposit: {
            adjustmentNumber: 'DAD-IPD-ACCOUNTING',
            amountMinor: 7000,
            appliedAtUtc: NOW,
            businessDate: DATE,
            sourceType: 'legacy_live_deposit',
            sourceTable: 'billing_deposits',
          },
          payment: {
            receiptPublicId: 'rcpt-ipd-payment',
            receiptNumber: 'RCP-IPD-PAYMENT',
            tenderPublicId: 'tender-ipd-payment',
            allocationPublicId: 'allocation-ipd-payment',
            tenderType: 'cash',
            methodCode: 'cash',
            amountMinor: 3000,
            legacyCollectorId: 7,
            legacyCounterId: 3,
            legacyCounterSessionId: 9,
            receivedAtUtc: NOW,
            sourceType: 'legacy_live_payment',
            sourcePublicId: 'RCP-IPD-PAYMENT',
            sourceTable: 'payments',
            sourceEvidenceSha256: HASH,
            paymentOutboxEventPublicId: 'outbox-ipd-payment',
            cashCustodyEventPublicId: 'outbox-ipd-payment-custody',
          },
        },
        encounter: {
          legacyAdmissionId: 701,
          legacyPatientId: 101,
          completedAtUtc: NOW,
          sourceType: 'legacy_admission_discharge',
          sourcePublicId: '701',
          sourceTable: 'admissions',
          sourceEvidenceSha256: HASH,
          eventPublicId: 'outbox-ipd-encounter',
        },
        depositRefund: {
          operationPublicId: 'ipd-deposit-refund-operation',
          amountMinor: 2000,
          refundReceiptNumber: 'DRF-IPD-ACCOUNTING',
          tenderType: 'cash',
          methodCode: 'cash',
          sourceType: 'legacy_live_deposit_refund',
          sourcePublicId: 'DRF-IPD-ACCOUNTING',
          sourceTable: 'billing_deposits',
          sourceEvidenceSha256: HASH,
          outboxEventPublicId: 'outbox-ipd-deposit-refund',
        },
      });

      const posted = await postPendingCanonicalAccountingEvents(db, {
        tenantId: 'tenant-a', limit: 20, nowUtc: NOW, maxAttempts: 3,
      });
      expect(posted).toMatchObject({ posted: 6, retry: 0, deadLetter: 0 });

      const balances = sqlite.prepare(`
        SELECT a.account_code,
               COALESCE(SUM(e.debit_minor),0) AS debit_minor,
               COALESCE(SUM(e.credit_minor),0) AS credit_minor
        FROM canonical_accounting_entries e
        JOIN canonical_accounting_accounts a
          ON a.tenant_id=e.tenant_id AND a.account_public_id=e.account_public_id
        WHERE e.tenant_id='tenant-a' AND a.account_code IN ('1100','2100','1000')
        GROUP BY a.account_code
        ORDER BY a.account_code
      `).all() as Array<{ account_code: string; debit_minor: number; credit_minor: number }>;
      const byCode = new Map(balances.map((row) => [row.account_code, row]));
      expect(Number(byCode.get('1100')?.debit_minor ?? 0) - Number(byCode.get('1100')?.credit_minor ?? 0)).toBe(0);
      expect(Number(byCode.get('2100')?.debit_minor ?? 0) - Number(byCode.get('2100')?.credit_minor ?? 0)).toBe(9000);
      expect(Number(byCode.get('1000')?.debit_minor ?? 0) - Number(byCode.get('1000')?.credit_minor ?? 0)).toBe(1000);
    } finally { sqlite.close(); }
  });

  it('posts credit note and cash payout as balanced vouchers with net receivable reduction', async () => {
    const { sqlite, db } = harness();
    try {
      seedCreditNoteCashRefund(sqlite);
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-credit-refund-credit',
        aggregateType: 'canonical_credit_note',
        aggregatePublicId: 'credit-1',
        eventType: 'canonical.credit_note.posted',
        payload: { creditNotePublicId: 'credit-1', totalMinor: 1000 },
      });
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-credit-refund-cash',
        aggregateType: 'canonical_credit_note_cash_refund',
        aggregatePublicId: 'credit-refund-1',
        eventType: 'canonical.credit_note.cash_refunded',
        payload: { refundPublicId: 'credit-refund-1', amountMinor: 400 },
      });

      const credit = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a', outboxEventPublicId: 'outbox-credit-refund-credit', nowUtc: NOW,
      });
      const cash = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a', outboxEventPublicId: 'outbox-credit-refund-cash', nowUtc: NOW,
      });

      expect(credit).toMatchObject({ status: 'posted', debitTotalMinor: 1000, creditTotalMinor: 1000 });
      expect(cash).toMatchObject({ status: 'posted', debitTotalMinor: 400, creditTotalMinor: 400 });
      expect(voucherLines(sqlite, String(credit.voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '4050', debit_minor: 1000, credit_minor: 0 }),
        expect.objectContaining({ account_code: '1100', debit_minor: 0, credit_minor: 1000 }),
      ]);
      expect(voucherLines(sqlite, String(cash.voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '1100', debit_minor: 400, credit_minor: 0 }),
        expect.objectContaining({ account_code: '1000', debit_minor: 0, credit_minor: 400 }),
      ]);
      const ar = sqlite.prepare(`
        SELECT SUM(debit_minor) AS debit_minor,SUM(credit_minor) AS credit_minor
        FROM canonical_accounting_entries e
        JOIN canonical_accounting_accounts a
          ON a.tenant_id=e.tenant_id AND a.account_public_id=e.account_public_id
        WHERE e.tenant_id='tenant-a' AND a.account_code='1100'
      `).get() as { debit_minor: number; credit_minor: number };
      expect(Number(ar.credit_minor) - Number(ar.debit_minor)).toBe(600);
    } finally { sqlite.close(); }
  });

  it('posts credit note, direct expense, payroll payment, practitioner settlement, and inventory receipt', async () => {
    const { sqlite, db } = harness();
    try {
      seedCreditNote(sqlite);
      seedCompensationSettlement(sqlite);
      const events = [
        {
          id: 'outbox-credit',type: 'canonical.credit_note.posted',aggregateType: 'canonical_credit_note',aggregateId: 'credit-1',
          payload: { creditNotePublicId: 'credit-1', totalMinor: 1000 },
        },
        {
          id: 'outbox-expense',type: 'canonical.accounting.expense.paid',aggregateType: 'canonical_expense',aggregateId: 'expense-1',
          payload: { amountMinor: 2500,currencyCode: 'BDT',paymentMethod: 'cash',expenseMappingKey: 'expense_default',sourceEvidenceSha256: HASH },
        },
        {
          id: 'outbox-payroll',type: 'canonical.accounting.payroll.paid',aggregateType: 'canonical_payroll',aggregateId: 'payroll-1',
          payload: { amountMinor: 4000,currencyCode: 'BDT',paymentMethod: 'bank_transfer',sourceEvidenceSha256: HASH },
        },
        {
          id: 'outbox-practitioner',type: 'canonical.compensation.settled',aggregateType: 'compensation_settlement',aggregateId: 'settlement-1',
          payload: { settlementPublicId: 'settlement-1',totalMinor: 2000,currencyCode: 'BDT',paymentMethod: 'cash' },
        },
        {
          id: 'outbox-inventory',type: 'canonical.accounting.inventory_receipt.posted',aggregateType: 'canonical_inventory_receipt',aggregateId: 'inventory-receipt-1',
          payload: { amountMinor: 7000,currencyCode: 'BDT',settlementMode: 'credit',sourceEvidenceSha256: HASH },
        },
      ];
      for (const event of events) seedOutbox(sqlite, {
        eventPublicId: event.id,aggregateType: event.aggregateType,aggregatePublicId: event.aggregateId,
        eventType: event.type,payload: event.payload,
      });
      const results = [];
      for (const event of events) results.push(await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: event.id,nowUtc: NOW,
      }));
      expect(results.every((result) => result.status === 'posted')).toBe(true);
      expect(voucherLines(sqlite, String(results[0].voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '4050', debit_minor: 1000 }),
        expect.objectContaining({ account_code: '1100', credit_minor: 1000 }),
      ]);
      expect(voucherLines(sqlite, String(results[1].voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '5000', debit_minor: 2500 }),
        expect.objectContaining({ account_code: '1000', credit_minor: 2500 }),
      ]);
      expect(voucherLines(sqlite, String(results[2].voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '2200', debit_minor: 4000 }),
        expect.objectContaining({ account_code: '1010', credit_minor: 4000 }),
      ]);
      expect(voucherLines(sqlite, String(results[3].voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '2300', debit_minor: 2000 }),
        expect.objectContaining({ account_code: '1000', credit_minor: 2000 }),
      ]);
      expect(voucherLines(sqlite, String(results[4].voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '1200', debit_minor: 7000 }),
        expect.objectContaining({ account_code: '2000', credit_minor: 7000 }),
      ]);
    } finally { sqlite.close(); }
  });

  it('records failed posting as retry with zero partial voucher and succeeds after mapping repair', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`DELETE FROM canonical_accounting_mappings WHERE tenant_id='tenant-a' AND mapping_key='expense_default'`);
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-retry',aggregateType: 'canonical_expense',aggregatePublicId: 'expense-retry',
        eventType: 'canonical.accounting.expense.paid',
        payload: { amountMinor: 900,currencyCode: 'BDT',paymentMethod: 'cash',expenseMappingKey: 'expense_default',sourceEvidenceSha256: HASH },
      });
      const failed = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-retry',nowUtc: NOW,maxAttempts: 3,
      });
      expect(failed.status).toBe('retry');
      expect(job(sqlite, 'outbox-retry')).toMatchObject({ status: 'retry', attempts: 1, last_error_code: 'ACCOUNT_MAPPING_MISSING' });
      expect(count(sqlite, 'canonical_accounting_vouchers')).toBe(0);
      expect(count(sqlite, 'canonical_accounting_entries')).toBe(0);
      sqlite.prepare(`
        INSERT INTO canonical_accounting_mappings (
          tenant_id,mapping_key,account_public_id,status,source_evidence_sha256
        ) VALUES ('tenant-a','expense_default','acct-expense','active',?)
      `).run(HASH);
      const repaired = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-retry',nowUtc: '2026-07-14T07:30:00.000Z',maxAttempts: 3,
      });
      expect(repaired.status).toBe('posted');
      expect(job(sqlite, 'outbox-retry')).toMatchObject({ status: 'posted', attempts: 2 });
      expect(count(sqlite, 'canonical_accounting_vouchers')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('rejects unbalanced manual posting and leaves zero partial entries', async () => {
    const { sqlite, db } = harness();
    try {
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-unbalanced',aggregateType: 'canonical_accounting_manual',aggregatePublicId: 'manual-1',
        eventType: 'canonical.accounting.manual.posted',
        payload: {
          currencyCode: 'BDT',sourceEvidenceSha256: HASH,
          lines: [
            { mappingKey: 'cash_on_hand', debitMinor: 1000, creditMinor: 0 },
            { mappingKey: 'patient_revenue', debitMinor: 0, creditMinor: 999 },
          ],
        },
      });
      const result = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-unbalanced',nowUtc: NOW,maxAttempts: 2,
      });
      expect(result.status).toBe('dead_letter');
      expect(job(sqlite, 'outbox-unbalanced')).toMatchObject({ status: 'dead_letter', last_error_code: 'ACCOUNTING_UNBALANCED' });
      expect(count(sqlite, 'canonical_accounting_vouchers')).toBe(0);
      expect(count(sqlite, 'canonical_accounting_entries')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('blocks a closed period and posts after explicit authorized reopening', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        UPDATE canonical_accounting_periods
        SET status='closed',closed_at_utc='${NOW}',closed_by_public_id='user-1'
        WHERE tenant_id='tenant-a' AND period_name='2026-07';
      `);
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-period',aggregateType: 'canonical_expense',aggregatePublicId: 'expense-period',
        eventType: 'canonical.accounting.expense.paid',
        payload: { amountMinor: 1000,currencyCode: 'BDT',paymentMethod: 'cash',expenseMappingKey: 'expense_default',sourceEvidenceSha256: HASH },
      });
      const blocked = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-period',nowUtc: NOW,maxAttempts: 3,
      });
      expect(blocked.status).toBe('retry');
      expect(job(sqlite, 'outbox-period')).toMatchObject({ last_error_code: 'ACCOUNTING_PERIOD_CLOSED' });
      sqlite.exec(`
        UPDATE canonical_accounting_periods
        SET status='reopened',reopened_at_utc='2026-07-14T07:10:00.000Z',
            reopened_by_public_id='finance-controller',reopen_authorization_public_id='approval-1',
            reopen_reason_code='approved_correction'
        WHERE tenant_id='tenant-a' AND period_name='2026-07';
      `);
      const posted = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-period',nowUtc: '2026-07-14T07:20:00.000Z',maxAttempts: 3,
      });
      expect(posted.status).toBe('posted');
    } finally { sqlite.close(); }
  });

  it('posts cash custody separately from revenue and expense classification', async () => {
    const { sqlite, db } = harness();
    try {
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-custody-in',aggregateType: 'canonical_cash_custody',aggregatePublicId: 'rcpt-cash',
        eventType: 'canonical.cash_custody.collection_recorded',
        payload: { cashAmountMinor: 5000,counterId: 3,counterSessionId: 9,receiptPublicId: 'rcpt-cash' },
      });
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-custody-out',aggregateType: 'canonical_cash_custody',aggregatePublicId: 'refund-cash',
        eventType: 'canonical.cash_custody.refund_recorded',
        payload: { amountMinor: 1200,refundPublicId: 'refund-cash',counterId: 3,counterSessionId: 9 },
      });
      const incoming = await postCanonicalAccountingEvent(db, { tenantId: 'tenant-a',outboxEventPublicId: 'outbox-custody-in',nowUtc: NOW });
      const outgoing = await postCanonicalAccountingEvent(db, { tenantId: 'tenant-a',outboxEventPublicId: 'outbox-custody-out',nowUtc: NOW });
      expect(incoming).toMatchObject({ status: 'posted', postingKind: 'cash_custody' });
      expect(outgoing).toMatchObject({ status: 'posted', postingKind: 'cash_custody' });
      expect(count(sqlite, 'canonical_accounting_vouchers')).toBe(0);
      expect(count(sqlite, 'canonical_cash_custody_movements')).toBe(2);
      const balance = sqlite.prepare(`
        SELECT balance_minor FROM canonical_cash_custody_balances
        WHERE tenant_id='tenant-a' AND custody_public_id='counter-session:9'
      `).get() as { balance_minor: number };
      expect(balance.balance_minor).toBe(3800);
      const columns = sqlite.prepare(`PRAGMA table_info(canonical_cash_custody_movements)`).all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining(['revenue_account_id','expense_account_id']));
    } finally { sqlite.close(); }
  });

  it('posts generic cash custody movement types and skips session-close evidence', async () => {
    const { sqlite, db } = harness();
    try {
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-custody-handover',
        aggregateType: 'canonical_cash_custody',
        aggregatePublicId: 'counter-session:19',
        eventType: 'canonical.cash_custody.movement_recorded',
        payload: {
          custodyPublicId: 'counter-session:19',
          custodyMovementPublicId: 'predicted-cash-movement',
          custodyType: 'counter_session',
          counterId: 4,
          counterSessionId: 19,
          movementType: 'handover',
          direction: 'out',
          amountMinor: 2200,
          sourceEvidenceSha256: 'a'.repeat(64),
        },
      });
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-custody-close',
        aggregateType: 'canonical_cash_custody',
        aggregatePublicId: 'counter-session:19',
        eventType: 'canonical.cash_custody.session_closed',
        payload: {
          custodyPublicId: 'counter-session:19',
          balanceMinor: -2200,
          countedMinor: 0,
          varianceMinor: 2200,
        },
      });

      const movement = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',
        outboxEventPublicId: 'outbox-custody-handover',
        nowUtc: NOW,
      });
      const close = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',
        outboxEventPublicId: 'outbox-custody-close',
        nowUtc: NOW,
      });

      expect(movement).toMatchObject({ status: 'posted', postingKind: 'cash_custody' });
      expect(close).toMatchObject({ status: 'skipped', postingKind: 'skip' });
      expect(sqlite.prepare(`
        SELECT movement_type,direction,amount_minor,signed_amount_minor,balance_after_minor
        FROM canonical_cash_custody_movements
        WHERE tenant_id='tenant-a'
      `).get()).toEqual({
        movement_type: 'handover',
        direction: 'out',
        amount_minor: 2200,
        signed_amount_minor: -2200,
        balance_after_minor: -2200,
      });
      expect(count(sqlite, 'canonical_cash_custody_movements')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('unwraps a command envelope and materialises the recorded custody movement', async () => {
    const { sqlite, db } = harness();
    try {
      const command = await recordCashCustodyMovement(db as unknown as CanonicalBatchDatabase, {
        tenantId: 'tenant-a',
        custodyType: 'counter_session',
        legacyCounterId: 4,
        legacyCounterSessionId: 21,
        movementType: 'handover',
        direction: 'out',
        amountMinor: 1750,
        occurredAtUtc: '2026-07-14T06:00:00.000Z',
        businessDate: '2026-07-14',
        sourceType: 'legacy_counter_handover',
        sourcePublicId: 'counter-session:21:handover',
        sourceTable: 'cash_drawer_movements',
        sourceEvidenceSha256: 'b'.repeat(64),
        idempotencyKey: 'cash-custody-command-envelope-21',
        outboxEventPublicId: 'outbox-custody-command-envelope-21',
      });
      expect(command.status).toBe('applied');

      const posted = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',
        outboxEventPublicId: 'outbox-custody-command-envelope-21',
        nowUtc: NOW,
      });
      expect(posted).toMatchObject({ status: 'posted', postingKind: 'cash_custody' });
      expect(sqlite.prepare(`
        SELECT custody_public_id,movement_type,direction,amount_minor,balance_after_minor
        FROM canonical_cash_custody_movements
        WHERE tenant_id='tenant-a'
      `).get()).toEqual({
        custody_public_id: 'counter-session:21',
        movement_type: 'handover',
        direction: 'out',
        amount_minor: 1750,
        balance_after_minor: -1750,
      });
    } finally { sqlite.close(); }
  });

  it('posts a canonical payment reversal as restored receivable and reversed cash settlement', async () => {
    const { sqlite, db } = harness();
    try {
      seedPaymentReversal(sqlite);
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-payment-reversal',aggregateType: 'canonical_payment_reversal',
        aggregatePublicId: 'pay-rev-1',eventType: 'canonical.payment.reversed',
        payload: { reversalPublicId: 'pay-rev-1',amountMinor: 500 },
      });
      const result = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-payment-reversal',nowUtc: NOW,
      });
      expect(result.status).toBe('posted');
      expect(voucherLines(sqlite, String(result.voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '1100', debit_minor: 500, credit_minor: 0 }),
        expect.objectContaining({ account_code: '1000', debit_minor: 0, credit_minor: 500 }),
      ]);
    } finally { sqlite.close(); }
  });

  it('rolls back every voucher and entry when the posting job claim becomes stale', async () => {
    let raced = false;
    const { sqlite, db } = harness({ beforeBatch(database) {
      if (raced) return;
      raced = true;
      database.exec(`
        UPDATE canonical_accounting_posting_jobs
        SET attempts=1
        WHERE tenant_id='tenant-a' AND outbox_event_public_id='outbox-stale'
      `);
    } });
    try {
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-stale',aggregateType: 'canonical_expense',aggregatePublicId: 'expense-stale',
        eventType: 'canonical.accounting.expense.paid',
        payload: { amountMinor: 1300,currencyCode: 'BDT',paymentMethod: 'cash',expenseMappingKey: 'expense_default',sourceEvidenceSha256: HASH },
      });
      await expect(postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-stale',nowUtc: NOW,
      })).rejects.toThrow();
      expect(count(sqlite, 'canonical_accounting_vouchers')).toBe(0);
      expect(count(sqlite, 'canonical_accounting_entries')).toBe(0);
      expect(job(sqlite, 'outbox-stale')).toMatchObject({ status: 'pending', attempts: 1, voucher_public_id: null });
    } finally { sqlite.close(); }
  });

  it('creates an explicit immutable reversal voucher with opposite lines', async () => {
    const { sqlite, db } = harness();
    try {
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-expense-reversal',aggregateType: 'canonical_expense',aggregatePublicId: 'expense-reversal',
        eventType: 'canonical.accounting.expense.paid',
        payload: { amountMinor: 1500,currencyCode: 'BDT',paymentMethod: 'cash',expenseMappingKey: 'expense_default',sourceEvidenceSha256: HASH },
      });
      const posted = await postCanonicalAccountingEvent(db, { tenantId: 'tenant-a',outboxEventPublicId: 'outbox-expense-reversal',nowUtc: NOW });
      const reversal = await reverseCanonicalAccountingVoucher(db, {
        tenantId: 'tenant-a',originalVoucherPublicId: String(posted.voucherPublicId),
        reversalPublicId: 'reversal-1',reasonCode: 'approved_correction',
        occurredAtUtc: '2026-07-14T08:00:00.000Z',businessDate: DATE,
        idempotencyKey: 'reversal-idem-1',sourceEvidenceSha256: HASH,
      });
      const replay = await reverseCanonicalAccountingVoucher(db, {
        tenantId: 'tenant-a',originalVoucherPublicId: String(posted.voucherPublicId),
        reversalPublicId: 'reversal-1',reasonCode: 'approved_correction',
        occurredAtUtc: '2026-07-14T08:00:00.000Z',businessDate: DATE,
        idempotencyKey: 'reversal-idem-1',sourceEvidenceSha256: HASH,
      });
      expect(reversal.status).toBe('posted');
      expect(replay.status).toBe('replayed');
      expect(voucherLines(sqlite, String(reversal.voucherPublicId))).toEqual([
        expect.objectContaining({ account_code: '5000', debit_minor: 0, credit_minor: 1500 }),
        expect.objectContaining({ account_code: '1000', debit_minor: 1500, credit_minor: 0 }),
      ]);
      expect((sqlite.prepare(`SELECT status FROM canonical_accounting_vouchers WHERE voucher_public_id=?`).get(posted.voucherPublicId) as { status: string }).status).toBe('posted');
    } finally { sqlite.close(); }
  });

  it('detects source drift after posting without creating a second voucher', async () => {
    const { sqlite, db } = harness();
    try {
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-drift',aggregateType: 'canonical_expense',aggregatePublicId: 'expense-drift',
        eventType: 'canonical.accounting.expense.paid',
        payload: { amountMinor: 1000,currencyCode: 'BDT',paymentMethod: 'cash',expenseMappingKey: 'expense_default',sourceEvidenceSha256: HASH },
      });
      await postCanonicalAccountingEvent(db, { tenantId: 'tenant-a',outboxEventPublicId: 'outbox-drift',nowUtc: NOW });
      sqlite.prepare(`UPDATE canonical_outbox_events SET payload_json=? WHERE tenant_id='tenant-a' AND event_public_id='outbox-drift'`)
        .run(JSON.stringify({ amountMinor: 1100,currencyCode: 'BDT',paymentMethod: 'cash',expenseMappingKey: 'expense_default',sourceEvidenceSha256: HASH }));
      await expect(postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-drift',nowUtc: '2026-07-14T08:00:00.000Z',
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(count(sqlite, 'canonical_accounting_vouchers')).toBe(1);
      const issue = sqlite.prepare(`
        SELECT issue_code FROM canonical_processing_issues
        WHERE tenant_id='tenant-a' AND issue_type='accounting_posting'
      `).get() as { issue_code: string };
      expect(issue.issue_code).toBe('ACCOUNTING_SOURCE_DRIFT');
    } finally { sqlite.close(); }
  });

  it('rejects cross-tenant and currency-mismatched references', async () => {
    const { sqlite, db } = harness();
    try {
      seedAccountingConfiguration(sqlite, 'tenant-b');
      seedOutbox(sqlite, {
        tenantId: 'tenant-b',eventPublicId: 'outbox-cross',aggregateType: 'canonical_expense',aggregatePublicId: 'expense-cross',
        eventType: 'canonical.accounting.expense.paid',
        payload: { amountMinor: 1000,currencyCode: 'USD',paymentMethod: 'cash',expenseMappingKey: 'expense_default',sourceEvidenceSha256: HASH },
      });
      await expect(postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-a',outboxEventPublicId: 'outbox-cross',nowUtc: NOW,
      })).rejects.toThrow(/not found/i);
      const result = await postCanonicalAccountingEvent(db, {
        tenantId: 'tenant-b',outboxEventPublicId: 'outbox-cross',nowUtc: NOW,
      });
      expect(result.status).toBe('posted');
      expect((sqlite.prepare(`SELECT currency_code FROM canonical_accounting_vouchers WHERE tenant_id='tenant-b'`).get() as { currency_code: string }).currency_code).toBe('USD');
    } finally { sqlite.close(); }
  });

  it('scans pending and retry jobs without duplicate postings', async () => {
    const { sqlite, db } = harness();
    try {
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-scan-1',aggregateType: 'canonical_expense',aggregatePublicId: 'expense-scan-1',
        eventType: 'canonical.accounting.expense.paid',
        payload: { amountMinor: 100,currencyCode: 'BDT',paymentMethod: 'cash',expenseMappingKey: 'expense_default',sourceEvidenceSha256: HASH },
      });
      seedOutbox(sqlite, {
        eventPublicId: 'outbox-scan-2',aggregateType: 'canonical_payroll',aggregatePublicId: 'payroll-scan-2',
        eventType: 'canonical.accounting.payroll.paid',
        payload: { amountMinor: 200,currencyCode: 'BDT',paymentMethod: 'bank_transfer',sourceEvidenceSha256: HASH },
      });
      const first = await postPendingCanonicalAccountingEvents(db, {
        tenantId: 'tenant-a',limit: 10,nowUtc: NOW,maxAttempts: 3,
      });
      const second = await postPendingCanonicalAccountingEvents(db, {
        tenantId: 'tenant-a',limit: 10,nowUtc: '2026-07-14T08:00:00.000Z',maxAttempts: 3,
      });
      expect(first).toMatchObject({ scanned: 2, posted: 2, retry: 0, deadLetter: 0 });
      expect(second).toMatchObject({ scanned: 0, posted: 0 });
      expect(count(sqlite, 'canonical_accounting_vouchers')).toBe(2);
    } finally { sqlite.close(); }
  });

  it('rolls back cash-ledger projection and accounting evidence when custody command claim conflicts', async () => {
    const { sqlite, db } = harness();
    try {
      seedOutbox(sqlite, {
        eventPublicId: 'bridge-custody-conflict',
        aggregateType: 'canonical_cash_custody',
        aggregatePublicId: 'existing-custody-event',
        eventType: 'canonical.cash_custody.movement_recorded',
        payload: {
          custodyPublicId: 'counter-session:9',
          movementType: 'shadow',
          direction: 'out',
          amountMinor: 100,
        },
      });

      await expect(createCashLedgerEntry(db as unknown as D1Database, {
        tenantId: 'tenant-a',
        sourceType: 'expense',
        sourceId: 78,
        eventType: 'EXPENSE_PAID',
        movementDirection: 'out',
        cashStatus: 'EXPENSE_PAID',
        amount: 25,
        paymentMethod: 'cash',
        counterSessionId: 9,
        counterId: 3,
        currentLocationType: 'expense',
        idempotencyKey: 'cash-ledger-expense-78',
        occurredAt: NOW,
        canonicalBridge: {
          currencyCode: 'BDT',
          businessDate: DATE,
          sourceEvidenceSha256: HASH,
          accountingEventPublicId: 'bridge-accounting-78',
          cashCustodyEventPublicId: 'bridge-custody-conflict',
          expenseMappingKey: 'expense_default',
        },
      })).rejects.toThrow();

      expect(count(sqlite, 'cash_ledger_entries')).toBe(0);
      expect(sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_outbox_events
        WHERE event_public_id='bridge-accounting-78'
      `).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_source_mappings
        WHERE tenant_id='tenant-a' AND source_type='legacy_cash_ledger_entry'
          AND source_public_id='cash-ledger-expense-78'
      `).get()).toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });

  it('bridges an explicit cash-ledger shadow write to PHI-free canonical accounting and custody outbox events', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await shadowCreateCashLedgerEntry(db as unknown as D1Database, {
        tenantId: 'tenant-a',sourceType: 'expense',sourceId: 77,sourceNo: 'EXP-77',
        eventType: 'EXPENSE_PAID',movementDirection: 'out',cashStatus: 'EXPENSE_PAID',
        status: 'posted',amount: 25,expectedAmount: 25,receivedAmount: 0,dueAmount: 0,
        paymentMethod: 'cash',fromUserId: 7,counterSessionId: 9,counterId: 3,
        currentLocationType: 'expense',currentLocationLabel: 'Sensitive free text',
        referenceType: 'expense',referenceId: 77,note: 'Patient-specific note must not leak',
        metadata: { patientName: 'Do not persist in canonical payload' },
        idempotencyKey: 'cash-ledger-expense-77',createdBy: 7,occurredAt: NOW,
        canonicalBridge: {
          currencyCode: 'BDT',businessDate: DATE,sourceEvidenceSha256: HASH,
          accountingEventPublicId: 'bridge-accounting-77',cashCustodyEventPublicId: 'bridge-custody-77',
          expenseMappingKey: 'expense_default',
        },
      });
      expect(result.inserted).toBe(true);
      expect(count(sqlite, 'cash_ledger_entries')).toBe(1);
      const events = sqlite.prepare(`
        SELECT event_type,payload_json FROM canonical_outbox_events
        WHERE tenant_id='tenant-a' AND event_public_id IN ('bridge-accounting-77','bridge-custody-77')
        ORDER BY event_public_id
      `).all() as Array<{ event_type: string; payload_json: string }>;
      expect(events).toHaveLength(2);
      const combined = events.map((event) => event.payload_json).join('\n');
      expect(combined).not.toContain('Sensitive free text');
      expect(combined).not.toContain('Patient-specific note must not leak');
      expect(combined).not.toContain('Do not persist in canonical payload');
      expect(combined).not.toContain('patientName');
      expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining([
        'canonical.accounting.expense.paid','canonical.cash_custody.movement_recorded',
      ]));
      expect(sqlite.prepare(`
        SELECT entity_type,source_type,source_public_id,source_table
        FROM canonical_source_mappings
        WHERE tenant_id='tenant-a' AND source_type='legacy_cash_ledger_entry'
      `).get()).toEqual({
        entity_type: 'cash_custody_movement',
        source_type: 'legacy_cash_ledger_entry',
        source_public_id: 'cash-ledger-expense-77',
        source_table: 'cash_ledger_entries',
      });
    } finally { sqlite.close(); }
  });

  it('rolls back the cash-ledger projection and accounting event when the custody claim conflicts', async () => {
    const { sqlite, db } = harness();
    try {
      seedOutbox(sqlite, {
        eventPublicId: 'bridge-custody-conflict',
        aggregateType: 'canonical_cash_custody',
        aggregatePublicId: 'existing-custody',
        eventType: 'canonical.cash_custody.movement_recorded',
        payload: {
          custodyPublicId: 'counter-session:9',
          movementType: 'shadow',
          direction: 'out',
          amountMinor: 2500,
        },
      });

      await expect(createCashLedgerEntry(db as unknown as D1Database, {
        tenantId: 'tenant-a',
        sourceType: 'expense',
        sourceId: 78,
        sourceNo: 'EXP-78',
        eventType: 'EXPENSE_PAID',
        movementDirection: 'out',
        cashStatus: 'EXPENSE_PAID',
        status: 'posted',
        amount: 25,
        paymentMethod: 'cash',
        fromUserId: 7,
        counterSessionId: 9,
        counterId: 3,
        currentLocationType: 'expense',
        referenceType: 'expense',
        referenceId: 78,
        idempotencyKey: 'cash-ledger-expense-78',
        createdBy: 7,
        occurredAt: NOW,
        canonicalBridge: {
          currencyCode: 'BDT',
          businessDate: DATE,
          sourceEvidenceSha256: HASH,
          accountingEventPublicId: 'bridge-accounting-78',
          cashCustodyEventPublicId: 'bridge-custody-conflict',
          expenseMappingKey: 'expense_default',
        },
      })).rejects.toThrow();

      expect(count(sqlite, 'cash_ledger_entries')).toBe(0);
      expect(sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_outbox_events
        WHERE tenant_id='tenant-a' AND event_public_id='bridge-accounting-78'
      `).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_source_mappings
        WHERE tenant_id='tenant-a' AND source_type='legacy_cash_ledger_entry'
          AND source_public_id='cash-ledger-expense-78'
      `).get()).toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });
});
