import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../financial-batch-assertion';
import { stableCanonicalJson } from '../idempotency';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../source-mapping';
import { toUtcIso } from '../time';

const SETTLEMENT_SOURCE_TYPE = 'legacy_settlement';
const PAYMENT_SOURCE_TYPE = 'legacy_settlement_payment';
const DEPOSIT_SOURCE_TYPE = 'legacy_settlement_deposit_adjustment';
const DISCOUNT_SOURCE_TYPE = 'legacy_settlement_discount';
const CANCELLATION_SOURCE_TYPE = 'legacy_settlement_cancellation';

export interface CancelSettlementDepositApplicationInput {
  applicationPublicId: string;
  depositPublicId: string;
  amountMinor: number;
}

export interface CancelSettlementBillInput {
  billId: number;
  invoicePublicId: string;
  invoiceNumber: string;
  totalMinor: number;
  paidBeforeSettlementMinor: number;
  dueBeforeSettlementMinor: number;
  creditedBeforeSettlementMinor: number;
  netDueBeforeSettlementMinor: number;
  paidAfterSettlementMinor: number;
  dueAfterSettlementMinor: number;
  creditedAfterSettlementMinor: number;
  netDueAfterSettlementMinor: number;
  cashMinor: number;
  depositMinor: number;
  discountMinor: number;
  paymentReceiptPublicId: string | null;
  depositApplications: CancelSettlementDepositApplicationInput[];
  creditNotePublicId: string | null;
}

export interface CancelSettlementInput {
  tenantId: string;
  commandIdempotencyKey: string;
  settlementPublicId: string;
  settlementReceiptNumber: string;
  cancellationSourcePublicId: string;
  reasonCode: string;
  cancelledAtUtc: string;
  businessDate: string;
  bills: CancelSettlementBillInput[];
}

export interface CancelSettlementBillResult {
  billId: number;
  invoicePublicId: string;
  paymentReversalPublicId: string | null;
  refundPublicId: string | null;
  depositApplicationCount: number;
  creditNotePublicId: string | null;
}

export interface CancelSettlementResult {
  settlementPublicId: string;
  settlementReceiptNumber: string;
  cancellationPublicId: string;
  cashMinor: number;
  depositMinor: number;
  discountMinor: number;
  bills: CancelSettlementBillResult[];
}

type QueryStatement = CanonicalPreparedStatement & {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

type MappingRow = {
  canonical_public_id: string | null;
  source_public_id: string;
  mapping_status: string;
};

type InvoiceRow = {
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
};

type ReceiptRow = {
  receipt_public_id: string;
  receipt_number: string;
  total_minor: number;
  allocated_total_minor: number;
  refunded_minor: number;
  net_received_minor: number;
  status: string;
};

type TenderRow = {
  tender_public_id: string;
  receipt_public_id: string;
  tender_type: string;
  method_code: string;
  amount_minor: number;
  reversed_minor: number;
  remaining_minor: number;
  status: string;
};

type AllocationRow = {
  allocation_public_id: string;
  receipt_public_id: string;
  invoice_public_id: string;
  amount_minor: number;
  reversed_minor: number;
  remaining_minor: number;
  status: string;
};

type DepositApplicationRow = {
  application_public_id: string;
  deposit_public_id: string;
  invoice_public_id: string;
  amount_minor: number;
  status: string;
  reversed_at_utc: string | null;
};

type DepositRow = {
  deposit_public_id: string;
  amount_minor: number;
  applied_minor: number;
  refunded_minor: number;
  available_minor: number;
  status: string;
};

type CreditNoteRow = {
  credit_note_public_id: string;
  invoice_public_id: string;
  total_minor: number;
  status: string;
  reversed_at_utc: string | null;
};

type PreparedPayment = {
  receipt: ReceiptRow;
  tender: TenderRow;
  allocation: AllocationRow;
  reversalPublicId: string;
  refundPublicId: string;
  evidenceSha256: string;
  cashCustodyEventPublicId: string | null;
};

type PreparedDepositApplication = {
  input: CancelSettlementDepositApplicationInput;
  row: DepositApplicationRow;
};

type PreparedBill = {
  input: CancelSettlementBillInput;
  invoice: InvoiceRow;
  payment: PreparedPayment | null;
  depositApplications: PreparedDepositApplication[];
  creditNote: CreditNoteRow | null;
};

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function validBusinessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('businessDate must use YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return value;
}

function normalizedUtc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function assertBillArithmetic(bill: CancelSettlementBillInput): void {
  positive(bill.billId, 'billId');
  exact(bill.invoicePublicId, 'invoicePublicId');
  exact(bill.invoiceNumber, 'invoiceNumber');
  positive(bill.totalMinor, 'totalMinor');
  for (const [label, value] of Object.entries({
    paidBeforeSettlementMinor: bill.paidBeforeSettlementMinor,
    dueBeforeSettlementMinor: bill.dueBeforeSettlementMinor,
    creditedBeforeSettlementMinor: bill.creditedBeforeSettlementMinor,
    netDueBeforeSettlementMinor: bill.netDueBeforeSettlementMinor,
    paidAfterSettlementMinor: bill.paidAfterSettlementMinor,
    dueAfterSettlementMinor: bill.dueAfterSettlementMinor,
    creditedAfterSettlementMinor: bill.creditedAfterSettlementMinor,
    netDueAfterSettlementMinor: bill.netDueAfterSettlementMinor,
    cashMinor: bill.cashMinor,
    depositMinor: bill.depositMinor,
    discountMinor: bill.discountMinor,
  })) nonNegative(value, label);

  if (bill.paidBeforeSettlementMinor + bill.dueBeforeSettlementMinor !== bill.totalMinor) {
    throw new Error('Pre-settlement paid and due balances do not reconcile');
  }
  if (bill.paidAfterSettlementMinor + bill.dueAfterSettlementMinor !== bill.totalMinor) {
    throw new Error('Post-settlement paid and due balances do not reconcile');
  }
  if (bill.netDueBeforeSettlementMinor !== bill.dueBeforeSettlementMinor - bill.creditedBeforeSettlementMinor) {
    throw new Error('Pre-settlement invoice net-due projection does not reconcile');
  }
  if (bill.netDueAfterSettlementMinor !== bill.dueAfterSettlementMinor - bill.creditedAfterSettlementMinor) {
    throw new Error('Post-settlement invoice net-due projection does not reconcile');
  }
  if (bill.paidAfterSettlementMinor !== bill.paidBeforeSettlementMinor + bill.cashMinor + bill.depositMinor) {
    throw new Error('Settlement paid projection does not reconcile');
  }
  if (bill.dueAfterSettlementMinor !== bill.dueBeforeSettlementMinor - bill.cashMinor - bill.depositMinor) {
    throw new Error('Settlement due projection does not reconcile');
  }
  if (bill.creditedAfterSettlementMinor !== bill.creditedBeforeSettlementMinor + bill.discountMinor) {
    throw new Error('Settlement credited projection does not reconcile');
  }
  if (
    bill.netDueAfterSettlementMinor
    !== bill.netDueBeforeSettlementMinor - bill.cashMinor - bill.depositMinor - bill.discountMinor
  ) {
    throw new Error('Settlement net-due projection does not reconcile');
  }

  if ((bill.cashMinor > 0) !== Boolean(bill.paymentReceiptPublicId)) {
    throw new Error('Cash reversal requires exactly one payment receipt identity');
  }
  if ((bill.discountMinor > 0) !== Boolean(bill.creditNotePublicId)) {
    throw new Error('Discount reversal requires exactly one credit-note identity');
  }
  const depositTotal = bill.depositApplications.reduce((sum, application, index) => {
    exact(application.applicationPublicId, `depositApplications[${index}].applicationPublicId`);
    exact(application.depositPublicId, `depositApplications[${index}].depositPublicId`);
    return sum + positive(application.amountMinor, `depositApplications[${index}].amountMinor`);
  }, 0);
  if (depositTotal !== bill.depositMinor) throw new Error('Deposit application total does not reconcile');
}

async function assertCompensationSafe(
  db: CanonicalBatchDatabase,
  tenantId: string,
  invoicePublicId: string,
  billId: number,
): Promise<void> {
  const blocked = await db.prepare(`
    SELECT 1 present
    WHERE EXISTS (
      SELECT 1 FROM canonical_compensation_accruals c
      WHERE c.tenant_id=? AND c.invoice_public_id=? AND c.settled_minor>0
    ) OR EXISTS (
      SELECT 1 FROM diagnostic_performer_reserves r
      WHERE r.tenant_id=? AND r.bill_id=? AND r.status='paid'
    ) OR EXISTS (
      SELECT 1 FROM doctor_commission_accruals a
      WHERE a.tenant_id=? AND a.bill_id=? AND a.status='paid'
    )
    LIMIT 1
  `).bind(
    tenantId,
    invoicePublicId,
    tenantId,
    billId,
    tenantId,
    billId,
  ).first<{ present: number }>();
  if (blocked) throw new Error('Paid performer reserve or compensation settlement blocks settlement cancellation');
}

async function assertInvoiceMapping(
  db: CanonicalBatchDatabase,
  input: CancelSettlementBillInput,
  tenantId: string,
): Promise<void> {
  const statement = db.prepare(`
    SELECT canonical_public_id,source_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='invoice' AND canonical_public_id=?
      AND source_table='bills' AND mapping_status='mapped'
      AND (
        (source_type='legacy_bill' AND source_public_id=?)
        OR (source_type='legacy_live_bill' AND source_public_id=?)
      )
    ORDER BY source_type,source_public_id
  `).bind(
    tenantId,
    input.invoicePublicId,
    String(input.billId),
    input.invoiceNumber,
  ) as QueryStatement;
  const rows = (await statement.all<MappingRow>()).results ?? [];
  if (rows.length !== 1) {
    throw new Error('Canonical invoice source mapping is missing, duplicate, or conflicting');
  }
}

async function assertMappedIdentity(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: string;
    canonicalPublicId: string;
    sourceType: string;
  },
): Promise<MappingRow> {
  const statement = db.prepare(`
    SELECT canonical_public_id,source_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND canonical_public_id=? AND source_type=?
    ORDER BY source_public_id
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
  ) as QueryStatement;
  const rows = (await statement.all<MappingRow>()).results ?? [];
  if (rows.length !== 1 || rows[0].mapping_status !== 'mapped') {
    throw new Error(`Canonical ${input.entityType} source mapping is missing, duplicate, or conflicting`);
  }
  return rows[0];
}

function assertion(
  db: CanonicalBatchDatabase,
  tenantId: string,
  operationKey: string,
  stepKey: string,
): CanonicalPreparedStatement {
  return prepareFinancialBatchAssertion(db, {
    tenantId,
    operationKey,
    stepKey,
    expectedChanges: 1,
  });
}

function mappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: string;
    canonicalPublicId: string;
    sourcePublicId: string;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,?,?,?,?,'billing_settlements','mapped',1,?)
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    CANCELLATION_SOURCE_TYPE,
    input.sourcePublicId,
    input.evidenceSha256,
  );
}

export async function cancelSettlement(
  db: CanonicalBatchDatabase,
  input: CancelSettlementInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CancelSettlementResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const commandIdempotencyKey = exact(input.commandIdempotencyKey, 'commandIdempotencyKey');
  const settlementPublicId = exact(input.settlementPublicId, 'settlementPublicId');
  const settlementReceiptNumber = exact(input.settlementReceiptNumber, 'settlementReceiptNumber');
  const cancellationSourcePublicId = exact(input.cancellationSourcePublicId, 'cancellationSourcePublicId');
  const reasonCode = exact(input.reasonCode, 'reasonCode');
  const cancelledAtUtc = normalizedUtc(input.cancelledAtUtc, 'cancelledAtUtc');
  const businessDate = validBusinessDate(input.businessDate);
  if (!Array.isArray(input.bills) || input.bills.length === 0) throw new Error('Settlement cancellation requires bills');

  const billIds = new Set<number>();
  const invoiceIds = new Set<string>();
  const paymentReceiptIds = new Set<string>();
  const depositApplicationIds = new Set<string>();
  const creditNoteIds = new Set<string>();
  for (const bill of input.bills) {
    assertBillArithmetic(bill);
    if (billIds.has(bill.billId)) throw new Error('Duplicate settlement bill identity');
    if (invoiceIds.has(bill.invoicePublicId)) throw new Error('Duplicate settlement invoice identity');
    billIds.add(bill.billId);
    invoiceIds.add(bill.invoicePublicId);
    if (bill.paymentReceiptPublicId) {
      exact(bill.paymentReceiptPublicId, 'paymentReceiptPublicId');
      if (paymentReceiptIds.has(bill.paymentReceiptPublicId)) throw new Error('Duplicate payment receipt identity');
      paymentReceiptIds.add(bill.paymentReceiptPublicId);
    }
    for (const application of bill.depositApplications) {
      if (depositApplicationIds.has(application.applicationPublicId)) throw new Error('Duplicate deposit application identity');
      depositApplicationIds.add(application.applicationPublicId);
    }
    if (bill.creditNotePublicId) {
      exact(bill.creditNotePublicId, 'creditNotePublicId');
      if (creditNoteIds.has(bill.creditNotePublicId)) throw new Error('Duplicate credit-note identity');
      creditNoteIds.add(bill.creditNotePublicId);
    }
  }

  const request = {
    settlementPublicId,
    settlementReceiptNumber,
    cancellationSourcePublicId,
    reasonCode,
    cancelledAtUtc,
    businessDate,
    bills: input.bills.map((bill) => ({
      ...bill,
      depositApplications: bill.depositApplications.map((application) => ({ ...application })),
    })),
  };
  const replay = await readCanonicalCommandReplay<CancelSettlementResult>(db, {
    tenantId,
    commandName: 'canonical.settlement.cancel',
    idempotencyKey: commandIdempotencyKey,
    request,
  });
  if (replay) return replay;

  const settlementMapping = await assertMappedIdentity(db, {
    tenantId,
    entityType: 'settlement',
    canonicalPublicId: settlementPublicId,
    sourceType: SETTLEMENT_SOURCE_TYPE,
  });
  if (settlementMapping.source_public_id !== settlementReceiptNumber) {
    throw new Error('Canonical settlement source mapping conflicts with settlement receipt');
  }

  const preparedBills: PreparedBill[] = [];
  const deposits = new Map<string, { row: DepositRow; reverseMinor: number }>();

  for (const bill of input.bills) {
    const invoice = await db.prepare(`
      SELECT total_minor,paid_minor,due_minor,credited_minor,net_due_minor,status
      FROM canonical_invoices
      WHERE tenant_id=? AND invoice_public_id=?
      LIMIT 1
    `).bind(tenantId, bill.invoicePublicId).first<InvoiceRow>();
    if (!invoice) throw new Error('Canonical invoice not found');
    if (
      invoice.status !== 'posted'
      || invoice.total_minor !== bill.totalMinor
      || invoice.paid_minor !== bill.paidAfterSettlementMinor
      || invoice.due_minor !== bill.dueAfterSettlementMinor
      || invoice.credited_minor !== bill.creditedAfterSettlementMinor
      || invoice.net_due_minor !== bill.netDueAfterSettlementMinor
    ) {
      throw new Error('Canonical invoice balance snapshot is stale or inconsistent');
    }
    await assertInvoiceMapping(db, bill, tenantId);
    await assertCompensationSafe(db, tenantId, bill.invoicePublicId, bill.billId);

    let payment: PreparedPayment | null = null;
    if (bill.paymentReceiptPublicId) {
      const receipt = await db.prepare(`
        SELECT receipt_public_id,receipt_number,total_minor,allocated_total_minor,
               refunded_minor,net_received_minor,status
        FROM canonical_payment_receipts
        WHERE tenant_id=? AND receipt_public_id=?
        LIMIT 1
      `).bind(tenantId, bill.paymentReceiptPublicId).first<ReceiptRow>();
      if (!receipt) throw new Error('Canonical settlement payment receipt not found');
      if (
        receipt.status !== 'posted'
        || receipt.total_minor !== bill.cashMinor
        || receipt.allocated_total_minor !== bill.cashMinor
        || receipt.refunded_minor !== 0
        || receipt.net_received_minor !== bill.cashMinor
      ) throw new Error('Canonical settlement payment receipt is not fully reversible');
      const receiptMapping = await assertMappedIdentity(db, {
        tenantId,
        entityType: 'payment_receipt',
        canonicalPublicId: receipt.receipt_public_id,
        sourceType: PAYMENT_SOURCE_TYPE,
      });
      if (receiptMapping.source_public_id !== receipt.receipt_number) {
        throw new Error('Canonical payment source mapping conflicts with receipt identity');
      }

      const tenderStatement = db.prepare(`
        SELECT tender_public_id,receipt_public_id,tender_type,method_code,amount_minor,
               reversed_minor,remaining_minor,status
        FROM canonical_payment_tenders
        WHERE tenant_id=? AND receipt_public_id=?
        ORDER BY id
      `).bind(tenantId, receipt.receipt_public_id) as QueryStatement;
      const tenders = (await tenderStatement.all<TenderRow>()).results ?? [];
      const allocationStatement = db.prepare(`
        SELECT allocation_public_id,receipt_public_id,invoice_public_id,amount_minor,
               reversed_minor,remaining_minor,status
        FROM canonical_payment_allocations
        WHERE tenant_id=? AND receipt_public_id=?
        ORDER BY id
      `).bind(tenantId, receipt.receipt_public_id) as QueryStatement;
      const allocations = (await allocationStatement.all<AllocationRow>()).results ?? [];
      if (tenders.length !== 1 || allocations.length !== 1) {
        throw new Error('Canonical settlement payment child identity is missing or duplicate');
      }
      const tender = tenders[0];
      const allocation = allocations[0];
      if (
        tender.receipt_public_id !== receipt.receipt_public_id
        || tender.amount_minor !== bill.cashMinor
        || tender.reversed_minor !== 0
        || tender.remaining_minor !== bill.cashMinor
        || tender.status !== 'captured'
        || allocation.receipt_public_id !== receipt.receipt_public_id
        || allocation.invoice_public_id !== bill.invoicePublicId
        || allocation.amount_minor !== bill.cashMinor
        || allocation.reversed_minor !== 0
        || allocation.remaining_minor !== bill.cashMinor
        || allocation.status !== 'active'
      ) throw new Error('Canonical settlement payment is not fully reversible');

      const sourcePublicId = `${cancellationSourcePublicId}:payment:${bill.billId}`;
      const reversalPublicId = await createDeterministicSourceId('payrev', tenantId, CANCELLATION_SOURCE_TYPE, sourcePublicId);
      const refundPublicId = await createDeterministicSourceId('refund', tenantId, CANCELLATION_SOURCE_TYPE, sourcePublicId);
      const evidenceSha256 = await createSourceEvidenceSha256({
        sourceType: CANCELLATION_SOURCE_TYPE,
        sourcePublicId,
        settlementPublicId,
        settlementReceiptNumber,
        billId: bill.billId,
        invoicePublicId: bill.invoicePublicId,
        receiptPublicId: receipt.receipt_public_id,
        tenderPublicId: tender.tender_public_id,
        allocationPublicId: allocation.allocation_public_id,
        amountMinor: bill.cashMinor,
        reasonCode,
        cancelledAtUtc,
        businessDate,
      });
      payment = {
        receipt,
        tender,
        allocation,
        reversalPublicId,
        refundPublicId,
        evidenceSha256,
        cashCustodyEventPublicId: tender.tender_type === 'cash'
          ? await createDeterministicSourceId('outevt', tenantId, CANCELLATION_SOURCE_TYPE, `${sourcePublicId}:cash`)
          : null,
      };
    }

    const preparedApplications: PreparedDepositApplication[] = [];
    for (const applicationInput of bill.depositApplications) {
      const application = await db.prepare(`
        SELECT application_public_id,deposit_public_id,invoice_public_id,amount_minor,
               status,reversed_at_utc
        FROM canonical_deposit_applications
        WHERE tenant_id=? AND application_public_id=?
        LIMIT 1
      `).bind(tenantId, applicationInput.applicationPublicId).first<DepositApplicationRow>();
      if (!application) throw new Error('Canonical settlement deposit application not found');
      if (
        application.deposit_public_id !== applicationInput.depositPublicId
        || application.invoice_public_id !== bill.invoicePublicId
        || application.amount_minor !== applicationInput.amountMinor
        || application.status !== 'active'
        || application.reversed_at_utc !== null
      ) throw new Error('Canonical settlement deposit application is not fully reversible');
      await assertMappedIdentity(db, {
        tenantId,
        entityType: 'deposit_application',
        canonicalPublicId: application.application_public_id,
        sourceType: DEPOSIT_SOURCE_TYPE,
      });
      preparedApplications.push({ input: applicationInput, row: application });

      const existing = deposits.get(application.deposit_public_id);
      if (existing) {
        existing.reverseMinor += application.amount_minor;
      } else {
        const deposit = await db.prepare(`
          SELECT deposit_public_id,amount_minor,applied_minor,refunded_minor,available_minor,status
          FROM canonical_deposits
          WHERE tenant_id=? AND deposit_public_id=?
          LIMIT 1
        `).bind(tenantId, application.deposit_public_id).first<DepositRow>();
        if (!deposit) throw new Error('Canonical settlement deposit source not found');
        if (deposit.status !== 'posted') throw new Error('Canonical settlement deposit source is not posted');
        deposits.set(application.deposit_public_id, { row: deposit, reverseMinor: application.amount_minor });
      }
    }

    let creditNote: CreditNoteRow | null = null;
    if (bill.creditNotePublicId) {
      creditNote = await db.prepare(`
        SELECT credit_note_public_id,invoice_public_id,total_minor,status,reversed_at_utc
        FROM canonical_credit_notes
        WHERE tenant_id=? AND credit_note_public_id=?
        LIMIT 1
      `).bind(tenantId, bill.creditNotePublicId).first<CreditNoteRow>();
      if (!creditNote) throw new Error('Canonical settlement credit note not found');
      if (
        creditNote.invoice_public_id !== bill.invoicePublicId
        || creditNote.total_minor !== bill.discountMinor
        || creditNote.status !== 'posted'
        || creditNote.reversed_at_utc !== null
      ) throw new Error('Canonical settlement credit note is not fully reversible');
      await assertMappedIdentity(db, {
        tenantId,
        entityType: 'credit_note',
        canonicalPublicId: creditNote.credit_note_public_id,
        sourceType: DISCOUNT_SOURCE_TYPE,
      });
    }

    preparedBills.push({
      input: bill,
      invoice,
      payment,
      depositApplications: preparedApplications,
      creditNote,
    });
  }

  for (const { row, reverseMinor } of deposits.values()) {
    if (
      reverseMinor <= 0
      || row.applied_minor < reverseMinor
      || row.available_minor + reverseMinor > row.amount_minor - row.refunded_minor
      || row.amount_minor !== row.applied_minor + row.refunded_minor + row.available_minor
    ) throw new Error('Canonical settlement deposit balance is stale or inconsistent');
  }

  const operationKey = `settlement-cancel:${settlementReceiptNumber}`;
  const statements: CanonicalPreparedStatement[] = [];
  const billResults: CancelSettlementBillResult[] = [];

  for (const prepared of preparedBills) {
    const bill = prepared.input;
    if (prepared.creditNote) {
      statements.push(
        db.prepare(`
          UPDATE canonical_credit_notes
          SET status='reversed',reversed_at_utc=?,updated_at_utc=?
          WHERE tenant_id=? AND credit_note_public_id=?
            AND invoice_public_id=? AND total_minor=?
            AND status='posted' AND reversed_at_utc IS NULL
        `).bind(
          cancelledAtUtc,
          cancelledAtUtc,
          tenantId,
          prepared.creditNote.credit_note_public_id,
          bill.invoicePublicId,
          bill.discountMinor,
        ),
        assertion(db, tenantId, operationKey, `credit:${bill.billId}`),
      );
    }

    for (const application of prepared.depositApplications) {
      statements.push(
        db.prepare(`
          UPDATE canonical_deposit_applications
          SET status='reversed',reversed_at_utc=?,updated_at_utc=?
          WHERE tenant_id=? AND application_public_id=?
            AND deposit_public_id=? AND invoice_public_id=? AND amount_minor=?
            AND status='active' AND reversed_at_utc IS NULL
        `).bind(
          cancelledAtUtc,
          cancelledAtUtc,
          tenantId,
          application.row.application_public_id,
          application.row.deposit_public_id,
          bill.invoicePublicId,
          application.row.amount_minor,
        ),
        assertion(db, tenantId, operationKey, `deposit-application:${application.row.application_public_id}`),
      );
    }

    if (prepared.payment) {
      const { receipt, tender, allocation } = prepared.payment;
      const paymentPaidBefore = bill.paidBeforeSettlementMinor + bill.cashMinor;
      const paymentDueBefore = bill.dueBeforeSettlementMinor - bill.cashMinor;
      const paymentNetDueBefore = bill.netDueBeforeSettlementMinor - bill.cashMinor;
      statements.push(
        db.prepare(`
          INSERT INTO canonical_payment_reversals (
            tenant_id,reversal_public_id,receipt_public_id,tender_public_id,
            allocation_public_id,invoice_public_id,amount_minor,reason_code,status,
            reversed_at_utc,business_date,allocation_reversed_before_minor,
            allocation_reversed_after_minor,tender_reversed_before_minor,
            tender_reversed_after_minor,receipt_refunded_before_minor,
            receipt_refunded_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
            invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
            invoice_net_due_after_minor,compensation_guard,balance_guard,source_evidence_sha256
          ) VALUES (?,?,?,?,?,?,?,?,'posted',?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?)
        `).bind(
          tenantId,
          prepared.payment.reversalPublicId,
          receipt.receipt_public_id,
          tender.tender_public_id,
          allocation.allocation_public_id,
          bill.invoicePublicId,
          bill.cashMinor,
          reasonCode,
          cancelledAtUtc,
          businessDate,
          0,
          bill.cashMinor,
          0,
          bill.cashMinor,
          0,
          bill.cashMinor,
          paymentPaidBefore,
          bill.paidBeforeSettlementMinor,
          paymentDueBefore,
          bill.dueBeforeSettlementMinor,
          paymentNetDueBefore,
          bill.netDueBeforeSettlementMinor,
          prepared.payment.evidenceSha256,
        ),
        db.prepare(`
          INSERT INTO canonical_refunds (
            tenant_id,refund_public_id,source_type,receipt_public_id,tender_public_id,
            allocation_public_id,payment_reversal_public_id,amount_minor,tender_type,
            method_code,status,refunded_at_utc,business_date,liability_guard,
            source_evidence_sha256
          ) VALUES (?,?,'payment',?,?,?,?,?,?,?,'posted',?,?,1,?)
        `).bind(
          tenantId,
          prepared.payment.refundPublicId,
          receipt.receipt_public_id,
          tender.tender_public_id,
          allocation.allocation_public_id,
          prepared.payment.reversalPublicId,
          bill.cashMinor,
          tender.tender_type,
          tender.method_code,
          cancelledAtUtc,
          businessDate,
          prepared.payment.evidenceSha256,
        ),
        db.prepare(`
          UPDATE canonical_payment_allocations
          SET reversed_minor=amount_minor,remaining_minor=0,status='reversed',
              reversed_at_utc=?,updated_at_utc=?
          WHERE tenant_id=? AND allocation_public_id=?
            AND receipt_public_id=? AND invoice_public_id=? AND amount_minor=?
            AND reversed_minor=0 AND remaining_minor=amount_minor AND status='active'
        `).bind(
          cancelledAtUtc,
          cancelledAtUtc,
          tenantId,
          allocation.allocation_public_id,
          receipt.receipt_public_id,
          bill.invoicePublicId,
          bill.cashMinor,
        ),
        assertion(db, tenantId, operationKey, `payment-allocation:${bill.billId}`),
        db.prepare(`
          UPDATE canonical_payment_tenders
          SET reversed_minor=amount_minor,remaining_minor=0,status='reversed',
              reversed_at_utc=?,updated_at_utc=?
          WHERE tenant_id=? AND tender_public_id=?
            AND receipt_public_id=? AND amount_minor=?
            AND reversed_minor=0 AND remaining_minor=amount_minor AND status='captured'
        `).bind(
          cancelledAtUtc,
          cancelledAtUtc,
          tenantId,
          tender.tender_public_id,
          receipt.receipt_public_id,
          bill.cashMinor,
        ),
        assertion(db, tenantId, operationKey, `payment-tender:${bill.billId}`),
        db.prepare(`
          UPDATE canonical_payment_receipts
          SET refunded_minor=total_minor,net_received_minor=0,status='reversed',
              reversed_at_utc=?,updated_at_utc=?
          WHERE tenant_id=? AND receipt_public_id=?
            AND total_minor=? AND allocated_total_minor=?
            AND refunded_minor=0 AND net_received_minor=total_minor AND status='posted'
        `).bind(
          cancelledAtUtc,
          cancelledAtUtc,
          tenantId,
          receipt.receipt_public_id,
          bill.cashMinor,
          bill.cashMinor,
        ),
        assertion(db, tenantId, operationKey, `payment-receipt:${bill.billId}`),
        mappingStatement(db, {
          tenantId,
          entityType: 'payment_reversal',
          canonicalPublicId: prepared.payment.reversalPublicId,
          sourcePublicId: `${cancellationSourcePublicId}:payment:${bill.billId}`,
          evidenceSha256: prepared.payment.evidenceSha256,
        }),
        mappingStatement(db, {
          tenantId,
          entityType: 'refund',
          canonicalPublicId: prepared.payment.refundPublicId,
          sourcePublicId: `${cancellationSourcePublicId}:payment:${bill.billId}`,
          evidenceSha256: prepared.payment.evidenceSha256,
        }),
      );
      if (prepared.payment.cashCustodyEventPublicId) {
        statements.push(db.prepare(`
          INSERT INTO canonical_outbox_events (
            tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
            event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
          ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
        `).bind(
          tenantId,
          prepared.payment.cashCustodyEventPublicId,
          'canonical_cash_custody',
          prepared.payment.refundPublicId,
          'canonical.cash_custody.refund_recorded',
          stableCanonicalJson({
            amountMinor: bill.cashMinor,
            refundPublicId: prepared.payment.refundPublicId,
            settlementPublicId,
          }),
          cancelledAtUtc,
          businessDate,
          `${commandIdempotencyKey}:cash-custody:${bill.billId}`,
        ));
      }
    }

    statements.push(
      db.prepare(`
        UPDATE canonical_invoices
        SET paid_minor=?,due_minor=?,credited_minor=?,net_due_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND invoice_public_id=? AND total_minor=? AND status='posted'
          AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
      `).bind(
        bill.paidBeforeSettlementMinor,
        bill.dueBeforeSettlementMinor,
        bill.creditedBeforeSettlementMinor,
        bill.netDueBeforeSettlementMinor,
        cancelledAtUtc,
        tenantId,
        bill.invoicePublicId,
        bill.totalMinor,
        bill.paidAfterSettlementMinor,
        bill.dueAfterSettlementMinor,
        bill.creditedAfterSettlementMinor,
        bill.netDueAfterSettlementMinor,
      ),
      assertion(db, tenantId, operationKey, `invoice:${bill.billId}`),
    );

    billResults.push({
      billId: bill.billId,
      invoicePublicId: bill.invoicePublicId,
      paymentReversalPublicId: prepared.payment?.reversalPublicId ?? null,
      refundPublicId: prepared.payment?.refundPublicId ?? null,
      depositApplicationCount: prepared.depositApplications.length,
      creditNotePublicId: prepared.creditNote?.credit_note_public_id ?? null,
    });
  }

  for (const [depositPublicId, prepared] of [...deposits.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const appliedAfter = prepared.row.applied_minor - prepared.reverseMinor;
    const availableAfter = prepared.row.available_minor + prepared.reverseMinor;
    statements.push(
      db.prepare(`
        UPDATE canonical_deposits
        SET applied_minor=?,available_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND deposit_public_id=? AND status='posted'
          AND amount_minor=? AND applied_minor=? AND refunded_minor=? AND available_minor=?
      `).bind(
        appliedAfter,
        availableAfter,
        cancelledAtUtc,
        tenantId,
        depositPublicId,
        prepared.row.amount_minor,
        prepared.row.applied_minor,
        prepared.row.refunded_minor,
        prepared.row.available_minor,
      ),
      assertion(db, tenantId, operationKey, `deposit:${depositPublicId}`),
    );
  }

  const cashMinor = input.bills.reduce((sum, bill) => sum + bill.cashMinor, 0);
  const depositMinor = input.bills.reduce((sum, bill) => sum + bill.depositMinor, 0);
  const discountMinor = input.bills.reduce((sum, bill) => sum + bill.discountMinor, 0);
  const cancellationPublicId = await createDeterministicSourceId(
    'stlcan',
    tenantId,
    CANCELLATION_SOURCE_TYPE,
    cancellationSourcePublicId,
  );
  const cancellationEvidence = await createSourceEvidenceSha256({
    sourceType: CANCELLATION_SOURCE_TYPE,
    sourcePublicId: cancellationSourcePublicId,
    settlementPublicId,
    settlementReceiptNumber,
    reasonCode,
    cancelledAtUtc,
    businessDate,
    cashMinor,
    depositMinor,
    discountMinor,
    bills: billResults,
  });
  statements.push(
    mappingStatement(db, {
      tenantId,
      entityType: 'settlement_cancellation',
      canonicalPublicId: cancellationPublicId,
      sourcePublicId: cancellationSourcePublicId,
      evidenceSha256: cancellationEvidence,
    }),
    prepareClearFinancialBatchAssertions(db, tenantId, operationKey),
  );

  const result: CancelSettlementResult = {
    settlementPublicId,
    settlementReceiptNumber,
    cancellationPublicId,
    cashMinor,
    depositMinor,
    discountMinor,
    bills: billResults,
  };

  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.settlement.cancel',
    idempotencyKey: commandIdempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: await createDeterministicSourceId(
        'outevt',
        tenantId,
        CANCELLATION_SOURCE_TYPE,
        cancellationSourcePublicId,
      ),
      aggregateType: 'settlement',
      aggregatePublicId: settlementPublicId,
      eventType: 'canonical.settlement.cancelled',
      payload: {
        settlementPublicId,
        settlementReceiptNumber,
        cancellationPublicId,
        cashMinor,
        depositMinor,
        discountMinor,
        billCount: billResults.length,
        reasonCode,
      },
      occurredAtUtc: cancelledAtUtc,
      businessDate,
    },
  });
}
