import type { IssueInvoiceInput } from './commands/issue-invoice';
import type { IssueInvoiceWithSettlementInput } from './commands/issue-invoice-settlement';
import type { PaymentTenderType } from './commands/collect-payment';
import { buildLegacyLiveInvoiceSourceLineId } from './live-invoice-line-identity';
import { toMinorUnits } from './money';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';
import { deriveBusinessDate, toUtcIso } from './time';

const BUSINESS_TIME_ZONE = 'Asia/Dhaka';

export interface ProvisionalBillingProjectionItem {
  provisionalItemId: number;
  patientId: number;
  visitId?: number | null;
  admissionId?: number | null;
  category: string;
  description: string;
  department?: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  totalAmount: number;
  doctorId?: number | null;
  doctorName?: string | null;
  referenceId?: number | null;
  isManual?: boolean;
}

export interface ProvisionalInvoiceProjectionInput {
  tenantId: string;
  patientId: number;
  invoiceNo: string;
  issuedAtUtc: string;
  businessDate: string;
  globalDiscount: number;
  items: readonly ProvisionalBillingProjectionItem[];
}

export interface ProvisionalSettlementProjectionInput extends ProvisionalInvoiceProjectionInput {
  paymentAmount: number;
  depositAmount: number;
  paymentMethod: string;
  receiptNo?: string | null;
  depositAdjustmentNo?: string | null;
  externalTransactionId?: string | null;
  collectorId?: number | null;
  counterId?: number | null;
  counterSessionId?: number | null;
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

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function optionalPositiveInteger(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  return positiveInteger(value, label);
}

function nonNegativeMoneyMinor(value: number, label: string): number {
  const minor = Number(toMinorUnits(value));
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new RangeError(`${label} must be non-negative money`);
  }
  return minor;
}

function canonicalTenantId(value: string): string {
  const normalized = exact(value, 'tenantId');
  const numeric = Number(normalized);
  if (!/^[1-9]\d*$/.test(normalized) || !Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new RangeError('tenantId must be a positive decimal safe integer');
  }
  return normalized;
}

function adjustmentCode(category: string): string {
  const suffix = exact(category, 'item.category')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `PROVISIONAL_${suffix || 'OTHER'}`;
}

function normalizeMethodCode(value: string): string {
  const normalized = exact(value, 'paymentMethod')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'other';
}

function tenderTypeForMethod(methodCode: string): PaymentTenderType {
  if (methodCode === 'cash' || methodCode === 'cash_payment') return 'cash';
  if (methodCode.includes('card') || methodCode.includes('visa') || methodCode.includes('master')) return 'card';
  if (
    methodCode.includes('bkash')
    || methodCode.includes('nagad')
    || methodCode.includes('rocket')
    || methodCode.includes('mobile')
    || methodCode.includes('wallet')
  ) return 'mobile_wallet';
  if (
    methodCode.includes('bank')
    || methodCode.includes('cheque')
    || methodCode.includes('check')
  ) return 'bank_transfer';
  if (methodCode.includes('gateway') || methodCode.includes('online')) return 'gateway';
  return 'other';
}

function validateBusinessDate(issuedAtUtc: string, businessDate: string): string {
  const normalized = exact(businessDate, 'businessDate');
  if (deriveBusinessDate(issuedAtUtc, BUSINESS_TIME_ZONE) !== normalized) {
    throw new RangeError('businessDate must match provisional invoice issue time in Asia/Dhaka');
  }
  return normalized;
}

export async function buildProvisionalInvoiceProjection(
  input: ProvisionalInvoiceProjectionInput,
): Promise<IssueInvoiceInput> {
  const tenantId = canonicalTenantId(input.tenantId);
  const patientId = positiveInteger(input.patientId, 'patientId');
  const invoiceNo = exact(input.invoiceNo, 'invoiceNo');
  const issuedAtUtc = toUtcIso(input.issuedAtUtc);
  const businessDate = validateBusinessDate(issuedAtUtc, input.businessDate);
  const globalDiscountMinor = nonNegativeMoneyMinor(input.globalDiscount, 'globalDiscount');
  if (input.items.length === 0) throw new RangeError('Provisional invoice must contain items');

  let grossTotalMinor = 0;
  let itemDiscountTotalMinor = 0;
  let itemNetTotalMinor = 0;
  const seenItemIds = new Set<number>();
  const lines: IssueInvoiceInput['lines'][number][] = [];

  for (const [index, item] of input.items.entries()) {
    const provisionalItemId = positiveInteger(item.provisionalItemId, 'item.provisionalItemId');
    if (seenItemIds.has(provisionalItemId)) throw new RangeError('duplicate provisional item');
    seenItemIds.add(provisionalItemId);
    if (positiveInteger(item.patientId, 'item.patientId') !== patientId) {
      throw new Error('Provisional item patient mismatch');
    }
    const quantity = positiveInteger(item.quantity, 'item.quantity');
    const unitPriceMinor = nonNegativeMoneyMinor(item.unitPrice, 'item.unitPrice');
    const itemDiscountMinor = nonNegativeMoneyMinor(item.discountAmount, 'item.discountAmount');
    const netMinor = nonNegativeMoneyMinor(item.totalAmount, 'item.totalAmount');
    const grossBig = BigInt(quantity) * BigInt(unitPriceMinor);
    if (grossBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('provisional item gross total exceeds safe integer range');
    }
    const grossMinor = Number(grossBig);
    if (grossMinor - itemDiscountMinor !== netMinor) {
      throw new RangeError('Provisional item gross, discount, and net total do not reconcile');
    }
    grossTotalMinor += grossMinor;
    itemDiscountTotalMinor += itemDiscountMinor;
    itemNetTotalMinor += netMinor;
    if (![grossTotalMinor, itemDiscountTotalMinor, itemNetTotalMinor].every(Number.isSafeInteger)) {
      throw new RangeError('provisional invoice totals exceed safe integer range');
    }

    const category = exact(item.category, 'item.category');
    const description = exact(item.description, 'item.description');
    const referenceId = item.referenceId ?? item.doctorId ?? null;
    const sourceLineId = buildLegacyLiveInvoiceSourceLineId({
      lineNumber: index + 1,
      itemCategory: category,
      referenceId,
    });
    lines.push({
      linePublicId: await createDeterministicSourceId(
        'invline',
        tenantId,
        'legacy_live_bill_line',
        `${invoiceNo}:${sourceLineId}`,
      ),
      lineType: 'other_adjustment',
      serviceEventPublicId: null,
      adjustmentCode: adjustmentCode(category),
      quantity: 1,
      unitAmountMinor: grossMinor,
      sourceEvidenceSha256: await createSourceEvidenceSha256({
        sourceType: 'legacy_live_bill_line',
        invoiceNo,
        sourceLineId,
        provisionalItemId,
        patientId,
        visitId: item.visitId ?? null,
        admissionId: item.admissionId ?? null,
        category,
        description,
        department: item.department ?? null,
        quantity,
        unitPriceMinor,
        itemDiscountMinor,
        netMinor,
        doctorId: item.doctorId ?? null,
        doctorName: item.doctorName ?? null,
        referenceId,
        isManual: item.isManual === true,
      }),
    });
  }

  if (grossTotalMinor - itemDiscountTotalMinor !== itemNetTotalMinor) {
    throw new RangeError('Provisional invoice gross, discount, and net total do not reconcile');
  }
  const finalNetMinor = itemNetTotalMinor - globalDiscountMinor;
  if (!Number.isSafeInteger(finalNetMinor) || finalNetMinor <= 0) {
    throw new RangeError('Provisional invoice net total must be positive');
  }

  if (itemDiscountTotalMinor > 0) {
    lines.push({
      linePublicId: await createDeterministicSourceId(
        'invline', tenantId, 'legacy_live_bill_line', `${invoiceNo}:item-discount`,
      ),
      lineType: 'discount',
      serviceEventPublicId: null,
      adjustmentCode: 'PROVISIONAL_ITEM_DISCOUNT',
      quantity: 1,
      unitAmountMinor: -itemDiscountTotalMinor,
      sourceEvidenceSha256: await createSourceEvidenceSha256({
        sourceType: 'legacy_live_bill_line',
        invoiceNo,
        kind: 'provisional_item_discount',
        amountMinor: itemDiscountTotalMinor,
        provisionalItemIds: input.items.map((item) => item.provisionalItemId),
      }),
    });
  }

  if (globalDiscountMinor > 0) {
    lines.push({
      linePublicId: await createDeterministicSourceId(
        'invline', tenantId, 'legacy_live_bill_line', `${invoiceNo}:global-discount`,
      ),
      lineType: 'discount',
      serviceEventPublicId: null,
      adjustmentCode: 'PROVISIONAL_GLOBAL_DISCOUNT',
      quantity: 1,
      unitAmountMinor: -globalDiscountMinor,
      sourceEvidenceSha256: await createSourceEvidenceSha256({
        sourceType: 'legacy_live_bill_line',
        invoiceNo,
        kind: 'provisional_global_discount',
        amountMinor: globalDiscountMinor,
      }),
    });
  }

  const sourceType = 'legacy_live_bill';
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType,
    sourcePublicId: invoiceNo,
    patientId,
    invoiceNo,
    issuedAtUtc,
    businessDate,
    grossTotalMinor,
    itemDiscountTotalMinor,
    globalDiscountMinor,
    finalNetMinor,
    items: input.items,
    lines,
  });

  return {
    tenantId,
    invoicePublicId: await createDeterministicSourceId('inv', tenantId, sourceType, invoiceNo),
    invoiceNumber: invoiceNo,
    legacyPatientId: patientId,
    currencyCode: 'BDT',
    issuedAtUtc,
    businessDate,
    lines,
    sourceType,
    sourcePublicId: invoiceNo,
    sourceTable: 'bills',
    sourceEvidenceSha256,
    idempotencyKey: `${sourceType}:${invoiceNo}`,
    outboxEventPublicId: await createDeterministicSourceId('outevt', tenantId, sourceType, invoiceNo),
  };
}

export async function buildProvisionalSettlementProjection(
  input: ProvisionalSettlementProjectionInput,
): Promise<IssueInvoiceWithSettlementInput> {
  const invoice = await buildProvisionalInvoiceProjection(input);
  const paymentMinor = nonNegativeMoneyMinor(input.paymentAmount, 'paymentAmount');
  const depositMinor = nonNegativeMoneyMinor(input.depositAmount, 'depositAmount');
  const receiptNo = optionalExact(input.receiptNo, 'receiptNo');
  const depositAdjustmentNo = optionalExact(input.depositAdjustmentNo, 'depositAdjustmentNo');
  const collectorId = optionalPositiveInteger(input.collectorId, 'collectorId');
  const counterId = optionalPositiveInteger(input.counterId, 'counterId');
  const counterSessionId = optionalPositiveInteger(input.counterSessionId, 'counterSessionId');

  let payment: IssueInvoiceWithSettlementInput['payment'] = null;
  if (paymentMinor > 0) {
    if (!receiptNo) throw new TypeError('receiptNo is required when payment exists');
    const methodCode = normalizeMethodCode(input.paymentMethod);
    const tenderType = tenderTypeForMethod(methodCode);
    const externalTransactionId = optionalExact(input.externalTransactionId, 'externalTransactionId');
    if (tenderType !== 'cash' && !externalTransactionId) {
      throw new RangeError('Non-cash provisional payment requires transaction/reference authority');
    }
    const sourceType = 'legacy_live_payment';
    const paymentEvidence = await createSourceEvidenceSha256({
      sourceType,
      sourcePublicId: receiptNo,
      invoicePublicId: invoice.invoicePublicId,
      invoiceNo: invoice.invoiceNumber,
      patientId: invoice.legacyPatientId,
      paymentMinor,
      tenderType,
      methodCode,
      externalTransactionId,
      collectorId,
      counterId,
      counterSessionId,
    });
    payment = {
      receiptPublicId: await createDeterministicSourceId('payrcpt', invoice.tenantId, sourceType, receiptNo),
      receiptNumber: receiptNo,
      tenderPublicId: await createDeterministicSourceId('paytndr', invoice.tenantId, sourceType, receiptNo),
      allocationPublicId: await createDeterministicSourceId(
        'payalloc', invoice.tenantId, sourceType, `${receiptNo}:invoice:${invoice.invoiceNumber}`,
      ),
      tenderType,
      methodCode,
      amountMinor: paymentMinor,
      externalTransactionId,
      legacyCollectorId: collectorId,
      legacyCounterId: counterId,
      legacyCounterSessionId: counterSessionId,
      receivedAtUtc: invoice.issuedAtUtc,
      sourceType,
      sourcePublicId: receiptNo,
      sourceTable: 'payments',
      sourceEvidenceSha256: paymentEvidence,
      paymentOutboxEventPublicId: await createDeterministicSourceId(
        'outevt', invoice.tenantId, sourceType, receiptNo,
      ),
      cashCustodyEventPublicId: tenderType === 'cash'
        ? await createDeterministicSourceId(
            'outevt', invoice.tenantId, 'legacy_live_payment_cash', receiptNo,
          )
        : null,
    };
  }

  let deposit: IssueInvoiceWithSettlementInput['deposit'] = null;
  if (depositMinor > 0) {
    if (!depositAdjustmentNo) {
      throw new TypeError('depositAdjustmentNo is required when deposit settlement exists');
    }
    deposit = {
      adjustmentNumber: depositAdjustmentNo,
      amountMinor: depositMinor,
      appliedAtUtc: invoice.issuedAtUtc,
      businessDate: invoice.businessDate,
      sourceType: 'legacy_live_deposit',
      sourceTable: 'billing_deposits',
    };
  }

  return {
    tenantId: invoice.tenantId,
    commandIdempotencyKey: `provisional_settlement:${invoice.invoiceNumber}:${receiptNo ?? 'none'}:${depositAdjustmentNo ?? 'none'}`,
    invoice,
    payment,
    deposit,
  };
}
