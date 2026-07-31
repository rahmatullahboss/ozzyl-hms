import type { DecimalAmount } from './money';
import { toMinorUnits } from './money';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from './source-mapping';
import { deriveBusinessDate, toUtcIso } from './time';
import type { IssueInvoiceInput, InvoiceLineType } from './commands/issue-invoice';
import type {
  CollectPaymentInput,
  PaymentTenderStatus,
  PaymentTenderType,
} from './commands/collect-payment';
import type {
  AdjustmentTenderType,
  ApplyDepositInput,
  RecordDepositInput,
  RefundDepositInput,
} from './commands/apply-deposit';
import type { IssueCreditNoteInput } from './commands/issue-credit-note';
import type { ReversePaymentInput } from './commands/reverse-payment';

const CURRENCY_CODE = 'BDT';
const BUSINESS_TIME_ZONE = 'Asia/Dhaka';

export interface LiveLegacyInvoiceLine {
  sourceLineId: string;
  serviceEventPublicId?: string | null;
  lineType?: InvoiceLineType;
  adjustmentCode?: string | null;
  quantity: number;
  unitAmount: DecimalAmount;
}

export interface LiveLegacyInvoice {
  tenantId: string;
  patientId: number;
  invoiceNo: string;
  currencyCode: string;
  issuedAtUtc: string;
  items: readonly LiveLegacyInvoiceLine[];
  discount?: DecimalAmount;
  taxTotal?: DecimalAmount;
}

export interface LiveLegacyPaymentAllocation {
  sourceAllocationId: string;
  invoicePublicId: string;
  invoiceLinePublicId?: string | null;
  amount: DecimalAmount;
}

export interface LiveLegacyPayment {
  tenantId: string;
  patientId: number;
  paymentNo: string;
  receiptNo: string;
  currencyCode: string;
  receivedAtUtc: string;
  amount: DecimalAmount;
  tenderType: PaymentTenderType;
  methodCode: string;
  status: PaymentTenderStatus;
  allocations: readonly LiveLegacyPaymentAllocation[];
  collectorId?: number | null;
  counterId?: number | null;
  counterSessionId?: number | null;
  externalTransactionId?: string | null;
}

export interface LiveLegacyDeposit {
  tenantId: string;
  depositNo: string;
  receiptPublicId?: string;
  patientId?: number;
  amount?: DecimalAmount;
  tenderType?: AdjustmentTenderType;
  methodCode?: string;
  collectedAtUtc?: string;
}

export interface LiveLegacyDepositApplication {
  tenantId: string;
  applicationNo: string;
  depositPublicId: string;
  invoicePublicId: string;
  invoiceLinePublicId?: string | null;
  amount: DecimalAmount;
  appliedAtUtc: string;
}

export interface LiveLegacyDepositRefund {
  tenantId: string;
  refundNo: string;
  depositPublicId: string;
  amount: DecimalAmount;
  tenderType: AdjustmentTenderType;
  methodCode: string;
  refundedAtUtc: string;
}

export interface LiveLegacyCreditLine {
  sourceLineId: string;
  invoiceLinePublicId?: string | null;
  amount: DecimalAmount;
  reasonCode: string;
}

export interface LiveLegacyCredit {
  tenantId: string;
  creditNo: string;
  invoicePublicId: string;
  reasonCode: string;
  issuedAtUtc: string;
  lines: readonly LiveLegacyCreditLine[];
}

export interface LiveLegacyPaymentReversal {
  tenantId: string;
  reversalNo: string;
  refundNo: string;
  receiptPublicId: string;
  tenderPublicId: string;
  allocationPublicId: string;
  amount: DecimalAmount;
  reasonCode: string;
  reversedAtUtc: string;
  tenderType: AdjustmentTenderType;
}

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  return value;
}

function exactTenantId(tenantId: string): string {
  const normalized = tenantId.trim();
  const numericTenantId = Number(normalized);
  if (
    normalized !== tenantId
    || !/^[1-9]\d*$/.test(normalized)
    || !Number.isSafeInteger(numericTenantId)
    || numericTenantId <= 0
  ) {
    throw new RangeError('tenantId must be a positive decimal safe integer without surrounding whitespace');
  }
  return normalized;
}

function bdt(currencyCode: string): string {
  if (currencyCode !== CURRENCY_CODE) throw new RangeError('Live canonical financial projection requires BDT');
  return currencyCode;
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function positiveQuantity(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('quantity must be a positive safe integer');
  return value;
}

async function identity(
  tenantId: string,
  sourceType: string,
  sourcePublicId: string,
  evidence: unknown,
): Promise<{
  sourceType: string;
  sourcePublicId: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}> {
  exact(sourcePublicId, 'sourcePublicId');
  return {
    sourceType,
    sourcePublicId,
    sourceEvidenceSha256: await createSourceEvidenceSha256(evidence),
    idempotencyKey: `${sourceType}:${sourcePublicId}`,
    outboxEventPublicId: await createDeterministicSourceId('outevt', tenantId, sourceType, sourcePublicId),
  };
}

export async function buildLiveInvoiceProjection(source: LiveLegacyInvoice): Promise<IssueInvoiceInput> {
  const tenantId = exactTenantId(source.tenantId);
  const invoiceNo = exact(source.invoiceNo, 'invoiceNo');
  const issuedAtUtc = toUtcIso(source.issuedAtUtc);
  if (source.items.length === 0) throw new RangeError('Live invoice must contain items');

  const lines = await Promise.all(source.items.map(async (item) => {
    const sourceLineId = exact(item.sourceLineId, 'sourceLineId');
    const lineType = item.lineType ?? 'service';
    const evidence = await createSourceEvidenceSha256({
      sourceType: 'legacy_live_bill_line', invoiceNo, sourceLineId,
      lineType, serviceEventPublicId: item.serviceEventPublicId ?? null,
      adjustmentCode: item.adjustmentCode ?? null, quantity: item.quantity, unitAmount: String(item.unitAmount),
    });
    return {
      linePublicId: await createDeterministicSourceId('invline', tenantId, 'legacy_live_bill_line', `${invoiceNo}:${sourceLineId}`),
      lineType,
      serviceEventPublicId: item.serviceEventPublicId ?? null,
      adjustmentCode: item.adjustmentCode ?? null,
      quantity: positiveQuantity(item.quantity),
      unitAmountMinor: Number(toMinorUnits(item.unitAmount)),
      sourceEvidenceSha256: evidence,
    };
  }));

  if (source.discount != null && Number(toMinorUnits(source.discount)) !== 0) {
    const amountMinor = Number(toMinorUnits(source.discount));
    lines.push({
      linePublicId: await createDeterministicSourceId('invline', tenantId, 'legacy_live_bill_line', `${invoiceNo}:discount`),
      lineType: 'discount', serviceEventPublicId: null, adjustmentCode: 'LEGACY_DISCOUNT', quantity: 1,
      unitAmountMinor: -amountMinor,
      sourceEvidenceSha256: await createSourceEvidenceSha256({ invoiceNo, kind: 'discount', amountMinor }),
    });
  }
  if (source.taxTotal != null && Number(toMinorUnits(source.taxTotal)) !== 0) {
    const amountMinor = Number(toMinorUnits(source.taxTotal));
    lines.push({
      linePublicId: await createDeterministicSourceId('invline', tenantId, 'legacy_live_bill_line', `${invoiceNo}:tax`),
      lineType: 'tax', serviceEventPublicId: null, adjustmentCode: 'LEGACY_TAX', quantity: 1,
      unitAmountMinor: amountMinor,
      sourceEvidenceSha256: await createSourceEvidenceSha256({ invoiceNo, kind: 'tax', amountMinor }),
    });
  }

  const evidence = { invoiceNo, patientId: positiveId(source.patientId, 'patientId'), currencyCode: bdt(source.currencyCode), issuedAtUtc, lines };
  const sourceIdentity = await identity(tenantId, 'legacy_live_bill', invoiceNo, evidence);
  return {
    tenantId,
    invoicePublicId: await createDeterministicSourceId('inv', tenantId, 'legacy_live_bill', invoiceNo),
    invoiceNumber: invoiceNo,
    legacyPatientId: source.patientId,
    currencyCode: source.currencyCode,
    issuedAtUtc,
    lines,
    ...sourceIdentity,
    sourceTable: 'bills',
    businessDate: deriveBusinessDate(issuedAtUtc, BUSINESS_TIME_ZONE),
  };
}

export async function buildLivePaymentProjection(source: LiveLegacyPayment): Promise<CollectPaymentInput> {
  const tenantId = exactTenantId(source.tenantId);
  const paymentNo = exact(source.paymentNo, 'paymentNo');
  const receivedAtUtc = toUtcIso(source.receivedAtUtc);
  const totalMinor = Number(toMinorUnits(source.amount));
  if (totalMinor <= 0) throw new RangeError('Payment amount must be positive minor units');
  const allocations = await Promise.all(source.allocations.map(async (allocation) => ({
    allocationPublicId: await createDeterministicSourceId('payalloc', tenantId, 'legacy_live_payment', `${paymentNo}:${exact(allocation.sourceAllocationId, 'sourceAllocationId')}`),
    invoicePublicId: exact(allocation.invoicePublicId, 'invoicePublicId'),
    invoiceLinePublicId: allocation.invoiceLinePublicId ?? null,
    amountMinor: Number(toMinorUnits(allocation.amount)),
    sourceEvidenceSha256: await createSourceEvidenceSha256({ paymentNo, allocation }),
  })));
  const allocatedMinor = allocations.reduce((sum, row) => sum + row.amountMinor, 0);
  if (allocatedMinor > totalMinor) throw new RangeError('Payment totals do not reconcile');
  const sourceIdentity = await identity(tenantId, 'legacy_live_payment', paymentNo, {
    paymentNo, receiptNo: source.receiptNo, patientId: source.patientId,
    amount: String(source.amount), tenderType: source.tenderType, methodCode: source.methodCode,
    status: source.status, allocations,
  });
  const tenderPublicId = await createDeterministicSourceId('paytndr', tenantId, 'legacy_live_payment', paymentNo);
  return {
    tenantId,
    receiptPublicId: await createDeterministicSourceId('payrcpt', tenantId, 'legacy_live_payment', paymentNo),
    receiptNumber: exact(source.receiptNo, 'receiptNo'),
    legacyPatientId: positiveId(source.patientId, 'patientId'),
    currencyCode: bdt(source.currencyCode),
    receivedAtUtc,
    businessDate: deriveBusinessDate(receivedAtUtc, BUSINESS_TIME_ZONE),
    legacyCollectorId: source.collectorId ?? null,
    legacyCounterId: source.counterId ?? null,
    legacyCounterSessionId: source.counterSessionId ?? null,
    externalTransactionId: source.externalTransactionId ?? null,
    tenders: [{
      tenderPublicId,
      tenderType: source.tenderType,
      methodCode: exact(source.methodCode, 'methodCode'),
      amountMinor: totalMinor,
      status: source.status,
      externalTransactionId: source.externalTransactionId ?? null,
      sourceEvidenceSha256: await createSourceEvidenceSha256({ paymentNo, tenderPublicId, totalMinor, status: source.status }),
    }],
    allocations,
    unallocatedMinor: totalMinor - allocatedMinor,
    ...sourceIdentity,
    sourceTable: 'payments',
    cashCustodyEventPublicId: source.tenderType === 'cash' && source.status === 'captured'
      ? await createDeterministicSourceId('outevt', tenantId, 'legacy_live_payment_cash', paymentNo)
      : null,
  };
}

export async function buildLiveDepositProjection(source: LiveLegacyDeposit): Promise<RecordDepositInput> {
  const tenantId = exactTenantId(source.tenantId);
  const depositNo = exact(source.depositNo, 'depositNo');
  const receiptPublicId = source.receiptPublicId
    ? exact(source.receiptPublicId, 'receiptPublicId')
    : await createDeterministicSourceId('payrcpt', tenantId, 'legacy_live_deposit', depositNo);
  const hasReceiptAuthority = source.patientId != null
    || source.amount != null
    || source.tenderType != null
    || source.methodCode != null
    || source.collectedAtUtc != null;
  let receiptAuthority: RecordDepositInput['receiptAuthority'];
  if (hasReceiptAuthority) {
    if (
      source.patientId == null
      || source.amount == null
      || source.tenderType == null
      || source.methodCode == null
      || source.collectedAtUtc == null
    ) {
      throw new TypeError('Live deposit receipt authority must be complete');
    }
    const amountMinor = Number(toMinorUnits(source.amount));
    const receivedAtUtc = toUtcIso(source.collectedAtUtc);
    receiptAuthority = {
      legacyPatientId: positiveId(source.patientId, 'patientId'),
      currencyCode: CURRENCY_CODE,
      amountMinor,
      tenderPublicId: await createDeterministicSourceId('paytndr', tenantId, 'legacy_live_deposit', depositNo),
      tenderType: source.tenderType,
      methodCode: exact(source.methodCode, 'methodCode'),
      receivedAtUtc,
      businessDate: deriveBusinessDate(receivedAtUtc, BUSINESS_TIME_ZONE),
      sourceEvidenceSha256: await createSourceEvidenceSha256({ depositNo, patientId: source.patientId, amountMinor, tenderType: source.tenderType }),
    };
  }
  return {
    tenantId,
    depositPublicId: await createDeterministicSourceId('dep', tenantId, 'legacy_live_deposit', depositNo),
    depositNumber: depositNo,
    receiptPublicId,
    receiptAuthority,
    ...await identity(tenantId, 'legacy_live_deposit', depositNo, source),
    sourceTable: 'billing_deposits',
  };
}

export async function buildLiveDepositApplicationProjection(source: LiveLegacyDepositApplication): Promise<ApplyDepositInput> {
  const tenantId = exactTenantId(source.tenantId);
  const applicationNo = exact(source.applicationNo, 'applicationNo');
  const appliedAtUtc = toUtcIso(source.appliedAtUtc);
  return {
    tenantId,
    applicationPublicId: await createDeterministicSourceId('depapp', tenantId, 'legacy_live_deposit', applicationNo),
    depositPublicId: exact(source.depositPublicId, 'depositPublicId'),
    invoicePublicId: exact(source.invoicePublicId, 'invoicePublicId'),
    invoiceLinePublicId: source.invoiceLinePublicId ?? null,
    amountMinor: Number(toMinorUnits(source.amount)),
    appliedAtUtc,
    businessDate: deriveBusinessDate(appliedAtUtc, BUSINESS_TIME_ZONE),
    ...await identity(tenantId, 'legacy_live_deposit', applicationNo, source),
    sourceTable: 'billing_deposit_adjustments',
  };
}

export async function buildLiveDepositRefundProjection(source: LiveLegacyDepositRefund): Promise<RefundDepositInput> {
  const tenantId = exactTenantId(source.tenantId);
  const refundNo = exact(source.refundNo, 'refundNo');
  const refundedAtUtc = toUtcIso(source.refundedAtUtc);
  return {
    tenantId,
    refundPublicId: await createDeterministicSourceId('refund', tenantId, 'legacy_live_refund', refundNo),
    depositPublicId: exact(source.depositPublicId, 'depositPublicId'),
    amountMinor: Number(toMinorUnits(source.amount)),
    tenderType: source.tenderType,
    methodCode: exact(source.methodCode, 'methodCode'),
    refundedAtUtc,
    businessDate: deriveBusinessDate(refundedAtUtc, BUSINESS_TIME_ZONE),
    ...await identity(tenantId, 'legacy_live_refund', refundNo, source),
    sourceTable: 'billing_deposits',
    cashCustodyEventPublicId: source.tenderType === 'cash'
      ? await createDeterministicSourceId('outevt', tenantId, 'legacy_live_refund_cash', refundNo)
      : null,
  };
}

export async function buildLiveCreditProjection(source: LiveLegacyCredit): Promise<IssueCreditNoteInput> {
  const tenantId = exactTenantId(source.tenantId);
  const creditNo = exact(source.creditNo, 'creditNo');
  const issuedAtUtc = toUtcIso(source.issuedAtUtc);
  const lines = await Promise.all(source.lines.map(async (line) => ({
    creditLinePublicId: await createDeterministicSourceId('crline', tenantId, 'legacy_live_credit_note', `${creditNo}:${exact(line.sourceLineId, 'sourceLineId')}`),
    invoiceLinePublicId: line.invoiceLinePublicId ?? null,
    amountMinor: Number(toMinorUnits(line.amount)),
    reasonCode: exact(line.reasonCode, 'line.reasonCode'),
    sourceEvidenceSha256: await createSourceEvidenceSha256({ creditNo, line }),
  })));
  return {
    tenantId,
    creditNotePublicId: await createDeterministicSourceId('crnote', tenantId, 'legacy_live_credit_note', creditNo),
    creditNoteNumber: creditNo,
    invoicePublicId: exact(source.invoicePublicId, 'invoicePublicId'),
    reasonCode: exact(source.reasonCode, 'reasonCode'),
    issuedAtUtc,
    businessDate: deriveBusinessDate(issuedAtUtc, BUSINESS_TIME_ZONE),
    lines,
    ...await identity(tenantId, 'legacy_live_credit_note', creditNo, source),
    sourceTable: 'billing_credit_notes',
  };
}

export async function buildLivePaymentReversalProjection(source: LiveLegacyPaymentReversal): Promise<ReversePaymentInput> {
  const tenantId = exactTenantId(source.tenantId);
  const reversalNo = exact(source.reversalNo, 'reversalNo');
  const reversedAtUtc = toUtcIso(source.reversedAtUtc);
  return {
    tenantId,
    reversalPublicId: await createDeterministicSourceId('payrev', tenantId, 'legacy_live_refund', reversalNo),
    refundPublicId: await createDeterministicSourceId('refund', tenantId, 'legacy_live_refund', exact(source.refundNo, 'refundNo')),
    receiptPublicId: exact(source.receiptPublicId, 'receiptPublicId'),
    tenderPublicId: exact(source.tenderPublicId, 'tenderPublicId'),
    allocationPublicId: exact(source.allocationPublicId, 'allocationPublicId'),
    amountMinor: Number(toMinorUnits(source.amount)),
    reasonCode: exact(source.reasonCode, 'reasonCode'),
    reversedAtUtc,
    businessDate: deriveBusinessDate(reversedAtUtc, BUSINESS_TIME_ZONE),
    ...await identity(tenantId, 'legacy_live_refund', reversalNo, source),
    sourceTable: 'payments',
    cashCustodyEventPublicId: source.tenderType === 'cash'
      ? await createDeterministicSourceId('outevt', tenantId, 'legacy_live_refund_cash', reversalNo)
      : null,
  };
}
