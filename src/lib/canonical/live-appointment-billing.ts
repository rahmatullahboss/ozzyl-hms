import type { IssueInvoiceInput } from './commands/issue-invoice';
import type {
  IssueInvoiceWithFullPaymentInput,
} from './commands/issue-invoice-full-payment';
import type { PaymentTenderType } from './commands/collect-payment';
import { toMinorUnits } from './money';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';
import { deriveBusinessDate, toUtcIso } from './time';
import { buildLegacyLiveInvoiceSourceLineId } from './live-invoice-line-identity';

const BUSINESS_TIME_ZONE = 'Asia/Dhaka';

export interface AppointmentProjectionItem {
  provisionalItemId: number;
  category: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  totalAmount: number;
  doctorId?: number | null;
  referenceId?: number | null;
}

export interface AppointmentInvoiceProjectionInput {
  tenantId: string;
  appointmentId: number;
  patientId: number;
  invoiceNo: string;
  issuedAtUtc: string;
  businessDate: string;
  items: readonly AppointmentProjectionItem[];
}

export interface AppointmentFullPaymentProjectionInput extends AppointmentInvoiceProjectionInput {
  receiptNo: string;
  paymentMethod: string;
  externalTransactionId?: string | null;
  collectorId?: number | null;
  counterId?: number | null;
  counterSessionId?: number | null;
  amount: number;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeMoneyMinor(value: number, label: string): number {
  const minor = Number(toMinorUnits(value));
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new RangeError(`${label} must be non-negative money`);
  }
  return minor;
}

function tenantId(value: string): string {
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
  return `APPOINTMENT_${suffix || 'OTHER'}`;
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
  if (methodCode.includes('bank') || methodCode.includes('cheque') || methodCode.includes('check')) {
    return 'bank_transfer';
  }
  if (methodCode.includes('gateway') || methodCode.includes('online')) return 'gateway';
  return 'other';
}

function validateBusinessDate(issuedAtUtc: string, businessDate: string): string {
  const exactDate = exact(businessDate, 'businessDate');
  const derived = deriveBusinessDate(issuedAtUtc, BUSINESS_TIME_ZONE);
  if (exactDate !== derived) {
    throw new RangeError('businessDate must match appointment issue time in Asia/Dhaka');
  }
  return exactDate;
}

export async function buildAppointmentInvoiceProjection(
  input: AppointmentInvoiceProjectionInput,
): Promise<IssueInvoiceInput> {
  const canonicalTenantId = tenantId(input.tenantId);
  const appointmentId = positiveInteger(input.appointmentId, 'appointmentId');
  const patientId = positiveInteger(input.patientId, 'patientId');
  const invoiceNo = exact(input.invoiceNo, 'invoiceNo');
  const issuedAtUtc = toUtcIso(input.issuedAtUtc);
  const businessDate = validateBusinessDate(issuedAtUtc, input.businessDate);
  if (input.items.length === 0) throw new RangeError('Appointment invoice must contain provisional items');

  let grossTotalMinor = 0;
  let discountTotalMinor = 0;
  let netTotalMinor = 0;
  const seenItemIds = new Set<number>();
  const lines: IssueInvoiceInput['lines'][number][] = [];

  for (const [index, item] of input.items.entries()) {
    const provisionalItemId = positiveInteger(item.provisionalItemId, 'item.provisionalItemId');
    if (seenItemIds.has(provisionalItemId)) throw new RangeError('duplicate appointment provisional item');
    seenItemIds.add(provisionalItemId);
    const quantity = positiveInteger(item.quantity, 'item.quantity');
    const unitPriceMinor = nonNegativeMoneyMinor(item.unitPrice, 'item.unitPrice');
    const discountMinor = nonNegativeMoneyMinor(item.discountAmount, 'item.discountAmount');
    const netMinor = nonNegativeMoneyMinor(item.totalAmount, 'item.totalAmount');
    const grossMinorBig = BigInt(unitPriceMinor) * BigInt(quantity);
    if (grossMinorBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('appointment item gross total exceeds safe integer range');
    }
    const grossMinor = Number(grossMinorBig);
    if (grossMinor - discountMinor !== netMinor) {
      throw new RangeError('Appointment item gross, discount, and net total do not reconcile');
    }
    grossTotalMinor += grossMinor;
    discountTotalMinor += discountMinor;
    netTotalMinor += netMinor;
    if (![grossTotalMinor, discountTotalMinor, netTotalMinor].every(Number.isSafeInteger)) {
      throw new RangeError('appointment invoice totals exceed safe integer range');
    }

    const itemCategory = exact(item.category, 'item.category');
    const referenceId = item.referenceId ?? item.doctorId ?? null;
    const invoiceSourceLineId = buildLegacyLiveInvoiceSourceLineId({
      lineNumber: index + 1,
      itemCategory,
      referenceId,
    });
    const evidence = await createSourceEvidenceSha256({
      sourceType: 'legacy_live_bill_line',
      invoiceNo,
      invoiceSourceLineId,
      appointmentId,
      provisionalItemId,
      category: itemCategory,
      description: exact(item.description, 'item.description'),
      quantity,
      unitPriceMinor,
      discountMinor,
      netMinor,
      doctorId: item.doctorId ?? null,
      referenceId,
    });
    lines.push({
      linePublicId: await createDeterministicSourceId(
        'invline',
        canonicalTenantId,
        'legacy_live_bill_line',
        `${invoiceNo}:${invoiceSourceLineId}`,
      ),
      lineType: 'other_adjustment',
      serviceEventPublicId: null,
      adjustmentCode: adjustmentCode(item.category),
      quantity: 1,
      unitAmountMinor: grossMinor,
      sourceEvidenceSha256: evidence,
    });
  }

  if (grossTotalMinor - discountTotalMinor !== netTotalMinor) {
    throw new RangeError('Appointment invoice gross, discount, and net total do not reconcile');
  }
  if (netTotalMinor <= 0) throw new RangeError('Appointment invoice net total must be positive');

  if (discountTotalMinor > 0) {
    lines.push({
      linePublicId: await createDeterministicSourceId(
        'invline',
        canonicalTenantId,
        'legacy_live_bill_line',
        `${invoiceNo}:discount`,
      ),
      lineType: 'discount',
      serviceEventPublicId: null,
      adjustmentCode: 'APPOINTMENT_DISCOUNT',
      quantity: 1,
      unitAmountMinor: -discountTotalMinor,
      sourceEvidenceSha256: await createSourceEvidenceSha256({
        sourceType: 'legacy_live_bill_line',
        invoiceNo,
        appointmentId,
        kind: 'discount',
        discountTotalMinor,
      }),
    });
  }

  const sourceType = 'legacy_live_bill';
  const sourcePublicId = invoiceNo;
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType,
    sourcePublicId,
    appointmentId,
    patientId,
    invoiceNo,
    issuedAtUtc,
    businessDate,
    grossTotalMinor,
    discountTotalMinor,
    netTotalMinor,
    lines,
  });

  return {
    tenantId: canonicalTenantId,
    invoicePublicId: await createDeterministicSourceId(
      'inv',
      canonicalTenantId,
      sourceType,
      sourcePublicId,
    ),
    invoiceNumber: invoiceNo,
    legacyPatientId: patientId,
    currencyCode: 'BDT',
    issuedAtUtc,
    lines,
    sourceType,
    sourcePublicId,
    sourceTable: 'bills',
    sourceEvidenceSha256,
    idempotencyKey: `${sourceType}:${sourcePublicId}`,
    outboxEventPublicId: await createDeterministicSourceId(
      'outevt',
      canonicalTenantId,
      sourceType,
      sourcePublicId,
    ),
    businessDate,
  };
}

export async function buildAppointmentFullPaymentProjection(
  input: AppointmentFullPaymentProjectionInput,
): Promise<IssueInvoiceWithFullPaymentInput> {
  const invoice = await buildAppointmentInvoiceProjection(input);
  const receiptNo = exact(input.receiptNo, 'receiptNo');
  const methodCode = normalizeMethodCode(input.paymentMethod);
  const tenderType = tenderTypeForMethod(methodCode);
  const externalTransactionId = input.externalTransactionId == null
    ? null
    : exact(input.externalTransactionId, 'externalTransactionId');
  if (tenderType !== 'cash' && !externalTransactionId) {
    throw new RangeError('Non-cash appointment payment requires transaction/reference authority');
  }
  const amountMinor = nonNegativeMoneyMinor(input.amount, 'amount');
  if (amountMinor <= 0) throw new RangeError('Appointment payment amount must be positive');
  const invoiceTotalMinor = invoice.lines.reduce(
    (total, line) => total + line.quantity * line.unitAmountMinor,
    0,
  );
  if (amountMinor !== invoiceTotalMinor) {
    throw new RangeError('Appointment payment amount must equal appointment net total');
  }
  const collectorId = input.collectorId == null ? null : positiveInteger(input.collectorId, 'collectorId');
  const counterId = input.counterId == null ? null : positiveInteger(input.counterId, 'counterId');
  const counterSessionId = input.counterSessionId == null
    ? null
    : positiveInteger(input.counterSessionId, 'counterSessionId');
  const sourceType = 'legacy_appointment_payment';
  const sourcePublicId = receiptNo;
  const receiptPublicId = await createDeterministicSourceId(
    'payrcpt',
    invoice.tenantId,
    sourceType,
    sourcePublicId,
  );
  const tenderPublicId = await createDeterministicSourceId(
    'paytndr',
    invoice.tenantId,
    sourceType,
    sourcePublicId,
  );
  const allocationPublicId = await createDeterministicSourceId(
    'payalloc',
    invoice.tenantId,
    sourceType,
    `${sourcePublicId}:invoice:${invoice.invoiceNumber}`,
  );
  const paymentEvidence = await createSourceEvidenceSha256({
    sourceType,
    sourcePublicId,
    appointmentId: input.appointmentId,
    invoicePublicId: invoice.invoicePublicId,
    invoiceNo: invoice.invoiceNumber,
    receiptNo,
    amountMinor,
    tenderType,
    methodCode,
    externalTransactionId,
    collectorId,
    counterId,
    counterSessionId,
  });

  return {
    tenantId: invoice.tenantId,
    commandIdempotencyKey: `appointment_full_payment:${input.appointmentId}:${invoice.invoiceNumber}:${receiptNo}`,
    invoice,
    payment: {
      receiptPublicId,
      receiptNumber: receiptNo,
      tenderPublicId,
      allocationPublicId,
      tenderType,
      methodCode,
      amountMinor,
      externalTransactionId,
      legacyCollectorId: collectorId,
      legacyCounterId: counterId,
      legacyCounterSessionId: counterSessionId,
      receivedAtUtc: invoice.issuedAtUtc,
      sourceType,
      sourcePublicId,
      sourceTable: 'payments',
      sourceEvidenceSha256: paymentEvidence,
      paymentOutboxEventPublicId: await createDeterministicSourceId(
        'outevt',
        invoice.tenantId,
        sourceType,
        sourcePublicId,
      ),
      cashCustodyEventPublicId: tenderType === 'cash'
        ? await createDeterministicSourceId(
          'outevt',
          invoice.tenantId,
          'legacy_appointment_payment_cash',
          sourcePublicId,
        )
        : null,
    },
  };
}
