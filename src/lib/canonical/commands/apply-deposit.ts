import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { stableCanonicalJson } from '../idempotency';
import { toUtcIso } from '../time';

export type AdjustmentTenderType = 'cash' | 'card' | 'mobile_wallet' | 'bank_transfer' | 'gateway' | 'other';

interface SourceIdentity {
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface RecordDepositInput extends SourceIdentity {
  tenantId: string;
  depositPublicId: string;
  depositNumber: string;
  receiptPublicId: string;
  receiptAuthority?: {
    legacyPatientId: number;
    currencyCode: string;
    amountMinor: number;
    tenderPublicId: string;
    tenderType: AdjustmentTenderType;
    methodCode: string;
    receivedAtUtc: string;
    businessDate: string;
    sourceEvidenceSha256: string;
  };
}

export interface RecordDepositResult {
  depositPublicId: string;
  amountMinor: number;
  availableMinor: number;
}

export interface ApplyDepositInput extends SourceIdentity {
  tenantId: string;
  applicationPublicId: string;
  depositPublicId: string;
  invoicePublicId: string;
  invoiceLinePublicId?: string | null;
  amountMinor: number;
  appliedAtUtc: string;
  businessDate: string;
}

export interface ApplyDepositResult {
  applicationPublicId: string;
  appliedMinor: number;
  availableMinor: number;
  invoiceNetDueMinor: number;
}

export interface RefundDepositInput extends SourceIdentity {
  tenantId: string;
  refundPublicId: string;
  depositPublicId: string;
  amountMinor: number;
  tenderType: AdjustmentTenderType;
  methodCode: string;
  refundedAtUtc: string;
  businessDate: string;
  cashCustodyEventPublicId?: string | null;
}

export interface RefundDepositResult {
  refundPublicId: string;
  refundedMinor: number;
  availableMinor: number;
}

interface ReceiptRow {
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  allocated_total_minor: number;
  unallocated_minor: number;
  refunded_minor: number;
  net_received_minor: number;
  status: string;
  received_at_utc: string;
  business_date: string;
  posted_at_utc: string | null;
}

interface DepositRow {
  legacy_patient_id: number;
  currency_code: string;
  amount_minor: number;
  applied_minor: number;
  refunded_minor: number;
  available_minor: number;
  status: string;
}

interface InvoiceRow {
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return exact(value, label);
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function digest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function validateSource(input: SourceIdentity): void {
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
}

function mappingStatement(
  db: CanonicalBatchDatabase,
  input: SourceIdentity & { tenantId: string },
  entityType: string,
  canonicalPublicId: string,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,?,?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    entityType,
    canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.sourceEvidenceSha256,
  );
}

export async function recordDeposit(
  db: CanonicalBatchDatabase,
  input: RecordDepositInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<RecordDepositResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.depositPublicId, 'depositPublicId');
  exact(input.depositNumber, 'depositNumber');
  exact(input.receiptPublicId, 'receiptPublicId');
  validateSource(input);

  const request = {
    depositPublicId: input.depositPublicId,
    depositNumber: input.depositNumber,
    receiptPublicId: input.receiptPublicId,
    receiptAuthority: input.receiptAuthority ?? null,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<RecordDepositResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.deposit.record',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const storedReceipt = await db.prepare(`
    SELECT legacy_patient_id,currency_code,total_minor,allocated_total_minor,
           unallocated_minor,refunded_minor,net_received_minor,status,
           received_at_utc,business_date,posted_at_utc
    FROM canonical_payment_receipts
    WHERE tenant_id=? AND receipt_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.receiptPublicId).first<ReceiptRow>();
  const authority = input.receiptAuthority;
  if (authority) {
    positive(authority.legacyPatientId, 'receiptAuthority.legacyPatientId');
    exact(authority.currencyCode, 'receiptAuthority.currencyCode');
    positive(authority.amountMinor, 'receiptAuthority.amountMinor');
    exact(authority.tenderPublicId, 'receiptAuthority.tenderPublicId');
    exact(authority.tenderType, 'receiptAuthority.tenderType');
    exact(authority.methodCode, 'receiptAuthority.methodCode');
    utc(authority.receivedAtUtc, 'receiptAuthority.receivedAtUtc');
    exact(authority.businessDate, 'receiptAuthority.businessDate');
    digest(authority.sourceEvidenceSha256, 'receiptAuthority.sourceEvidenceSha256');
  }
  if (!storedReceipt && !authority) throw new Error('Canonical payment receipt not found');
  const receipt: ReceiptRow = storedReceipt ?? {
    legacy_patient_id: authority!.legacyPatientId,
    currency_code: authority!.currencyCode,
    total_minor: authority!.amountMinor,
    allocated_total_minor: 0,
    unallocated_minor: authority!.amountMinor,
    refunded_minor: 0,
    net_received_minor: authority!.amountMinor,
    status: 'posted',
    received_at_utc: authority!.receivedAtUtc,
    business_date: authority!.businessDate,
    posted_at_utc: authority!.receivedAtUtc,
  };
  if (storedReceipt && authority && (
    storedReceipt.legacy_patient_id !== authority.legacyPatientId
    || storedReceipt.currency_code !== authority.currencyCode
    || storedReceipt.total_minor !== authority.amountMinor
  )) {
    throw new Error('Canonical deposit receipt authority conflicts with stored receipt');
  }
  if (receipt.status !== 'posted' || receipt.posted_at_utc == null) {
    throw new Error('Deposit requires a posted payment receipt');
  }
  if (
    receipt.allocated_total_minor !== 0
    || receipt.unallocated_minor !== receipt.total_minor
    || receipt.refunded_minor !== 0
    || receipt.net_received_minor !== receipt.total_minor
  ) {
    throw new Error('Deposit receipt must be fully unallocated and unreversed');
  }

  const result: RecordDepositResult = {
    depositPublicId: input.depositPublicId,
    amountMinor: receipt.total_minor,
    availableMinor: receipt.total_minor,
  };

  const receiptStatements: CanonicalPreparedStatement[] = storedReceipt ? [] : [
    db.prepare(`
      INSERT INTO canonical_payment_receipts (
        tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
        total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
        business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
        refunded_minor,net_received_minor,refund_projection_guard
      ) VALUES (?,?,?,?,?,?,0,?,'posted',?,?,?,1,?,0,?,1)
    `).bind(
      input.tenantId,
      input.receiptPublicId,
      input.depositNumber,
      authority!.legacyPatientId,
      authority!.currencyCode,
      authority!.amountMinor,
      authority!.amountMinor,
      authority!.receivedAtUtc,
      authority!.businessDate,
      authority!.receivedAtUtc,
      authority!.sourceEvidenceSha256,
      authority!.amountMinor,
    ),
    db.prepare(`
      INSERT INTO canonical_payment_tenders (
        tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
        amount_minor,status,captured_at_utc,source_evidence_sha256,
        reversed_minor,remaining_minor,reversal_projection_guard
      ) VALUES (?,?,?,?,?,?,'captured',?,?,0,?,1)
    `).bind(
      input.tenantId,
      authority!.tenderPublicId,
      input.receiptPublicId,
      authority!.tenderType,
      authority!.methodCode,
      authority!.amountMinor,
      authority!.receivedAtUtc,
      authority!.sourceEvidenceSha256,
      authority!.amountMinor,
    ),
  ];

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.deposit.record',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements: [
      ...receiptStatements,
      db.prepare(`
        INSERT INTO canonical_deposits (
          tenant_id,deposit_public_id,deposit_number,receipt_public_id,
          legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
          available_minor,status,received_at_utc,business_date,posted_at_utc,
          reconciliation_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,0,0,?,'posted',?,?,?,1,?)
      `).bind(
        input.tenantId,
        input.depositPublicId,
        input.depositNumber,
        input.receiptPublicId,
        receipt.legacy_patient_id,
        receipt.currency_code,
        receipt.total_minor,
        receipt.total_minor,
        receipt.received_at_utc,
        receipt.business_date,
        receipt.posted_at_utc,
        input.sourceEvidenceSha256,
      ),
    ],
    reconciliationStatements: [
      ...(storedReceipt ? [] : [mappingStatement(db, input, 'payment_receipt', input.receiptPublicId)]),
      mappingStatement(db, input, 'deposit', input.depositPublicId),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_deposit',
      aggregatePublicId: input.depositPublicId,
      eventType: 'canonical.deposit.recorded',
      occurredAtUtc: receipt.posted_at_utc,
      businessDate: receipt.business_date,
      payload: {
        amountMinor: receipt.total_minor,
        depositPublicId: input.depositPublicId,
        receiptPublicId: input.receiptPublicId,
      },
    },
  });
}

export async function applyDeposit(
  db: CanonicalBatchDatabase,
  input: ApplyDepositInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<ApplyDepositResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.applicationPublicId, 'applicationPublicId');
  exact(input.depositPublicId, 'depositPublicId');
  exact(input.invoicePublicId, 'invoicePublicId');
  optionalExact(input.invoiceLinePublicId, 'invoiceLinePublicId');
  positive(input.amountMinor, 'amountMinor');
  utc(input.appliedAtUtc, 'appliedAtUtc');
  exact(input.businessDate, 'businessDate');
  validateSource(input);

  const request = {
    applicationPublicId: input.applicationPublicId,
    depositPublicId: input.depositPublicId,
    invoicePublicId: input.invoicePublicId,
    invoiceLinePublicId: input.invoiceLinePublicId ?? null,
    amountMinor: input.amountMinor,
    appliedAtUtc: input.appliedAtUtc,
    businessDate: input.businessDate,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<ApplyDepositResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.deposit.apply',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const deposit = await db.prepare(`
    SELECT legacy_patient_id,currency_code,amount_minor,applied_minor,
           refunded_minor,available_minor,status
    FROM canonical_deposits
    WHERE tenant_id=? AND deposit_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.depositPublicId).first<DepositRow>();
  if (!deposit) throw new Error('Canonical deposit not found');
  if (deposit.status !== 'posted') throw new Error('Canonical deposit is not available');
  if (deposit.available_minor < input.amountMinor) throw new RangeError('Deposit available balance is insufficient');

  const invoice = await db.prepare(`
    SELECT legacy_patient_id,currency_code,total_minor,paid_minor,due_minor,
           credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.invoicePublicId).first<InvoiceRow>();
  if (!invoice) throw new Error('Canonical invoice not found');
  if (invoice.status !== 'posted') throw new Error('Canonical invoice is not posted');
  if (invoice.legacy_patient_id !== deposit.legacy_patient_id) throw new Error('Deposit and invoice patient mismatch');
  if (invoice.currency_code !== deposit.currency_code) throw new Error('Deposit and invoice currency mismatch');
  if (invoice.due_minor < input.amountMinor || invoice.net_due_minor < input.amountMinor) {
    throw new RangeError('Deposit application exceeds invoice outstanding balance');
  }
  if (input.invoiceLinePublicId != null) {
    const line = await db.prepare(`
      SELECT 1 present FROM canonical_invoice_lines
      WHERE tenant_id=? AND invoice_public_id=? AND line_public_id=?
      LIMIT 1
    `).bind(input.tenantId, input.invoicePublicId, input.invoiceLinePublicId).first<{ present: number }>();
    if (!line) throw new Error('Canonical invoice line not found');
  }

  const depositAvailableAfter = deposit.available_minor - input.amountMinor;
  const depositAppliedAfter = deposit.applied_minor + input.amountMinor;
  const invoicePaidAfter = invoice.paid_minor + input.amountMinor;
  const invoiceDueAfter = invoice.due_minor - input.amountMinor;
  const invoiceNetDueAfter = invoice.net_due_minor - input.amountMinor;
  const result: ApplyDepositResult = {
    applicationPublicId: input.applicationPublicId,
    appliedMinor: input.amountMinor,
    availableMinor: depositAvailableAfter,
    invoiceNetDueMinor: invoiceNetDueAfter,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.deposit.apply',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements: [
      db.prepare(`
        INSERT INTO canonical_deposit_applications (
          tenant_id,application_public_id,deposit_public_id,invoice_public_id,
          invoice_line_public_id,amount_minor,deposit_available_before_minor,
          deposit_available_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
          invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
          invoice_net_due_after_minor,status,applied_at_utc,balance_guard,
          source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,1,?)
      `).bind(
        input.tenantId,
        input.applicationPublicId,
        input.depositPublicId,
        input.invoicePublicId,
        input.invoiceLinePublicId ?? null,
        input.amountMinor,
        deposit.available_minor,
        depositAvailableAfter,
        invoice.paid_minor,
        invoicePaidAfter,
        invoice.due_minor,
        invoiceDueAfter,
        invoice.net_due_minor,
        invoiceNetDueAfter,
        input.appliedAtUtc,
        input.sourceEvidenceSha256,
      ),
      db.prepare(`
        UPDATE canonical_deposits
        SET applied_minor=?,available_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND deposit_public_id=? AND status='posted'
          AND applied_minor=? AND refunded_minor=? AND available_minor=?
      `).bind(
        depositAppliedAfter,
        depositAvailableAfter,
        input.appliedAtUtc,
        input.tenantId,
        input.depositPublicId,
        deposit.applied_minor,
        deposit.refunded_minor,
        deposit.available_minor,
      ),
      db.prepare(`
        UPDATE canonical_invoices
        SET paid_minor=?,due_minor=?,net_due_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
          AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
      `).bind(
        invoicePaidAfter,
        invoiceDueAfter,
        invoiceNetDueAfter,
        input.appliedAtUtc,
        input.tenantId,
        input.invoicePublicId,
        invoice.paid_minor,
        invoice.due_minor,
        invoice.credited_minor,
        invoice.net_due_minor,
      ),
      db.prepare(`
        UPDATE canonical_deposit_applications
        SET balance_guard=CASE WHEN
          EXISTS (
            SELECT 1 FROM canonical_deposits
            WHERE tenant_id=? AND deposit_public_id=?
              AND applied_minor=? AND refunded_minor=? AND available_minor=?
          ) AND EXISTS (
            SELECT 1 FROM canonical_invoices
            WHERE tenant_id=? AND invoice_public_id=?
              AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
          ) THEN 1 ELSE 0 END
        WHERE tenant_id=? AND application_public_id=?
      `).bind(
        input.tenantId,
        input.depositPublicId,
        depositAppliedAfter,
        deposit.refunded_minor,
        depositAvailableAfter,
        input.tenantId,
        input.invoicePublicId,
        invoicePaidAfter,
        invoiceDueAfter,
        invoice.credited_minor,
        invoiceNetDueAfter,
        input.tenantId,
        input.applicationPublicId,
      ),
    ],
    reconciliationStatements: [mappingStatement(db, input, 'deposit_application', input.applicationPublicId)],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_deposit',
      aggregatePublicId: input.depositPublicId,
      eventType: 'canonical.deposit.applied',
      occurredAtUtc: input.appliedAtUtc,
      businessDate: input.businessDate,
      payload: {
        amountMinor: input.amountMinor,
        applicationPublicId: input.applicationPublicId,
        depositPublicId: input.depositPublicId,
        invoicePublicId: input.invoicePublicId,
      },
    },
  });
}

export async function refundDeposit(
  db: CanonicalBatchDatabase,
  input: RefundDepositInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<RefundDepositResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.refundPublicId, 'refundPublicId');
  exact(input.depositPublicId, 'depositPublicId');
  positive(input.amountMinor, 'amountMinor');
  exact(input.methodCode, 'methodCode');
  utc(input.refundedAtUtc, 'refundedAtUtc');
  exact(input.businessDate, 'businessDate');
  validateSource(input);
  if (!['cash', 'card', 'mobile_wallet', 'bank_transfer', 'gateway', 'other'].includes(input.tenderType)) {
    throw new RangeError(`Unsupported tenderType: ${input.tenderType}`);
  }
  if (input.tenderType === 'cash') exact(input.cashCustodyEventPublicId ?? '', 'cashCustodyEventPublicId');

  const request = {
    refundPublicId: input.refundPublicId,
    depositPublicId: input.depositPublicId,
    amountMinor: input.amountMinor,
    tenderType: input.tenderType,
    methodCode: input.methodCode,
    refundedAtUtc: input.refundedAtUtc,
    businessDate: input.businessDate,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<RefundDepositResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.deposit.refund',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const deposit = await db.prepare(`
    SELECT legacy_patient_id,currency_code,amount_minor,applied_minor,
           refunded_minor,available_minor,status
    FROM canonical_deposits
    WHERE tenant_id=? AND deposit_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.depositPublicId).first<DepositRow>();
  if (!deposit) throw new Error('Canonical deposit not found');
  if (deposit.status !== 'posted') throw new Error('Canonical deposit is not available');
  if (deposit.available_minor < input.amountMinor) throw new RangeError('Deposit available balance is insufficient for refund');

  const availableAfter = deposit.available_minor - input.amountMinor;
  const refundedAfter = deposit.refunded_minor + input.amountMinor;
  const result: RefundDepositResult = {
    refundPublicId: input.refundPublicId,
    refundedMinor: input.amountMinor,
    availableMinor: availableAfter,
  };
  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_refunds (
        tenant_id,refund_public_id,source_type,deposit_public_id,amount_minor,
        tender_type,method_code,status,refunded_at_utc,business_date,
        source_available_before_minor,source_available_after_minor,liability_guard,
        source_evidence_sha256
      ) VALUES (?,?,'deposit',?,?,?,?,'posted',?,?,?,?,1,?)
    `).bind(
      input.tenantId,
      input.refundPublicId,
      input.depositPublicId,
      input.amountMinor,
      input.tenderType,
      input.methodCode,
      input.refundedAtUtc,
      input.businessDate,
      deposit.available_minor,
      availableAfter,
      input.sourceEvidenceSha256,
    ),
    db.prepare(`
      UPDATE canonical_deposits
      SET refunded_minor=?,available_minor=?,updated_at_utc=?
      WHERE tenant_id=? AND deposit_public_id=? AND status='posted'
        AND applied_minor=? AND refunded_minor=? AND available_minor=?
    `).bind(
      refundedAfter,
      availableAfter,
      input.refundedAtUtc,
      input.tenantId,
      input.depositPublicId,
      deposit.applied_minor,
      deposit.refunded_minor,
      deposit.available_minor,
    ),
    db.prepare(`
      UPDATE canonical_refunds
      SET liability_guard=CASE WHEN EXISTS (
        SELECT 1 FROM canonical_deposits
        WHERE tenant_id=? AND deposit_public_id=?
          AND applied_minor=? AND refunded_minor=? AND available_minor=?
      ) THEN 1 ELSE 0 END
      WHERE tenant_id=? AND refund_public_id=?
    `).bind(
      input.tenantId,
      input.depositPublicId,
      deposit.applied_minor,
      refundedAfter,
      availableAfter,
      input.tenantId,
      input.refundPublicId,
    ),
  ];

  if (input.tenderType === 'cash') {
    statements.push(db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      input.tenantId,
      input.cashCustodyEventPublicId,
      'canonical_cash_custody',
      input.refundPublicId,
      'canonical.cash_custody.refund_recorded',
      stableCanonicalJson({ amountMinor: input.amountMinor, refundPublicId: input.refundPublicId }),
      input.refundedAtUtc,
      input.businessDate,
      `${input.idempotencyKey}:cash-custody`,
    ));
  }

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.deposit.refund',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements: [mappingStatement(db, input, 'refund', input.refundPublicId)],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_refund',
      aggregatePublicId: input.refundPublicId,
      eventType: 'canonical.deposit.refunded',
      occurredAtUtc: input.refundedAtUtc,
      businessDate: input.businessDate,
      payload: {
        amountMinor: input.amountMinor,
        depositPublicId: input.depositPublicId,
        refundPublicId: input.refundPublicId,
        tenderType: input.tenderType,
      },
    },
  });
}
